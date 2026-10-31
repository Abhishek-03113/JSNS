/**
 * Remote MCP server (Streamable HTTP transport, stateless, JSON responses) at POST /mcp.
 * claude.ai adds it as a custom connector; the MCQ Form Builder artifact then calls these tools
 * through its `mcp` capability with the viewer's own connector credentials.
 */
import { formJson, readFormBody, runCreate, type Ctx } from "./application.ts";
import type { User } from "./db.ts";
import { AppError } from "./errors.ts";
import { missingScopes } from "./google/oauth.ts";
import { questionCount, unansweredCount } from "./mcq/script.ts";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const PAYLOAD_SCHEMA = {
  type: "object",
  description: "The quiz, exactly as the MCQ Form Builder's MCQ.buildPayload() returns it.",
  required: ["title", "items"],
  properties: {
    title: { type: "string", description: "Form title." },
    description: { type: "string" },
    points: { type: "integer", minimum: 0, maximum: 100, description: "Marks per question." },
    student: { type: "boolean", description: "Ask for name and roll number at the top." },
    pages: { type: "boolean", description: "Put each section on its own page." },
    shuffle: { type: "boolean", description: "Shuffle question order for each student." },
    confirm: { type: "string", description: "Message shown after submitting." },
    nameLabel: { type: "string" },
    rollLabel: { type: "string" },
    wordLabel: { type: "string" },
    items: {
      type: "array",
      description: "Sections and questions in order.",
      items: {
        type: "object",
        properties: {
          section: { type: "string", description: "Section heading (for a section item)." },
          help: { type: "string", description: "Section instructions." },
          q: { type: "string", description: "Question text (for a question item)." },
          options: { type: "array", items: { type: "string" }, minItems: 2 },
          answer: { type: "integer", minimum: -1, description: "0-based index of the correct option, -1 for none." },
          word: { type: "string", description: "Underlined word the question is about." },
        },
      },
    },
  },
};

const FORM_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    status: { type: "string", enum: ["pending", "created", "failed"] },
    error: { type: ["string", "null"] },
    questionCount: { type: "integer" },
    editUrl: { type: ["string", "null"], description: "Teacher's editor link." },
    studentUrl: { type: ["string", "null"], description: "Link to send students (forms.gle when available)." },
    publishedUrl: { type: ["string", "null"] },
    responseCount: { type: ["integer", "null"] },
    createdAt: { type: "string" },
  },
};

