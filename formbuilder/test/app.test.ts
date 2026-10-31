import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { createRequire } from "node:module";
import { createApp, type App } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { buildScript, validatePayload, type FormPayload } from "../src/mcq/script.ts";
import { mockEnv, startMockGoogle, type MockGoogle } from "./mockGoogle.ts";

const require = createRequire(import.meta.url);
const MCQ = require("./fixtures/artifact-mcq.cjs");
const EXAMPLE: string = require("./fixtures/example-paper.cjs");

const DB_URL = process.env.TEST_DATABASE_URL || "postgres://postgres:postgres@localhost:5432/formbuilder_test";
const BASE = "http://app.test";

/** What the artifact sends: its own buildPayload() and buildScript() for the example paper. */
function artifactPayload(overrides: Record<string, unknown> = {}) {
  const model = MCQ.parse(MCQ.splitLines(EXAMPLE));
  const st = {
    title: model.title,
    description: model.description,
    points: "1",
    confirm: 'Your answers have been submitted. Click "View score" to see your result.',
    student: true,
    keepLetters: true,
    headings: true,
    pages: false,
    shuffle: false,
    ...overrides,
  };
  return { payload: MCQ.buildPayload(model, st) as FormPayload, script: MCQ.buildScript(model, st) as string };
}

let google: MockGoogle;
let app: App;

async function call(method: string, path: string, opts: { cookie?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.token) headers.authorization = "Bearer " + opts.token;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && opts.cookie && !headers.origin) headers.origin = BASE;
  return app.fetch(new Request(BASE + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }));
}

/** Walks the real OAuth redirect chain: app -> (mock) Google consent -> app callback. */
async function signIn(): Promise<string> {
  const start = await call("GET", "/auth/google?return_to=/");
  expect(start.status).toBe(302);
  const consent = await fetch(start.headers.get("location")!, { redirect: "manual" });
  expect(consent.status).toBe(302);
  const cb = new URL(consent.headers.get("location")!);
  const done = await app.fetch(new Request(BASE + cb.pathname + cb.search));
  expect(done.status).toBe(302);
  expect(done.headers.get("location")).toBe("/");
  const set = done.headers.get("set-cookie")!;
  expect(set).toContain("HttpOnly");
  return set.split(";")[0]!;
}

async function newToken(cookie: string) {
  const r = await call("POST", "/api/tokens", { cookie, body: { name: "artifact" } });
  expect(r.status).toBe(201);
  return ((await r.json()) as { token: string }).token;
}

beforeAll(async () => {
  google = startMockGoogle();
  const reset = new SQL(DB_URL);
  await reset.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await reset.close();
  const cfg = loadConfig({
    BASE_URL: BASE,
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: "client-secret",
    SESSION_SECRET: "x".repeat(40),
    APPS_SCRIPT_EXECUTOR_ID: "executor-script-id",
    DATABASE_URL: DB_URL,
    CORS_ORIGINS: "https://artifact.example",
    ...mockEnv(google),
  });
  app = await createApp(cfg);
});

afterAll(async () => {
  await app.close();
  google.stop();
});

beforeEach(() => google.setGrantedScopes(undefined));

describe("payload + script", () => {
  test("the API renders the same script the artifact shows", () => {
    const { payload, script } = artifactPayload();
    const v = validatePayload(payload);
    expect(v.ok).toBe(true);
    if (v.ok) expect(buildScript(v.payload)).toBe(script);
  });

  test("rejects payloads Google Forms would choke on", () => {
    const v = validatePayload({ title: "", items: [{ q: "Q", options: ["a", "a"], answer: 3 }, { nope: 1 }] });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors).toContain("title must not be empty");
      expect(v.errors.some((e) => e.includes("must not repeat"))).toBe(true);
      expect(v.errors.some((e) => e.includes('needs a question "q"'))).toBe(true);
    }
  });
});

