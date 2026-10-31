import { join } from "node:path";
import type { Config } from "./config.ts";
import { GOOGLE_SCOPES } from "./config.ts";
import { pkceChallenge, randomToken, Sealer } from "./crypto.ts";
import { Store, type ApiToken, type FormRecord, type FormStatus, type User } from "./db.ts";
import { AppError } from "./errors.ts";
import { AppsScriptClient, scriptEditorUrl, STANDALONE_MANIFEST } from "./google/appsScript.ts";
import { authorizeUrl, exchangeCode, fetchProfile, missingScopes, revoke, TokenService } from "./google/oauth.ts";
import { cookie, errorResponse, json, parseCookies, readJson, redirect, Router } from "./http.ts";
import { buildScript, questionCount, unansweredCount, validatePayload, type FormPayload } from "./mcq/script.ts";

const SESSION_COOKIE = "fb_session";
const WEB_DIR = join(import.meta.dir, "web");
const MAX_SCRIPT = 400_000;

interface Auth {
  user: User;
  via: "session" | "token";
}

interface Ctx {
  cfg: Config;
  store: Store;
  tokens: TokenService;
  script: AppsScriptClient;
  auth: Auth | null;
  sessionToken: string | null;
}

export interface App {
  fetch: (req: Request) => Promise<Response>;
  store: Store;
  close: () => Promise<void>;
}

// Serialisation

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
const responsesUrl = (formId: string) => `https://docs.google.com/forms/d/${formId}/edit#responses`;

export function formJson(f: FormRecord, full = false) {
  return {
    id: f.id,
    title: f.title,
    description: f.description,
    status: f.status,
    error: f.error,
    source: f.source,
    questionCount: f.question_count,
    unansweredCount: f.unanswered_count,
    formId: f.form_id,
    editUrl: f.edit_url,
    publishedUrl: f.published_url,
    /** The link to give students: the forms.gle short link when there is one. */
    studentUrl: f.short_url || f.published_url,
    shortUrl: f.short_url,
    responsesUrl: f.form_id ? responsesUrl(f.form_id) : null,
    responseCount: f.response_count,
    acceptingResponses: f.accepting_responses,
    statsUpdatedAt: iso(f.stats_updated_at),
    scriptProjectId: f.script_project_id,
    scriptEditUrl: f.script_project_id ? scriptEditorUrl(f.script_project_id) : null,
    createdAt: iso(f.created_at),
    updatedAt: iso(f.updated_at),
    ...(full ? { payload: f.payload, script: f.script_source } : {}),
  };
}

const userJson = (u: User) => ({ id: u.id, email: u.email, name: u.name, picture: u.picture });

const tokenJson = (t: ApiToken) => ({ id: t.id, name: t.name, prefix: t.prefix, createdAt: iso(t.created_at), lastUsedAt: iso(t.last_used_at) });

/** Only keep https links from the script result. */
function safeUrl(u: unknown): string | null {
  return typeof u === "string" && /^https:\/\/[^\s]+$/.test(u) ? u : null;
}

// Request helpers

function requireAuth(ctx: Ctx, opts: { sessionOnly?: boolean } = {}): User {
  if (!ctx.auth) throw new AppError(401, "unauthenticated", "Sign in with Google, or send an API token as `Authorization: Bearer fbk_...`.");
  if (opts.sessionOnly && ctx.auth.via !== "session") throw new AppError(403, "session_required", "This action needs a signed-in browser session.");
  return ctx.auth.user;
}

function safeReturnTo(v: string | null): string {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : "/";
}

/**
 * POST /api/forms body: { payload, script?, source?, dryRun? }.
 * `payload` is the artifact's MCQ.buildPayload() output. `script` is the artifact's MCQ.buildScript()
 * text, stored for the dashboard; when it is missing the same script is rendered from the payload.
 */
function readFormBody(body: Record<string, unknown>): { payload: FormPayload; script: string; warnings: string[] } {
  if (body.payload === undefined) throw new AppError(400, "missing_payload", 'Send { "payload": { title, items, ... } } as built by the MCQ Form Builder.');
  const v = validatePayload(body.payload);
  if (!v.ok) throw new AppError(422, "invalid_payload", "The form payload has problems.", { errors: v.errors });
  let script: string;
  if (body.script === undefined || body.script === null) script = buildScript(v.payload);
  else if (typeof body.script !== "string" || !body.script.trim()) throw new AppError(422, "invalid_script", "script must be a non-empty string.");
  else if (body.script.length > MAX_SCRIPT) throw new AppError(413, "body_too_large", `script is longer than ${MAX_SCRIPT} characters.`);
  else script = body.script;
  const warnings: string[] = [];
  const missing = unansweredCount(v.payload);
  if (missing) warnings.push(`${missing} question${missing === 1 ? " has" : "s have"} no correct answer and will score 0 for everyone.`);
  return { payload: v.payload, script, warnings };
}

