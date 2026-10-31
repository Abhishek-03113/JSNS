/**
 * Stand-in for Google's OAuth, userinfo and Apps Script API endpoints, used by the tests and
 * `bun run dev:mock`. It records every scripts.run call so tests can assert what was executed.
 */
import type { Server } from "bun";

export interface MockGoogleOptions {
  port?: number;
  email?: string;
  /** Scopes the consent screen "grants". Defaults to everything requested. */
  grantedScopes?: string;
}

export interface MockGoogle {
  url: string;
  server: Server<undefined>;
  runs: { scriptId: string; fn: string; parameters: unknown[]; token: string }[];
  projects: Map<string, { title: string; files: unknown[]; versions: number; deployments: string[] }>;
  forms: Map<string, { title: string; responses: number; payload: unknown }>;
  /** Make the next scripts.run fail like Apps Script would. */
  failNextRun: (message: string) => void;
  setGrantedScopes: (s: string | undefined) => void;
  stop: () => void;
}

export function startMockGoogle(opts: MockGoogleOptions = {}): MockGoogle {
  const runs: MockGoogle["runs"] = [];
  const projects: MockGoogle["projects"] = new Map();
  const forms: MockGoogle["forms"] = new Map();
  const codes = new Map<string, string>(); // code -> granted scope
  let failNext: string | null = null;
  let granted = opts.grantedScopes;
  let n = 0;
  const email = opts.email ?? "teacher@example.com";

  const json = (d: unknown, status = 200) => Response.json(d, { status });
  const bearer = (req: Request) => (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  const tokenOk = (t: string) => t.startsWith("mock-access-");

  const server = Bun.serve({
    port: opts.port ?? 0,
    async fetch(req) {
      const url = new URL(req.url);
      const p = url.pathname;

      // Consent screen: approve straight away and bounce back with a code.
      if (p === "/o/oauth2/v2/auth") {
        const back = new URL(url.searchParams.get("redirect_uri")!);
        const code = "mock-code-" + ++n;
        codes.set(code, granted ?? url.searchParams.get("scope") ?? "");
        back.searchParams.set("code", code);
        back.searchParams.set("state", url.searchParams.get("state") || "");
        return Response.redirect(back.toString(), 302);
      }

      if (p === "/token" && req.method === "POST") {
        const body = new URLSearchParams(await req.text());
        if (body.get("grant_type") === "authorization_code") {
          const scope = codes.get(body.get("code") || "");
          if (scope === undefined || !body.get("code_verifier")) return json({ error: "invalid_grant" }, 400);
          codes.delete(body.get("code")!);
          return json({ access_token: "mock-access-" + ++n, expires_in: 3600, refresh_token: "mock-refresh-" + n, scope, token_type: "Bearer" });
        }
        if (body.get("grant_type") === "refresh_token") {
          if (!body.get("refresh_token")?.startsWith("mock-refresh-")) return json({ error: "invalid_grant" }, 400);
          return json({ access_token: "mock-access-" + ++n, expires_in: 3600, token_type: "Bearer" });
        }
        return json({ error: "unsupported_grant_type" }, 400);
      }

      if (p === "/userinfo") {
        if (!tokenOk(bearer(req))) return json({ error: "invalid_token" }, 401);
        return json({ sub: "sub-" + email, email, email_verified: true, name: "Test Teacher", picture: "" });
      }

      if (p === "/revoke") return new Response(null, { status: 200 });

      // Apps Script API
      const run = p.match(/^\/v1\/scripts\/([^/:]+):run$/);
      if (run && req.method === "POST") {
        const token = bearer(req);
        if (!tokenOk(token)) return json({ error: { code: 401, message: "Request had invalid authentication credentials." } }, 401);
        const body = (await req.json()) as { function: string; parameters?: unknown[] };
        runs.push({ scriptId: decodeURIComponent(run[1]!), fn: body.function, parameters: body.parameters || [], token });
        if (failNext) {
          const m = failNext;
          failNext = null;
          return json({ done: true, error: { code: 3, message: "ScriptError", details: [{ errorMessage: m, errorType: "ScriptError", scriptStackTraceElements: [{ function: body.function, lineNumber: 12 }] }] } });
        }
        if (body.function === "createMcqQuiz") {
          const payload = JSON.parse(String(body.parameters?.[0])) as { title: string; items: { q?: string }[] };
          const id = "form" + ++n;
          forms.set(id, { title: payload.title, responses: 0, payload });
          return json({
            done: true,
            response: {
              "@type": "type.googleapis.com/google.apps.script.v1.ExecutionResponse",
              result: {
                formId: id,
                title: payload.title,
                editUrl: `https://docs.google.com/forms/d/${id}/edit`,
                publishedUrl: `https://docs.google.com/forms/d/e/${id}-pub/viewform`,
                questionCount: payload.items.filter((i) => i.q !== undefined).length,
              },
            },
          });
        }
        if (body.function === "getFormStats") {
          const ids = JSON.parse(String(body.parameters?.[0])) as string[];
          return json({
            done: true,
            response: {
              result: ids.map((id) => {
                const f = forms.get(id);
                return f ? { formId: id, ok: true, title: f.title, responses: f.responses, accepting: true } : { formId: id, ok: false, error: "No item with the given ID could be found." };
              }),
            },
          });
        }
        if (body.function === "ping") return json({ done: true, response: { result: { ok: true, user: email, at: new Date().toISOString() } } });
        return json({ done: true, error: { code: 3, message: "ScriptError", details: [{ errorMessage: "Script function not found: " + body.function, errorType: "ScriptError" }] } });
      }

      if (!tokenOk(bearer(req)) && p.startsWith("/v1/")) return json({ error: { code: 401, message: "Invalid credentials" } }, 401);

      if (p === "/v1/projects" && req.method === "POST") {
        const { title } = (await req.json()) as { title: string };
        const id = "script" + ++n;
        projects.set(id, { title, files: [], versions: 0, deployments: [] });
        return json({ scriptId: id, title });
      }
      const proj = p.match(/^\/v1\/projects\/([^/]+)\/(content|versions|deployments)(?:\/([^/]+))?$/);
      if (proj) {
        const pr = projects.get(proj[1]!);
        if (!pr) return json({ error: { code: 404, message: "Requested entity was not found." } }, 404);
        if (proj[2] === "content" && req.method === "PUT") {
          pr.files = ((await req.json()) as { files: unknown[] }).files;
          return json({ scriptId: proj[1], files: pr.files });
        }
        if (proj[2] === "versions" && req.method === "POST") return json({ versionNumber: ++pr.versions });
        if (proj[2] === "deployments" && req.method === "POST") {
          const d = "deploy" + ++n;
          pr.deployments.push(d);
          return json({ deploymentId: d });
        }
        if (proj[2] === "deployments" && req.method === "PUT") return json({ deploymentId: proj[3] });
      }
      return json({ error: { code: 404, message: "mock: no route " + req.method + " " + p } }, 404);
    },
  });

  return {
    url: server.url.origin,
    server,
    runs,
    projects,
    forms,
    failNextRun: (m) => (failNext = m),
    setGrantedScopes: (s) => (granted = s),
    stop: () => server.stop(true),
  };
}

/** Env vars that point the app at the mock. */
export function mockEnv(m: MockGoogle): Record<string, string> {
  return {
    GOOGLE_AUTH_URL: m.url + "/o/oauth2/v2/auth",
    GOOGLE_TOKEN_URL: m.url + "/token",
    GOOGLE_USERINFO_URL: m.url + "/userinfo",
    GOOGLE_REVOKE_URL: m.url + "/revoke",
    GOOGLE_SCRIPT_API_BASE: m.url,
  };
}
