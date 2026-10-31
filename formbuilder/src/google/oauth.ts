import { GOOGLE_SCOPES, REQUIRED_SCOPES, type Config } from "../config.ts";
import type { Sealer } from "../crypto.ts";
import type { Store, User } from "../db.ts";
import { AppError } from "../errors.ts";

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export function authorizeUrl(cfg: Config, state: string, challenge: string, loginHint?: string): string {
  const u = new URL(cfg.google.authUrl);
  u.search = new URLSearchParams({
    client_id: cfg.googleClientId,
    redirect_uri: cfg.baseUrl + "/auth/google/callback",
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    // consent every time so Google always returns a refresh token and the full scope screen
    prompt: "consent select_account",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...(loginHint ? { login_hint: loginHint } : {}),
  }).toString();
  return u.toString();
}

async function tokenRequest(cfg: Config, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(cfg.google.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.googleClientId, client_secret: cfg.googleClientSecret, ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    const reauth = json.error === "invalid_grant";
    throw new AppError(
      reauth ? 401 : 502,
      reauth ? "reauth_required" : "google_token_error",
      reauth
        ? "Google no longer accepts this sign-in. Sign in again."
        : "Google token request failed: " + (json.error_description || json.error || res.status),
    );
  }
  return json;
}

export function exchangeCode(cfg: Config, code: string, verifier: string) {
  return tokenRequest(cfg, {
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: cfg.baseUrl + "/auth/google/callback",
  });
}

export async function fetchProfile(cfg: Config, accessToken: string): Promise<GoogleProfile> {
  const res = await fetch(cfg.google.userinfoUrl, { headers: { authorization: "Bearer " + accessToken } });
  if (!res.ok) throw new AppError(502, "google_profile_error", "Could not read your Google profile (" + res.status + ").");
  const p = (await res.json()) as GoogleProfile;
  if (!p.sub || !p.email) throw new AppError(502, "google_profile_error", "Google did not return an email address.");
  return p;
}

export async function revoke(cfg: Config, token: string) {
  await fetch(cfg.google.revokeUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined);
}

export function missingScopes(granted: string): string[] {
  const have = new Set(granted.split(/\s+/).filter(Boolean));
  return REQUIRED_SCOPES.filter((s) => !have.has(s));
}

/** Gives out a valid access token for a user, refreshing and re-sealing it when it is about to expire. */
export class TokenService {
  constructor(
    private cfg: Config,
    private store: Store,
    private sealer: Sealer,
  ) {}

  async storeTokens(userId: string, t: TokenResponse) {
    await this.store.saveTokens(userId, {
      access_token_enc: await this.sealer.seal(t.access_token),
      access_token_expires_at: new Date(Date.now() + (t.expires_in || 3600) * 1000),
      refresh_token_enc: t.refresh_token ? await this.sealer.seal(t.refresh_token) : null,
      scopes: t.scope,
    });
  }

  async accessToken(user: User): Promise<string> {
    const missing = missingScopes(user.scopes);
    if (missing.length)
      throw new AppError(403, "scope_missing", "Google permission to manage Forms was not granted. Sign in again and allow every permission.");
    if (user.access_token_enc && new Date(user.access_token_expires_at).getTime() - Date.now() > 60_000) {
      return this.sealer.open(user.access_token_enc);
    }
    if (!user.refresh_token_enc) throw new AppError(401, "reauth_required", "Your Google sign-in has expired. Sign in again.");
    const refresh = await this.sealer.open(user.refresh_token_enc);
    try {
      const t = await tokenRequest(this.cfg, { grant_type: "refresh_token", refresh_token: refresh });
      await this.storeTokens(user.id, t);
      return t.access_token;
    } catch (e) {
      if (e instanceof AppError && e.code === "reauth_required") await this.store.clearTokens(user.id);
      throw e;
    }
  }
}