/** Runs the executor's createMcqQuiz as the user and records the result either way. */
async function runCreate(ctx: Ctx, user: User, rec: FormRecord): Promise<FormRecord> {
  try {
    const token = await ctx.tokens.accessToken(user);
    const r = await ctx.script.createForm(token, rec.payload);
    return await ctx.store.markFormCreated(rec.id, { form_id: r.formId, edit_url: r.editUrl, published_url: r.publishedUrl, short_url: safeUrl(r.shortUrl) });
  } catch (e) {
    const failed = await ctx.store.markFormFailed(rec.id, e instanceof AppError ? e.message : "Unexpected error while running the script.");
    if (e instanceof AppError) {
      e.details = { ...((e.details as object) ?? {}), form: formJson(failed) };
    }
    throw e;
  }
}

async function ownForm(ctx: Ctx, user: User, id: string): Promise<FormRecord> {
  const f = await ctx.store.getForm(user.id, id);
  if (!f) throw new AppError(404, "not_found", "No form with that id.");
  return f;
}

// Routes

function buildRouter(dashboardJs: string) {
  const r = new Router<Ctx>();
  const file = (name: string, type: string) => () =>
    new Response(Bun.file(join(WEB_DIR, name)), { headers: { "content-type": type, "cache-control": "no-cache" } });

  // Pages: the dashboard sits behind Google sign-in
  r.on("GET", "/", (_req, _p, ctx) => (ctx.auth?.via === "session" ? file("dashboard.html", "text/html; charset=utf-8")() : redirect("/login")));
  r.on("GET", "/login", (_req, _p, ctx) => (ctx.auth?.via === "session" ? redirect("/") : file("login.html", "text/html; charset=utf-8")()));
  r.on("GET", "/assets/styles.css", file("styles.css", "text/css; charset=utf-8"));
  r.on("GET", "/assets/favicon.svg", file("favicon.svg", "image/svg+xml"));
  r.on("GET", "/assets/dashboard.js", () => new Response(dashboardJs, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" } }));
  r.on("GET", "/healthz", async (_req, _p, ctx) => {
    await ctx.store.sql`SELECT 1`;
    return json({ ok: true, executorConfigured: !!ctx.cfg.executorScriptId });
  });

  // Google OAuth (authorization code + PKCE)
  r.on("GET", "/auth/google", async (req, _p, ctx) => {
    const url = new URL(req.url);
    const state = randomToken(24);
    const verifier = randomToken(48);
    await ctx.store.putOAuthState(state, verifier, safeReturnTo(url.searchParams.get("return_to")));
    return redirect(authorizeUrl(ctx.cfg, state, pkceChallenge(verifier), url.searchParams.get("login_hint") || undefined));
  });

  r.on("GET", "/auth/google/callback", async (req, _p, ctx) => {
    const url = new URL(req.url);
    const fail = (code: string) => redirect("/login?error=" + encodeURIComponent(code));
    if (url.searchParams.get("error")) return fail(url.searchParams.get("error") === "access_denied" ? "access_denied" : "google_error");
    const code = url.searchParams.get("code");
    const st = await ctx.store.takeOAuthState(url.searchParams.get("state") || "");
    if (!code || !st) return fail("state_mismatch");
    const tokens = await exchangeCode(ctx.cfg, code, st.verifier).catch(() => null);
    if (!tokens) return fail("token_exchange");
    const profile = await fetchProfile(ctx.cfg, tokens.access_token).catch(() => null);
    if (!profile) return fail("profile");
    if (profile.email_verified === false) return fail("email_unverified");
    if (ctx.cfg.allowedEmails.length && !ctx.cfg.allowedEmails.includes(profile.email.toLowerCase())) {
      await revoke(ctx.cfg, tokens.access_token);
      return fail("not_allowed");
    }
    const user = await ctx.store.upsertUser({ google_sub: profile.sub, email: profile.email, name: profile.name || "", picture: profile.picture || "" });
    await ctx.tokens.storeTokens(user.id, tokens);
    if (missingScopes(tokens.scope || "").length) return fail("scope_missing");
    const s = await ctx.store.createSession(user.id, ctx.cfg.sessionDays);
    return redirect(st.return_to, {
      "set-cookie": cookie(SESSION_COOKIE, s.token, { secure: ctx.cfg.baseUrl.startsWith("https:"), maxAge: ctx.cfg.sessionDays * 86400 }),
    });
  });

  r.on("POST", "/auth/logout", async (_req, _p, ctx) => {
    if (ctx.sessionToken) await ctx.store.deleteSession(ctx.sessionToken);
    return new Response(null, {
      status: 204,
      headers: { "set-cookie": cookie(SESSION_COOKIE, "", { secure: ctx.cfg.baseUrl.startsWith("https:"), maxAge: 0 }) },
    });
  });

  // API
  r.on("GET", "/api/me", (_req, _p, ctx) => {
    const user = requireAuth(ctx);
    return json({
      user: userJson(user),
      via: ctx.auth!.via,
      google: {
        connected: !!user.refresh_token_enc,
        grantedScopes: user.scopes.split(/\s+/).filter(Boolean),
        missingScopes: missingScopes(user.scopes),
        requestedScopes: GOOGLE_SCOPES,
      },
      executorConfigured: !!ctx.cfg.executorScriptId,
    });
  });

  r.on("GET", "/api/forms", async (req, _p, ctx) => {
    const user = requireAuth(ctx);
    const q = new URL(req.url).searchParams;
    const status = q.get("status") as FormStatus | null;
    if (status && !["pending", "created", "failed"].includes(status)) throw new AppError(400, "invalid_status", "status must be pending, created or failed.");
    const { forms, total } = await ctx.store.listForms(user.id, {
      limit: Number(q.get("limit") || 50),
      offset: Number(q.get("offset") || 0),
      status: status || undefined,
    });
    return json({ forms: forms.map((f) => formJson(f)), total });
  });

  r.on("POST", "/api/forms", async (req, _p, ctx) => {
    const user = requireAuth(ctx);
    const body = await readJson(req);
    const { payload, script, warnings } = readFormBody(body);
    if (body.dryRun === true) return json({ dryRun: true, payload, script, warnings });
    const source =
      typeof body.source === "string" && /^[a-z0-9_-]{1,32}$/i.test(body.source) ? body.source : ctx.auth!.via === "token" ? "api" : "dashboard";
    const rec = await ctx.store.insertForm({
      user_id: user.id,
      title: payload.title,
      description: payload.description,
      question_count: questionCount(payload),
      unanswered_count: unansweredCount(payload),
      payload,
      script_source: script,
      source,
    });
    return json({ form: formJson(await runCreate(ctx, user, rec)), warnings }, 201);
  });

  r.on("POST", "/api/forms/stats", async (_req, _p, ctx) => {
    const user = requireAuth(ctx);
    const { forms } = await ctx.store.listForms(user.id, { status: "created", limit: 100 });
    const ids = forms.map((f) => f.form_id).filter((x): x is string => !!x);
    const stats = ids.length ? await ctx.script.formStats(await ctx.tokens.accessToken(user), ids) : [];
    const unavailable: string[] = [];
    for (const s of stats) {
      if (s.ok) await ctx.store.updateStats(user.id, s.formId, { responses: s.responses ?? 0, accepting: !!s.accepting });
      else unavailable.push(s.formId);
    }
    const after = await ctx.store.listForms(user.id);
    return json({ updated: stats.length - unavailable.length, unavailable, forms: after.forms.map((f) => formJson(f)), total: after.total });
  });

  r.on("GET", "/api/forms/:id", async (_req, p, ctx) => {
    const user = requireAuth(ctx);
    return json({ form: formJson(await ownForm(ctx, user, p.id!), true) });
  });

  r.on("GET", "/api/forms/:id/script", async (_req, p, ctx) => {
    const user = requireAuth(ctx);
    const f = await ownForm(ctx, user, p.id!);
    const name = f.title.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60) || "form";
    return new Response(f.script_source, {
      headers: { "content-type": "text/javascript; charset=utf-8", "content-disposition": `inline; filename="${name}.gs"` },
    });
  });

  r.on("POST", "/api/forms/:id/retry", async (_req, p, ctx) => {
    const user = requireAuth(ctx);
    const f = await ownForm(ctx, user, p.id!);
    if (f.status === "created") throw new AppError(409, "already_created", "This form was already created. Running again would make a second copy.");
    return json({ form: formJson(await runCreate(ctx, user, f)) });
  });

  // Saves the form's standalone script as an Apps Script project in the user's Drive.
  r.on("POST", "/api/forms/:id/script-project", async (_req, p, ctx) => {
    const user = requireAuth(ctx);
    const f = await ownForm(ctx, user, p.id!);
    const token = await ctx.tokens.accessToken(user);
    let scriptId = f.script_project_id;
    if (!scriptId) {
      scriptId = (await ctx.script.createProject(token, f.title + " (form script)")).scriptId;
      await ctx.store.setScriptProject(f.id, scriptId);
    }
    await ctx.script.updateContent(token, scriptId, [
      { name: "Code", type: "SERVER_JS", source: f.script_source },
      { name: "appsscript", type: "JSON", source: STANDALONE_MANIFEST },
    ]);
    return json({ form: formJson((await ctx.store.getForm(user.id, f.id))!), scriptEditUrl: scriptEditorUrl(scriptId) });
  });

  r.on("DELETE", "/api/forms/:id", async (_req, p, ctx) => {
    const user = requireAuth(ctx);
    if (!(await ctx.store.deleteForm(user.id, p.id!))) throw new AppError(404, "not_found", "No form with that id.");
    return new Response(null, { status: 204 });
  });

  r.on("GET", "/api/executor/ping", async (_req, _p, ctx) => {
    const user = requireAuth(ctx);
    const result = await ctx.script.ping(await ctx.tokens.accessToken(user));
    return json({ executor: ctx.cfg.executorScriptId, result });
  });

  // API tokens, managed from the signed-in dashboard only
  r.on("GET", "/api/tokens", async (_req, _p, ctx) => {
    const user = requireAuth(ctx, { sessionOnly: true });
    return json({ tokens: (await ctx.store.listApiTokens(user.id)).map(tokenJson) });
  });
  r.on("POST", "/api/tokens", async (req, _p, ctx) => {
    const user = requireAuth(ctx, { sessionOnly: true });
    const body = await readJson(req);
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 60) : "API token";
    const { token, record } = await ctx.store.createApiToken(user.id, name);
    return json({ token, record: tokenJson(record) }, 201);
  });
  r.on("DELETE", "/api/tokens/:id", async (_req, p, ctx) => {
    const user = requireAuth(ctx, { sessionOnly: true });
    if (!(await ctx.store.deleteApiToken(user.id, p.id!))) throw new AppError(404, "not_found", "No token with that id.");
    return new Response(null, { status: 204 });
  });

  return r;
}