describe("sign-in gate", () => {
  test("pages and API need a session", async () => {
    const home = await call("GET", "/");
    expect(home.status).toBe(302);
    expect(home.headers.get("location")).toBe("/login");
    expect((await call("GET", "/login")).status).toBe(200);
    const me = await call("GET", "/api/me");
    expect(me.status).toBe(401);
    expect((await call("GET", "/api/forms", { token: "fbk_nope" })).status).toBe(401);
  });

  test("Google sign-in creates a session with the Apps Script scopes", async () => {
    const cookie = await signIn();
    const home = await call("GET", "/", { cookie });
    expect(home.status).toBe(200);
    expect(await home.text()).toContain("Your forms.");
    const me = (await (await call("GET", "/api/me", { cookie })).json()) as any;
    expect(me.user.email).toBe("teacher@example.com");
    expect(me.google.missingScopes).toEqual([]);
    expect(me.google.grantedScopes).toContain("https://www.googleapis.com/auth/script.projects");
    expect((await call("GET", "/login", { cookie })).headers.get("location")).toBe("/");
  });

  test("consent without the Forms scope is refused", async () => {
    google.setGrantedScopes("openid email profile");
    const start = await call("GET", "/auth/google");
    const consent = await fetch(start.headers.get("location")!, { redirect: "manual" });
    const cb = new URL(consent.headers.get("location")!);
    const done = await app.fetch(new Request(BASE + cb.pathname + cb.search));
    expect(done.headers.get("location")).toBe("/login?error=scope_missing");
    expect(done.headers.get("set-cookie")).toBeNull();
  });

  test("a replayed or forged state is rejected", async () => {
    const r = await call("GET", "/auth/google/callback?code=x&state=forged");
    expect(r.headers.get("location")).toBe("/login?error=state_mismatch");
  });

  test("sign out ends the session", async () => {
    const cookie = await signIn();
    expect((await call("POST", "/auth/logout", { cookie })).status).toBe(204);
    expect((await call("GET", "/api/me", { cookie })).status).toBe(401);
  });
});

