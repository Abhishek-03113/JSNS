import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const cfg = loadConfig();
const app = await createApp(cfg);
const server = Bun.serve({ port: cfg.port, fetch: app.fetch });

console.log(`MCQ Form Builder API listening on ${server.url} (public URL ${cfg.baseUrl})`);
if (!cfg.executorScriptId) console.warn("APPS_SCRIPT_EXECUTOR_ID is not set: sign-in works, but creating forms will fail until you run `bun run setup:executor`.");

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.stop();
    app.close();
    process.exit(0);
  });
}