async function bundleDashboard(): Promise<string> {
  const out = await Bun.build({ entrypoints: [join(WEB_DIR, "dashboard.ts")], target: "browser", minify: true });
  if (!out.success) throw new Error("Dashboard build failed:\n" + out.logs.join("\n"));
  return out.outputs[0]!.text();
}

export async function createApp(cfg: Config, deps: { store?: Store } = {}): Promise<App> {
  const store = deps.store ?? new Store(cfg.databaseUrl);
  await store.migrate();
  const tokens = new TokenService(cfg, store, new Sealer(cfg.sessionSecret));
  const script = new AppsScriptClient(cfg);
  const router = buildRouter(await bundleDashboard());
  const appOrigin = new URL(cfg.baseUrl).origin;
  const allowAnyOrigin = cfg.corsOrigins.includes("*");

  function corsHeaders(req: Request, path: string): Record<string, string> {
    const origin = req.headers.get("origin");
    if (!origin || !path.startsWith("/api/") || origin === appOrigin) return {};
    if (!allowAnyOrigin && !cfg.corsOrigins.includes(origin)) return {};
    // Cross-origin callers use bearer tokens; cookies are never allowed cross-origin.
    return {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-max-age": "600",
      vary: "Origin",
    };
  }

  async function handle(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    const cors = corsHeaders(req, path);
    if (req.method === "OPTIONS") return new Response(null, { status: cors["access-control-allow-origin"] ? 204 : 403, headers: cors });
    const withCors = (res: Response) => {
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    };

    try {
      // An API token wins over the session cookie.
      let auth: Auth | null = null;
      let sessionToken: string | null = null;
      const authz = req.headers.get("authorization") || "";
      if (authz.startsWith("Bearer ")) {
        const user = await store.userForApiToken(authz.slice(7).trim());
        if (!user) throw new AppError(401, "invalid_token", "That API token is not valid. Create a new one on the dashboard.");
        auth = { user, via: "token" };
      } else {
        sessionToken = parseCookies(req)[SESSION_COOKIE] || null;
        const user = sessionToken ? await store.userForSession(sessionToken) : null;
        if (user) auth = { user, via: "session" };
        // Cookie-authenticated writes must come from this site (CSRF guard).
        if (!["GET", "HEAD"].includes(req.method)) {
          const origin = req.headers.get("origin");
          const site = req.headers.get("sec-fetch-site");
          if ((origin && origin !== appOrigin) || (site && !["same-origin", "none"].includes(site))) {
            throw new AppError(403, "cross_site", "Cross-site requests must use an API token.");
          }
        }
      }

      const m = router.match(req.method, path);
      if (!m) return withCors(json({ error: { code: "not_found", message: "No such endpoint." } }, 404));
      if ("allowed" in m) return withCors(json({ error: { code: "method_not_allowed", message: "Use " + m.allowed.join(", ") + "." } }, 405, { allow: m.allowed.join(", ") }));
      return withCors(await m.handler(req, m.params, { cfg, store, tokens, script, auth, sessionToken }));
    } catch (e) {
      return withCors(errorResponse(e));
    }
  }

  return { fetch: handle, store, close: () => store.close() };
}
