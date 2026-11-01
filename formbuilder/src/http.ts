import { AppError } from "./errors.ts";
import { statusMessage } from "./web/errorPage.ts";

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

/** Postgres errors that mean "couldn't talk to the database" rather than a bug in a query. */
export function isDatabaseUnavailable(e: unknown): boolean {
  const err = e as { code?: string; errno?: string; message?: string } | null;
  if (!err || typeof err !== "object") return false;
  const msg = String(err.message || "");
  return (
    /^ERR_POSTGRES_(CONNECTION|CONNECTION_CLOSED|CONNECTION_TIMEOUT|IDLE_TIMEOUT|LIFETIME_TIMEOUT|TLS)/.test(String(err.code || "")) ||
    String(err.errno || "").startsWith("08") || // connection exceptions
    String(err.errno || "") === "53300" || // too many connections
    /connection closed|max clients reached|too many connections|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EMAXCONN/i.test(msg)
  );
}

/** JSON error for programs (API, MCP, OAuth). Pages use the HTML versions in web/errorPage.ts. */
export function errorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    return json({ error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } }, e.status);
  }
  if (isDatabaseUnavailable(e)) {
    console.error("Database unavailable:", e);
    return json({ error: { code: "database_unavailable", message: "The database couldn't be reached. Nothing was changed; try again in a moment." } }, 503, { "retry-after": "5" });
  }
  console.error(e);
  return json({ error: { code: "internal", message: statusMessage(500) } }, 500);
}

export function redirect(location: string, headers: Record<string, string> = {}, status = 302): Response {
  return new Response(null, { status, headers: { location, "cache-control": "no-store", ...headers } });
}

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(name: string, value: string, opts: { maxAge?: number; secure: boolean; path?: string }): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path ?? "/"}`,
    "HttpOnly",
    "SameSite=Lax",
    opts.secure ? "Secure" : "",
    opts.maxAge !== undefined ? `Max-Age=${opts.maxAge}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

const MAX_BODY = 1_000_000;

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_BODY) throw new AppError(413, "body_too_large", "Request body is larger than 1 MB.");
  const text = await req.text();
  if (text.length > MAX_BODY) throw new AppError(413, "body_too_large", "Request body is larger than 1 MB.");
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AppError(400, "invalid_json", "Request body is not valid JSON.");
  }
}

export type Handler<C> = (req: Request, params: Record<string, string>, ctx: C) => Promise<Response> | Response;

interface Route<C> {
  method: string;
  re: RegExp;
  keys: string[];
  handler: Handler<C>;
}

/** Tiny path router: "/api/forms/:id" style patterns. */
export class Router<C> {
  private routes: Route<C>[] = [];

  on(method: string, pattern: string, handler: Handler<C>): this {
    const keys: string[] = [];
    const re = new RegExp(
      "^" +
        pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\/:(\w+)/g, (_, k: string) => {
          keys.push(k);
          return "/([^/]+)";
        }) +
        "/?$",
    );
    this.routes.push({ method, re, keys, handler });
    return this;
  }

  match(method: string, path: string): { handler: Handler<C>; params: Record<string, string> } | { allowed: string[] } | null {
    const allowed: string[] = [];
    for (const r of this.routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      if (r.method !== method && !(method === "HEAD" && r.method === "GET")) {
        allowed.push(r.method);
        continue;
      }
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]!)));
      return { handler: r.handler, params };
    }
    return allowed.length ? { allowed } : null;
  }
}
