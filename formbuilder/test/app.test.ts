import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { createRequire } from "node:module";
import { createApp, type App } from "../src/application.ts";
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
    expect(form.shortUrl).toBe(`https://forms.gle/${form.formId}short`);
    expect(form.studentUrl).toBe(form.shortUrl);
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

describe("build", () => {
  test("embedded assets are up to date with src/web and migrations", async () => {
    const { renderAssets } = await import("../scripts/embed-assets.ts");
    const current = await Bun.file(new URL("../src/generated/assets.ts", import.meta.url)).text();
    expect(current === (await renderAssets())).toBe(true);
  });
});

describe("claude.ai connector: OAuth + MCP", () => {
  const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
  const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
  const verifier = "v".repeat(20) + "-verifier-" + "x".repeat(30);
  const challenge = () => new Bun.CryptoHasher("sha256").update(verifier).digest("base64url");

  async function rpc(token: string | undefined, body: unknown) {
    return app.fetch(
      new Request(BASE + "/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: "Bearer " + token } : {}) },
        body: JSON.stringify(body),
      }),
    );
  }

  /** Runs the flow claude.ai runs: 401 → discovery → register → authorize (sign-in + consent) → token. */
  async function connect(cookie: string) {
    const first = await rpc(undefined, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(first.status).toBe(401);
    const challengeHeader = first.headers.get("www-authenticate")!;
    expect(challengeHeader).toContain(`resource_metadata="${BASE}/.well-known/oauth-protected-resource"`);

    const prm = (await (await call("GET", "/.well-known/oauth-protected-resource")).json()) as any;
    expect(prm.resource).toBe(BASE + "/mcp");
    const asMeta = (await (await call("GET", "/.well-known/oauth-authorization-server")).json()) as any;
    expect(asMeta.code_challenge_methods_supported).toEqual(["S256"]);

    const reg = await app.fetch(
      new Request(asMeta.registration_endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://claude.ai" },
        body: JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }),
      }),
    );
    expect(reg.status).toBe(201);
    const client = (await reg.json()) as any;
    expect(client.client_secret).toBeUndefined();

    const q = form({ response_type: "code", client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: challenge(), code_challenge_method: "S256", state: "st8", scope: "forms" });
    // Not signed in: sent to Google sign-in, coming back to the same authorize URL.
    const anon = await call("GET", "/oauth/authorize?" + q);
    expect(anon.status).toBe(302);
    expect(decodeURIComponent(anon.headers.get("location")!)).toBe("/login?return_to=/oauth/authorize?" + q);
    // Signed in: consent page.
    const page = await call("GET", "/oauth/authorize?" + q, { cookie });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Allow Claude?");
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    // Allow.
    const allow = await app.fetch(
      new Request(BASE + "/oauth/authorize", {
        method: "POST",
        headers: { cookie, origin: BASE, "content-type": "application/x-www-form-urlencoded" },
        body: q + "&code_challenge_method=S256&decision=allow",
      }),
    );
    expect(allow.status).toBe(303);
    const back = new URL(allow.headers.get("location")!);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("st8");
    const code = back.searchParams.get("code")!;

    const tokenReq = (body: Record<string, string>) =>
      app.fetch(new Request(BASE + "/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://claude.ai" }, body: form(body) }));
    const wrongPkce = await tokenReq({ grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: REDIRECT, code_verifier: "w".repeat(50) });
    expect(wrongPkce.status).toBe(400);
    expect(((await wrongPkce.json()) as any).error).toBe("invalid_grant");
    // The failed attempt burned the code (single use), so authorize again.
    const allow2 = await app.fetch(
      new Request(BASE + "/oauth/authorize", { method: "POST", headers: { cookie, origin: BASE, "content-type": "application/x-www-form-urlencoded" }, body: q + "&decision=allow" }),
    );
    const code2 = new URL(allow2.headers.get("location")!).searchParams.get("code")!;
    const tok = await tokenReq({ grant_type: "authorization_code", code: code2, client_id: client.client_id, redirect_uri: REDIRECT, code_verifier: verifier });
    expect(tok.status).toBe(200);
    expect(tok.headers.get("access-control-allow-origin")).toBe("*");
    const t = (await tok.json()) as any;
    expect(t.token_type).toBe("Bearer");
    expect(t.access_token).toMatch(/^fbo_/);
    const replay = await tokenReq({ grant_type: "authorization_code", code: code2, client_id: client.client_id, redirect_uri: REDIRECT, code_verifier: verifier });
    expect(replay.status).toBe(400);
    return { client, tokens: t, tokenReq };
  }

  test("connect, call the tools, refresh, disconnect", async () => {
    const cookie = await signIn();
    const { client, tokens, tokenReq } = await connect(cookie);

    const init = (await (await rpc(tokens.access_token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "1" } } })).json()) as any;
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.capabilities.tools).toBeDefined();
    expect((await rpc(tokens.access_token, { jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);

    const list = (await (await rpc(tokens.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list" })).json()) as any;
    expect(list.result.tools.map((t: any) => t.name)).toEqual(["get_account", "create_google_form", "list_google_forms"]);

    const acct = (await (await rpc(tokens.access_token, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_account", arguments: {} } })).json()) as any;
    expect(acct.result.structuredContent).toEqual({ email: "teacher@example.com", name: "Test Teacher", readyToCreateForms: true, problem: null });

    const before = google.runs.length;
    const { payload } = artifactPayload();
    const made = (await (await rpc(tokens.access_token, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "create_google_form", arguments: { payload } } })).json()) as any;
    expect(made.result.isError).toBeUndefined();
    const f = made.result.structuredContent.form;
    expect(f.status).toBe("created");
    expect(f.editUrl).toMatch(/^https:\/\/docs\.google\.com\/forms\/d\/.+\/edit$/);
    expect(f.studentUrl).toMatch(/^https:\/\/forms\.gle\//);
    expect(made.result.content[0].text).toContain("Student link: " + f.studentUrl);
    expect(google.runs.length).toBe(before + 1);
    expect(JSON.parse(String(google.runs.at(-1)!.parameters[0]))).toEqual(payload);

    const bad = (await (await rpc(tokens.access_token, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "create_google_form", arguments: { payload: { title: "", items: [] } } } })).json()) as any;
    expect(bad.result.isError).toBe(true);
    expect(bad.result.structuredContent.error.code).toBe("invalid_payload");

    const listed = (await (await rpc(tokens.access_token, { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "list_google_forms", arguments: { limit: 5 } } })).json()) as any;
    expect(listed.result.structuredContent.forms[0].id).toBe(f.id);
    expect((await (await call("GET", "/api/forms/" + f.id, { cookie })).json() as any).form.source).toBe("claude");

    // Connector tokens can't use the REST API.
    expect((await call("GET", "/api/forms", { token: tokens.access_token })).status).toBe(403);

    // Refresh rotates; the old refresh token stops working.
    const r1 = await tokenReq({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id });
    expect(r1.status).toBe(200);
    const t2 = (await r1.json()) as any;
    expect(t2.refresh_token).not.toBe(tokens.refresh_token);
    expect((await tokenReq({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id })).status).toBe(400);

    // The dashboard lists the connection and can disconnect it.
    const conns = (await (await call("GET", "/api/connections", { cookie })).json()) as any;
    const conn = conns.connections.find((c: any) => c.name === "Claude");
    expect(conn).toBeDefined();
    expect((await call("DELETE", "/api/connections/" + conn.id, { cookie })).status).toBe(204);
    const after = await rpc(t2.access_token, { jsonrpc: "2.0", id: 7, method: "tools/list" });
    expect(after.status).toBe(401);
    expect(after.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  test("authorize rejects unknown clients, unregistered redirects and plain PKCE; deny goes back with access_denied", async () => {
    const cookie = await signIn();
    expect((await call("GET", "/oauth/authorize?client_id=nope&redirect_uri=" + encodeURIComponent(REDIRECT), { cookie })).status).toBe(400);
    const reg = (await (await app.fetch(new Request(BASE + "/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "X", redirect_uris: [REDIRECT] }) }))).json()) as any;
    const evil = await call("GET", "/oauth/authorize?" + form({ response_type: "code", client_id: reg.client_id, redirect_uri: "https://evil.example/cb", code_challenge: challenge(), code_challenge_method: "S256" }), { cookie });
    expect(evil.status).toBe(400);
    expect(evil.headers.get("location")).toBeNull();
    const plain = await call("GET", "/oauth/authorize?" + form({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge(), code_challenge_method: "plain" }), { cookie });
    expect(new URL(plain.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");
    const q = form({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge(), code_challenge_method: "S256", state: "s" });
    const deny = await app.fetch(new Request(BASE + "/oauth/authorize", { method: "POST", headers: { cookie, origin: BASE, "content-type": "application/x-www-form-urlencoded" }, body: q + "&decision=deny" }));
    expect(new URL(deny.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
    // Consent posted from another site is blocked.
    const forged = await app.fetch(new Request(BASE + "/oauth/authorize", { method: "POST", headers: { cookie, origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" }, body: q + "&decision=allow" }));
    expect(forged.status).toBe(403);
    expect((await app.fetch(new Request(BASE + "/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }) }))).status).toBe(400);
  });
});

describe("graceful errors", () => {
  test("people get pages, programs get JSON", async () => {
    const page = await app.fetch(new Request(BASE + "/no-such-page", { headers: { accept: "text/html" } }));
    expect(page.status).toBe(404);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("Page not found.");
    const api = await call("GET", "/api/no-such-endpoint");
    expect(api.status).toBe(404);
    expect(((await api.json()) as any).error.code).toBe("not_found");
  });

  test("a database failure during sign-in lands on the sign-in page with a message, not JSON", async () => {
    const original = app.store.upsertUser.bind(app.store);
    app.store.upsertUser = async () => {
      throw Object.assign(new Error("Connection closed"), { code: "ERR_POSTGRES_CONNECTION_CLOSED" });
    };
    try {
      const start = await call("GET", "/auth/google");
      const consent = await fetch(start.headers.get("location")!, { redirect: "manual" });
      const cb = new URL(consent.headers.get("location")!);
      const done = await app.fetch(new Request(BASE + cb.pathname + cb.search));
      expect(done.status).toBe(302);
      expect(done.headers.get("location")).toBe("/login?error=database_unavailable");
    } finally {
      app.store.upsertUser = original;
    }
  });

  test("an unexpected error on a page shows an error page with a reference", async () => {
    const cookie = await signIn();
    const original = app.store.listGrants.bind(app.store);
    const page = await (async () => {
      // A page route that hits the store: /oauth/authorize with a registered client.
      const reg = (await (await app.fetch(new Request(BASE + "/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["https://claude.ai/cb"] }) }))).json()) as any;
      const origGet = app.store.getOAuthClient.bind(app.store);
      app.store.getOAuthClient = async () => {
        throw new TypeError("boom");
      };
      try {
        return await app.fetch(new Request(BASE + "/oauth/authorize?client_id=" + reg.client_id, { headers: { cookie, accept: "text/html" } }));
      } finally {
        app.store.getOAuthClient = origGet;
      }
    })();
    app.store.listGrants = original;
    expect(page.status).toBe(500);
    const html = await page.text();
    expect(html).toContain("Something broke.");
    expect(html).toMatch(/Reference: [A-Za-z0-9_-]{8}/);
    expect(html).not.toContain("boom");
  });

  test("database outages are recognised from the errors Supabase actually returns", async () => {
    const { isDatabaseUnavailable } = await import("../src/http.ts");
    expect(isDatabaseUnavailable(new Error("Connection closed"))).toBe(true);
    expect(isDatabaseUnavailable(new Error("(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15"))).toBe(true);
    expect(isDatabaseUnavailable({ code: "ERR_POSTGRES_SERVER_ERROR", errno: "53300", message: "too many" })).toBe(true);
    expect(isDatabaseUnavailable({ code: "ERR_POSTGRES_SERVER_ERROR", errno: "22007", message: "invalid input syntax" })).toBe(false);
  });

  test("migrations from several instances starting at once don't collide", async () => {
    const { Store } = await import("../src/db.ts");
    const reset = new SQL(DB_URL);
    await reset.unsafe("DROP SCHEMA IF EXISTS race CASCADE; CREATE SCHEMA race;");
    await reset.close();
    const url = DB_URL + (DB_URL.includes("?") ? "&" : "?") + "options=" + encodeURIComponent("-c search_path=race");
    const stores = [new Store(url), new Store(url), new Store(url), new Store(url)];
    const results = await Promise.allSettled(stores.map((s) => s.migrate()));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const appliedOnce = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    expect(appliedOnce.sort()).toEqual(["001_init.sql", "002_short_url.sql", "003_oauth.sql"]);
    await Promise.all(stores.map((s) => s.close()));
    const cleanup = new SQL(DB_URL);
    await cleanup.unsafe("DROP SCHEMA race CASCADE");
    await cleanup.close();
  });
});