const TOOLS = [
  {
    name: "get_account",
    title: "Account status",
    description: "Who is signed in to MCQ Form Builder and whether forms can be created for them.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        email: { type: "string" },
        name: { type: "string" },
        readyToCreateForms: { type: "boolean" },
        problem: { type: ["string", "null"], description: "What blocks form creation, if anything." },
      },
      required: ["email", "readyToCreateForms"],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "create_google_form",
    title: "Create Google Form",
    description:
      "Creates a graded Google Forms quiz in the signed-in user's Google Drive by running Apps Script as them. Returns the edit link (for the teacher) and the student link. Each call makes a new form.",
    inputSchema: { type: "object", required: ["payload"], properties: { payload: PAYLOAD_SCHEMA } },
    outputSchema: {
      type: "object",
      properties: { form: FORM_SCHEMA, warnings: { type: "array", items: { type: "string" } } },
      required: ["form"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "list_google_forms",
    title: "List Google Forms",
    description: "Forms made through MCQ Form Builder for the signed-in user, newest first, with edit and student links.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50, default: 20 } } },
    outputSchema: {
      type: "object",
      properties: { forms: { type: "array", items: FORM_SCHEMA }, total: { type: "integer" } },
      required: ["forms", "total"],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: unknown; isError?: boolean };

const ok = (data: unknown, text: string): ToolResult => ({ content: [{ type: "text", text }], structuredContent: data });
const fail = (code: string, message: string): ToolResult => ({
  content: [{ type: "text", text: message }],
  structuredContent: { error: { code, message } },
  isError: true,
});

function formSummary(f: ReturnType<typeof formJson>) {
  return {
    id: f.id,
    title: f.title,
    status: f.status,
    error: f.error,
    questionCount: f.questionCount,
    editUrl: f.editUrl,
    studentUrl: f.studentUrl,
    publishedUrl: f.publishedUrl,
    responseCount: f.responseCount,
    createdAt: f.createdAt,
  };
}

async function callTool(ctx: Ctx, user: User, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    if (name === "get_account") {
      const missing = missingScopes(user.scopes);
      const problem = !user.refresh_token_enc
        ? "Google sign-in has expired. Sign in again on the MCQ Form Builder site."
        : missing.length
          ? "Google permission to manage Forms is missing. Sign in again on the MCQ Form Builder site and allow it."
          : !ctx.cfg.executorScriptId
            ? "The form-making script isn't set up on the server yet."
            : null;
      const data = { email: user.email, name: user.name, readyToCreateForms: !problem, problem };
      return ok(data, problem ? `Signed in as ${user.email}. ${problem}` : `Signed in as ${user.email}. Ready to create forms.`);
    }
    if (name === "create_google_form") {
      const { payload, script, warnings } = readFormBody({ payload: args.payload });
      const rec = await ctx.store.insertForm({
        user_id: user.id,
        title: payload.title,
        description: payload.description,
        question_count: questionCount(payload),
        unanswered_count: unansweredCount(payload),
        payload,
        script_source: script,
        source: "claude",
      });
      const form = formSummary(formJson(await runCreate(ctx, user, rec)));
      return ok(
        { form, warnings },
        `Created "${form.title}" with ${form.questionCount} questions.\nEdit link: ${form.editUrl}\nStudent link: ${form.studentUrl}`,
      );
    }
    if (name === "list_google_forms") {
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
      const { forms, total } = await ctx.store.listForms(user.id, { limit });
      const list = forms.map((f) => formSummary(formJson(f)));
      return ok({ forms: list, total }, list.length ? list.map((f) => `${f.title} (${f.status}) ${f.studentUrl ?? ""}`).join("\n") : "No forms yet.");
    }
    return fail("unknown_tool", `No tool named ${name}.`);
  } catch (e) {
    if (e instanceof AppError) {
      const errors = (e.details as { errors?: string[] } | undefined)?.errors;
      return fail(e.code, errors?.length ? `${e.message} ${errors.join("; ")}` : e.message);
    }
    console.error(e);
    return fail("internal", "Something went wrong on the server.");
  }
}

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

async function handleOne(ctx: Ctx, user: User, msg: RpcRequest): Promise<object | null> {
  const isNotification = msg.id === undefined || msg.id === null;
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
  const error = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return error(-32600, "Invalid request");
  if (isNotification) return null;
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion || "");
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "mcq-form-builder", title: "MCQ Form Builder", version: "0.2.0" },
        instructions:
          "Creates graded Google Forms quizzes in the user's Google Drive. Send create_google_form the payload built by the MCQ Form Builder (title, settings, items of sections and questions with a 0-based answer index).",
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name || "");
      if (!TOOLS.some((t) => t.name === name)) return error(-32602, `Unknown tool: ${name}`);
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      return reply(await callTool(ctx, user, name, args));
    }
    default:
      return error(-32601, `Method not found: ${msg.method}`);
  }
}

/** POST /mcp. The caller is already authenticated (bearer access token). */
export async function handleMcp(req: Request, ctx: Ctx, user: User): Promise<Response> {
  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const batch = Array.isArray(body);
  const msgs = (batch ? body : [body]) as RpcRequest[];
  const out: object[] = [];
  for (const m of msgs) {
    const r = await handleOne(ctx, user, m ?? {});
    if (r) out.push(r);
  }
  if (!out.length) return new Response(null, { status: 202 });
  return Response.json(batch ? out : out[0], { headers: { "cache-control": "no-store" } });
}
