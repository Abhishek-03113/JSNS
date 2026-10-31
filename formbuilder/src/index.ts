import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

/**
 * Entry point for `bun run start` and for Vercel's Bun runtime, which runs this Bun.serve()
 * server as one function. When configuration is missing the server still starts and answers
 * every request with a 503 that names what to set, instead of crashing on boot.
 */
let fetchHandler: (req: Request) => Promise<Response> | Response;
let port = Number(process.env.PORT || 3000);

try {
  const cfg = loadConfig();
  port = cfg.port;
  const app = await createApp(cfg);
  fetchHandler = app.fetch;
  if (!cfg.executorScriptId) console.warn("APPS_SCRIPT_EXECUTOR_ID is not set: sign-in works, but creating forms will fail until you run `bun run setup:executor`.");
  console.log(`MCQ Form Builder API ready (public URL ${cfg.baseUrl})`);
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  console.error("Not configured:", message);
  fetchHandler = () =>
    Response.json({ error: { code: "not_configured", message } }, { status: 503, headers: { "cache-control": "no-store" } });
}

const server = Bun.serve({ port, fetch: (req) => fetchHandler(req) });
console.log(`Listening on ${server.url}`);