describe("forms API", () => {
  test("runs createMcqQuiz as the user and stores the script and links", async () => {
    const cookie = await signIn();
    const token = await newToken(cookie);
    const { payload, script } = artifactPayload();
    const before = google.runs.length;

    const r = await call("POST", "/api/forms", { token, body: { payload, script, source: "artifact" } });
    expect(r.status).toBe(201);
    const { form, warnings } = (await r.json()) as any;
    expect(warnings).toEqual([]);
    expect(form.status).toBe("created");
    expect(form.title).toBe("STD 6 TENSE QUIZ (20 MARKS)");
    expect(form.questionCount).toBe(20);
    expect(form.source).toBe("artifact");
    expect(form.editUrl).toBe(`https://docs.google.com/forms/d/${form.formId}/edit`);
    expect(form.publishedUrl).toContain("/viewform");
    expect(form.responsesUrl).toBe(`https://docs.google.com/forms/d/${form.formId}/edit#responses`);

    // Exactly one Apps Script execution, against the executor, with the artifact's payload.
    expect(google.runs.length).toBe(before + 1);
    const run = google.runs.at(-1)!;
    expect(run.scriptId).toBe("executor-script-id");
    expect(run.fn).toBe("createMcqQuiz");
    expect(JSON.parse(String(run.parameters[0]))).toEqual(payload);

    const list = (await (await call("GET", "/api/forms", { cookie })).json()) as any;
    expect(list.total).toBe(1);
    expect(list.forms[0].id).toBe(form.id);

    const full = (await (await call("GET", "/api/forms/" + form.id, { token })).json()) as any;
    expect(full.form.payload).toEqual(payload);
    expect(full.form.script).toBe(script);
    const src = await call("GET", "/api/forms/" + form.id + "/script", { cookie });
    expect(await src.text()).toBe(script);
  });

  test("dry run validates without touching Google", async () => {
    const cookie = await signIn();
    const before = google.runs.length;
    const { payload } = artifactPayload();
    payload.items = payload.items.map((i: any) => ("q" in i ? { ...i, answer: -1 } : i)).slice(0, 3);
    const r = await call("POST", "/api/forms", { cookie, body: { payload, dryRun: true } });
    expect(r.status).toBe(200);
    const body = (await r.json()) as any;
    expect(body.warnings[0]).toContain("3 questions have no correct answer");
    expect(body.script).toContain("function createMcqQuiz()");
    expect(google.runs.length).toBe(before);
  });

  test("bad payloads get a 422 with every problem listed", async () => {
    const cookie = await signIn();
    const r = await call("POST", "/api/forms", { cookie, body: { payload: { title: "T", items: [{ q: "x", options: ["only one"] }] } } });
    expect(r.status).toBe(422);
    const body = (await r.json()) as any;
    expect(body.error.code).toBe("invalid_payload");
    expect(body.error.details.errors[0]).toContain("at least two");
    expect((await call("POST", "/api/forms", { cookie, body: { text: "Q1. hi" } })).status).toBe(400);
  });

  test("an Apps Script error is stored as a failed form and can be retried", async () => {
    const cookie = await signIn();
    google.failNextRun("Exception: You do not have permission to call FormApp.create.");
    const r = await call("POST", "/api/forms", { cookie, body: artifactPayload() });
    expect(r.status).toBe(422);
    const body = (await r.json()) as any;
    expect(body.error.code).toBe("script_error");
    expect(body.error.message).toContain("FormApp.create");
    const failed = body.error.details.form;
    expect(failed.status).toBe("failed");

    const again = await call("POST", "/api/forms/" + failed.id + "/retry", { cookie });
    expect(again.status).toBe(200);
    expect(((await again.json()) as any).form.status).toBe("created");
    expect((await call("POST", "/api/forms/" + failed.id + "/retry", { cookie })).status).toBe(409);
  });

  test("refreshes response counts through getFormStats", async () => {
    const cookie = await signIn();
    const made = (await (await call("POST", "/api/forms", { cookie, body: artifactPayload() })).json()) as any;
    google.forms.get(made.form.formId)!.responses = 7;
    const r = await call("POST", "/api/forms/stats", { cookie });
    expect(r.status).toBe(200);
    const body = (await r.json()) as any;
    expect(google.runs.at(-1)!.fn).toBe("getFormStats");
    expect(body.forms.find((f: any) => f.id === made.form.id).responseCount).toBe(7);
  });

  test("saves a form's script as an Apps Script project", async () => {
    const cookie = await signIn();
    const { form } = (await (await call("POST", "/api/forms", { cookie, body: artifactPayload() })).json()) as any;
    const r = await call("POST", "/api/forms/" + form.id + "/script-project", { cookie });
    expect(r.status).toBe(200);
    const body = (await r.json()) as any;
    expect(body.scriptEditUrl).toMatch(/^https:\/\/script\.google\.com\/d\/script\d+\/edit$/);
    const proj = google.projects.get(body.form.scriptProjectId)!;
    expect((proj.files as any[]).map((f) => f.name)).toEqual(["Code", "appsscript"]);
  });

  test("users only ever see their own forms; remove deletes the record", async () => {
    const cookie = await signIn();
    const { form } = (await (await call("POST", "/api/forms", { cookie, body: artifactPayload() })).json()) as any;
    expect((await call("GET", "/api/forms/00000000-0000-0000-0000-000000000000", { cookie })).status).toBe(404);
    expect((await call("GET", "/api/forms/not-a-uuid", { cookie })).status).toBe(404);
    expect((await call("DELETE", "/api/forms/" + form.id, { cookie })).status).toBe(204);
    expect((await call("GET", "/api/forms/" + form.id, { cookie })).status).toBe(404);
  });

  test("an expired Google access token is refreshed before running", async () => {
    const cookie = await signIn();
    await app.store.sql`UPDATE users SET access_token_expires_at = now() - interval '1 hour'`;
    const before = google.runs.length;
    const r = await call("POST", "/api/forms", { cookie, body: artifactPayload() });
    expect(r.status).toBe(201);
    const used = google.runs.slice(before)[0]!.token;
    const [u] = await app.store.sql`SELECT access_token_expires_at FROM users LIMIT 1`;
    expect(new Date(u.access_token_expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(used).toMatch(/^mock-access-/);
  });
});

describe("tokens, CSRF and CORS", () => {
  test("tokens are managed from the browser session only and can be revoked", async () => {
    const cookie = await signIn();
    const token = await newToken(cookie);
    expect((await call("GET", "/api/tokens", { token })).status).toBe(403);
    const list = (await (await call("GET", "/api/tokens", { cookie })).json()) as any;
    const mine = list.tokens.find((t: any) => token.startsWith(t.prefix));
    expect(mine.lastUsedAt).not.toBeNull();
    expect((await call("DELETE", "/api/tokens/" + mine.id, { cookie })).status).toBe(204);
    expect((await call("GET", "/api/forms", { token })).status).toBe(401);
  });

  test("cookie writes from another site are blocked", async () => {
    const cookie = await signIn();
    const r = await call("POST", "/api/tokens", { cookie, body: {}, headers: { origin: "https://evil.example" } });
    expect(r.status).toBe(403);
    expect(((await r.json()) as any).error.code).toBe("cross_site");
  });

  test("allowed origins get CORS for bearer calls, others don't", async () => {
    const ok = await app.fetch(
      new Request(BASE + "/api/forms", { method: "OPTIONS", headers: { origin: "https://artifact.example", "access-control-request-method": "POST" } }),
    );
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://artifact.example");
    expect(ok.headers.get("access-control-allow-headers")).toContain("authorization");
    expect(ok.headers.get("access-control-allow-credentials")).toBeNull();
    const no = await app.fetch(new Request(BASE + "/api/forms", { method: "OPTIONS", headers: { origin: "https://evil.example" } }));
    expect(no.status).toBe(403);

    const cookie = await signIn();
    const token = await newToken(cookie);
    const r = await call("POST", "/api/forms", { token, body: artifactPayload(), headers: { origin: "https://artifact.example" } });
    expect(r.status).toBe(201);
    expect(r.headers.get("access-control-allow-origin")).toBe("https://artifact.example");
  });
});
