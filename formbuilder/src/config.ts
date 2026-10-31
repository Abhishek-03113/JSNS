export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  // Create and read Google Forms (what the executor script does as the user).
  "https://www.googleapis.com/auth/forms",
  // Apps Script API: create/update script projects and deployments in the user's Drive.
  "https://www.googleapis.com/auth/script.projects",
  "https://www.googleapis.com/auth/script.deployments",
] as const;

/** Scopes without which the app cannot run Apps Script for the user. */
export const REQUIRED_SCOPES = ["https://www.googleapis.com/auth/forms"];

export interface Config {
  port: number;
  baseUrl: string;
  googleClientId: string;
  googleClientSecret: string;
  sessionSecret: string;
  /** Script ID (or deployment ID) of the API-executable executor script. */
  executorScriptId: string;
  /** postgres:// URL, e.g. the Supabase pooler connection string. */
  databaseUrl: string;
  corsOrigins: string[];
  allowedEmails: string[];
  sessionDays: number;
  google: {
    authUrl: string;
    tokenUrl: string;
    userinfoUrl: string;
    revokeUrl: string;
    scriptApiBase: string;
  };
}

function list(v: string | undefined): string[] {
  return (v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const port = Number(env.PORT || 3000);
  const baseUrl = (env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, "");
  const cfg: Config = {
    port,
    baseUrl,
    googleClientId: env.GOOGLE_CLIENT_ID || "",
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || "",
    sessionSecret: env.SESSION_SECRET || "",
    executorScriptId: env.APPS_SCRIPT_EXECUTOR_ID || "",
    databaseUrl: env.DATABASE_URL || "",
    corsOrigins: list(env.CORS_ORIGINS),
    allowedEmails: list(env.ALLOWED_EMAILS).map((e) => e.toLowerCase()),
    sessionDays: Number(env.SESSION_DAYS || 30),
    google: {
      authUrl: env.GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token",
      userinfoUrl: env.GOOGLE_USERINFO_URL || "https://openidconnect.googleapis.com/v1/userinfo",
      revokeUrl: env.GOOGLE_REVOKE_URL || "https://oauth2.googleapis.com/revoke",
      scriptApiBase: (env.GOOGLE_SCRIPT_API_BASE || "https://script.googleapis.com").replace(/\/$/, ""),
    },
  };
  const missing: string[] = [];
  if (!cfg.googleClientId) missing.push("GOOGLE_CLIENT_ID");
  if (!cfg.googleClientSecret) missing.push("GOOGLE_CLIENT_SECRET");
  if (!cfg.databaseUrl) missing.push("DATABASE_URL");
  if (cfg.sessionSecret.length < 32) missing.push("SESSION_SECRET (at least 32 characters)");
  if (missing.length) throw new Error("Missing configuration: " + missing.join(", ") + ". See .env.example.");
  return cfg;
}
