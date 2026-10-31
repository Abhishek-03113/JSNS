/**
 * OAuth 2.1 authorization server for MCP clients, so claude.ai can add this app as a custom connector:
 * discovery metadata (RFC 9728, RFC 8414), dynamic client registration (RFC 7591), authorization code
 * + PKCE (S256 only) with a consent page behind Google sign-in, refresh token rotation, revocation.
 */
import type { Ctx } from "./application.ts";
import { pkceChallenge } from "./crypto.ts";
import { sha256 } from "./crypto.ts";
import { readJson, redirect, type Router } from "./http.ts";

export const MCP_SCOPE = "forms";
const ACCESS_TTL = 3600;

const oauthJson = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", pragma: "no-cache" },
  });
const oauthError = (error: string, description: string, status = 400) => oauthJson({ error, error_description: description }, status);

export function resourceMetadataUrl(baseUrl: string) {
  return baseUrl + "/.well-known/oauth-protected-resource";
}

/** https anywhere, or http only for a loopback address (native/dev clients). */
function validRedirectUri(u: unknown): u is string {
  if (typeof u !== "string" || u.length > 2000) return false;
  try {
    const url = new URL(u);
    if (url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function consentPage(p: { clientName: string; email: string; redirectHost: string; fields: Record<string, string>; formsReady: boolean }) {
  const hidden = Object.entries(p.fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Allow access · MCQ Form Builder</title>
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@500&family=Inter:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/assets/styles.css"></head>
<body><div class="wrap">
  <header class="bar"><span class="brand"><img src="/assets/favicon.svg" width="22" height="22" alt="">MCQ Form Builder</span>
  <div class="bar-note">Signed in as ${esc(p.email)}</div></header>
  <div class="head">
    <h1>Allow ${esc(p.clientName)}?<span class="soft">It will make quizzes as you.</span></h1>
    <p class="lede">${esc(p.clientName)} is asking to use MCQ Form Builder with your Google account. You can disconnect it at any time from your forms dashboard.</p>
  </div>
  <section aria-label="What it can do"><div class="card">
    <h3 class="card-title">It will be able to</h3>
    <ul class="steps bullets">
      <li><span><b>Create graded Google Forms</b> in your Google Drive from question papers you send.</span></li>
      <li><span><b>List the forms</b> made through MCQ Form Builder, with their edit and student links.</span></li>
    </ul>
    <p class="card-sub" style="margin:0">It can't read your other Google files or forms. After you allow, you go back to ${esc(p.redirectHost)}.</p>
    ${p.formsReady ? "" : '<div class="warnbar">Google permission to manage Forms is missing for your account, so making forms will fail until you <a href="/auth/google">sign in again</a> and allow it.</div>'}
    <form method="post" action="/oauth/authorize" class="actions">${hidden}
      <button class="btn btn-primary" type="submit" name="decision" value="allow">Allow</button>
      <button class="btn btn-grey" type="submit" name="decision" value="deny">Cancel</button>
    </form>
  </div></section>
</div></body></html>`;
}

/** Checks an authorize request; returns the client and normalized params, or a reason it can't continue. */
async function checkAuthorize(ctx: Ctx, q: URLSearchParams) {
  const clientId = q.get("client_id") || "";
  const redirectUri = q.get("redirect_uri") || "";
  const client = clientId ? await ctx.store.getOAuthClient(clientId) : null;
  // Errors before the redirect URI is trusted must not redirect (RFC 6749 4.1.2.1).
  if (!client) return { fatal: "Unknown client. Remove the connector and add it again." };
  if (!client.redirect_uris.includes(redirectUri)) return { fatal: "This redirect address isn't registered for the client." };
  const back = (error: string, description: string) => {
    const u = new URL(redirectUri);
    u.searchParams.set("error", error);
    u.searchParams.set("error_description", description);
    if (q.get("state")) u.searchParams.set("state", q.get("state")!);
    return redirect(u.toString());
  };
  if (q.get("response_type") !== "code") return { client, error: back("unsupported_response_type", "Only response_type=code is supported.") };
  const challenge = q.get("code_challenge") || "";
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(challenge) || q.get("code_challenge_method") !== "S256")
    return { client, error: back("invalid_request", "PKCE with code_challenge_method=S256 is required.") };
  return { client, redirectUri, challenge, state: q.get("state") || "", scope: MCP_SCOPE };
}

function textPage(status: number, message: string) {
  return new Response(`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/assets/styles.css"><div class="wrap"><div class="head" style="padding-top:48px"><h1>Can't connect.<span class="soft">${esc(message)}</span></h1></div></div>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export function registerOAuthRoutes(r: Router<Ctx>) {
  // Discovery
  const protectedResource = (_req: Request, _p: unknown, ctx: Ctx) =>
    oauthJson({
      resource: ctx.cfg.baseUrl + "/mcp",
      authorization_servers: [ctx.cfg.baseUrl],
      scopes_supported: [MCP_SCOPE],
      bearer_methods_supported: ["header"],
      resource_name: "MCQ Form Builder",
    });
  r.on("GET", "/.well-known/oauth-protected-resource", protectedResource);
  r.on("GET", "/.well-known/oauth-protected-resource/mcp", protectedResource);
  r.on("GET", "/.well-known/oauth-authorization-server", (_req, _p, ctx) =>
    oauthJson({
      issuer: ctx.cfg.baseUrl,
      authorization_endpoint: ctx.cfg.baseUrl + "/oauth/authorize",
      token_endpoint: ctx.cfg.baseUrl + "/oauth/token",
      registration_endpoint: ctx.cfg.baseUrl + "/oauth/register",
      revocation_endpoint: ctx.cfg.baseUrl + "/oauth/revoke",
      scopes_supported: [MCP_SCOPE],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    }),
  );

  // Dynamic client registration
  r.on("POST", "/oauth/register", async (req, _p, ctx) => {
    let body: Record<string, unknown>;
    try {
      body = await readJson(req);
    } catch {
      return oauthError("invalid_client_metadata", "Body must be JSON.");
    }
    const uris = body.redirect_uris;
    if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every(validRedirectUri))
      return oauthError("invalid_redirect_uri", "redirect_uris must be https URLs (or http on localhost).");
    const method = typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method : "none";
    if (!["none", "client_secret_post", "client_secret_basic"].includes(method))
      return oauthError("invalid_client_metadata", "token_endpoint_auth_method must be none, client_secret_post or client_secret_basic.");
    const name = (typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim() : "An app").slice(0, 80);
    const c = await ctx.store.createOAuthClient({ name, redirect_uris: uris as string[], withSecret: method !== "none" });
    return oauthJson(
      {
        client_id: c.client_id,
        ...(c.client_secret ? { client_secret: c.client_secret, client_secret_expires_at: 0 } : {}),
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: name,
        redirect_uris: uris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: method,
        scope: MCP_SCOPE,
      },
      201,
    );
  });

  // Authorization: Google sign-in first, then the consent page
  r.on("GET", "/oauth/authorize", async (req, _p, ctx) => {
    const url = new URL(req.url);
    const a = await checkAuthorize(ctx, url.searchParams);
    if ("fatal" in a) return textPage(400, a.fatal!);
    if ("error" in a) return a.error!;
    if (ctx.auth?.via !== "session") return redirect("/login?return_to=" + encodeURIComponent(url.pathname + url.search));
    const fields: Record<string, string> = {};
    for (const k of ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "response_type", "scope", "resource"])
      if (url.searchParams.has(k)) fields[k] = url.searchParams.get(k)!;
    const user = ctx.auth.user;
    return new Response(
      consentPage({
        clientName: a.client!.name,
        email: user.email,
        redirectHost: new URL(a.redirectUri!).host,
        fields,
        formsReady: user.scopes.includes("https://www.googleapis.com/auth/forms"),
      }),
      { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "content-security-policy": "frame-ancestors 'none'" } },
    );
  });

  // The consent form posts here (same-origin, cookie session; the app's CSRF guard checks Origin).
  r.on("POST", "/oauth/authorize", async (req, _p, ctx) => {
    const form = new URLSearchParams(await req.text());
    const a = await checkAuthorize(ctx, form);
    if ("fatal" in a) return textPage(400, a.fatal!);
    if ("error" in a) return a.error!;
    if (ctx.auth?.via !== "session") return textPage(401, "Your session ended. Start connecting again.");
    const back = new URL(a.redirectUri!);
    if (a.state) back.searchParams.set("state", a.state);
    if (form.get("decision") !== "allow") {
      back.searchParams.set("error", "access_denied");
      return redirect(back.toString(), {}, 303);
    }
    const code = await ctx.store.createOAuthCode({
      client_id: a.client!.client_id,
      user_id: ctx.auth.user.id,
      redirect_uri: a.redirectUri!,
      code_challenge: a.challenge!,
      scope: a.scope!,
    });
    back.searchParams.set("code", code);
    return redirect(back.toString(), {}, 303);
  });

  // Token endpoint
  r.on("POST", "/oauth/token", async (req, _p, ctx) => {
    const type = req.headers.get("content-type") || "";
    const raw = await req.text();
    let params: URLSearchParams;
    if (type.includes("application/json")) {
      try {
        params = new URLSearchParams(JSON.parse(raw) as Record<string, string>);
      } catch {
        return oauthError("invalid_request", "Body is not valid JSON.");
      }
    } else params = new URLSearchParams(raw);

    // Client authentication: Basic header, or client_id (+ client_secret) in the body.
    let clientId = params.get("client_id") || "";
    let secret = params.get("client_secret") || "";
    const basic = req.headers.get("authorization");
    if (basic?.startsWith("Basic ")) {
      const [id, sec] = Buffer.from(basic.slice(6), "base64").toString().split(":");
      clientId = decodeURIComponent(id || "");
      secret = decodeURIComponent(sec || "");
    }
    const client = clientId ? await ctx.store.getOAuthClient(clientId) : null;
    if (!client || (client.secret_hash && sha256(secret) !== client.secret_hash)) return oauthError("invalid_client", "Client authentication failed.", 401);

    const grantType = params.get("grant_type");
    let grantId: string;
    let refresh: string;
    let scope = MCP_SCOPE;
    if (grantType === "authorization_code") {
      const code = await ctx.store.takeOAuthCode(params.get("code") || "");
      if (!code || code.client_id !== client.client_id) return oauthError("invalid_grant", "The code is invalid, expired or already used.");
      if (code.redirect_uri !== (params.get("redirect_uri") || "")) return oauthError("invalid_grant", "redirect_uri doesn't match the authorization request.");
      const verifier = params.get("code_verifier") || "";
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || pkceChallenge(verifier) !== code.code_challenge)
        return oauthError("invalid_grant", "PKCE verification failed.");
      ({ grantId, refresh } = await ctx.store.createGrant({ client_id: client.client_id, user_id: code.user_id, scope: code.scope }));
      scope = code.scope;
    } else if (grantType === "refresh_token") {
      const rotated = await ctx.store.rotateRefresh(client.client_id, params.get("refresh_token") || "");
      if (!rotated) return oauthError("invalid_grant", "The refresh token is invalid, expired or revoked.");
      ({ grantId, refresh, scope } = rotated);
    } else {
      return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
    }
    const access = await ctx.store.issueAccessToken(grantId, ACCESS_TTL);
    return oauthJson({ access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL, refresh_token: refresh, scope });
  });

  // Revocation (always 200, per RFC 7009)
  r.on("POST", "/oauth/revoke", async (req, _p, ctx) => {
    const token = new URLSearchParams(await req.text()).get("token");
    if (token) await ctx.store.revokeToken(token);
    return new Response(null, { status: 200 });
  });
}
