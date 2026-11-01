import { createApp, type App } from "./application.ts";
import { loadConfig, type Config } from "./config.ts";
import { isDatabaseUnavailable } from "./http.ts";
import { PAGES, wantsHtml } from "./web/errorPage.ts";

/**
 * Entry point for `bun run start` and for Vercel's Bun runtime, which runs this Bun.serve()
 * server as one function.
 *
 * Startup never crashes the server. Missing settings answer every request with a "not set up"
 * page (JSON for API clients). Anything else that stops startup, such as a database that is
 * briefly unreachable, is retried on a later request instead of sticking until the instance is
 * recycled.
 */
const RETRY_MS = 5000;

let cfg: Config | null = null;
let configError: string | null = null;
try {
  cfg = loadConfig();
} catch (e) {
  configError = e instanceof Error ? e.message : String(e);
  console.error("Not configured:", configError);
}

let app: App | null = null;
let starting: Promise<App> | null = null;
let lastFailure: { at: number; error: unknown } | null = null;

function start(): Promise<App> {
  if (app) return Promise.resolve(app);
  if (starting) return starting;
  if (lastFailure && Date.now() - lastFailure.at < RETRY_MS) return Promise.reject(lastFailure.error);
  starting = createApp(cfg!)
    .then((a) => {
      app = a;
      lastFailure = null;
      console.log(`MCQ Form Builder ready (public URL ${cfg!.baseUrl})`);
      return a;
    })
    .catch((e) => {
      lastFailure = { at: Date.now(), error: e };
      console.error("Startup failed (will retry on a later request):", e);
      throw e;
    })
    .finally(() => {
      starting = null;
    });
  return starting;
}

function unavailable(req: Request, kind: "not_configured" | "database_unavailable" | "starting_failed"): Response {
  if (wantsHtml(req)) return kind === "not_configured" ? PAGES.notSetUp() : kind === "database_unavailable" ? PAGES.databaseUnavailable() : PAGES.serverError();
  const message =
    kind === "not_configured"
      ? "The server is missing required settings. Its owner needs to add them."
      : kind === "database_unavailable"
        ? "The database couldn't be reached. Try again in a moment."
        : "The server couldn't start. Try again in a moment.";
  return Response.json({ error: { code: kind, message } }, { status: 503, headers: { "cache-control": "no-store", "retry-after": "5" } });
}

async function handle(req: Request): Promise<Response> {
  if (!cfg) return unavailable(req, "not_configured");
  try {
    return await (await start()).fetch(req);
  } catch (e) {
    return unavailable(req, isDatabaseUnavailable(e) ? "database_unavailable" : "starting_failed");
  }
}

// Start warming up right away so the first request usually finds the app ready.
if (cfg) start().catch(() => {});

const server = Bun.serve({ port: cfg?.port ?? Number(process.env.PORT || 3000), fetch: handle });
console.log(`Listening on ${server.url}`);

// Vercel's Bun runtime takes the server from the default export.
export default server;
