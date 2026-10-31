/**
 * Runs the full app against a fake Google (test/mockGoogle.ts) so the sign-in, dashboard and API can be
 * tried without a Google Cloud project. Needs a Postgres database: DATABASE_URL, or a local default.
 */
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { mockEnv, startMockGoogle } from "../test/mockGoogle.ts";

const port = Number(process.env.PORT || 3000);
const google = startMockGoogle({ email: process.env.MOCK_EMAIL || "teacher@example.com" });
const cfg = loadConfig({
  PORT: String(port),
  BASE_URL: `http://localhost:${port}`,
  GOOGLE_CLIENT_ID: "mock-client",
  GOOGLE_CLIENT_SECRET: "mock-secret",
  SESSION_SECRET: "mock-session-secret-mock-session-secret",
  APPS_SCRIPT_EXECUTOR_ID: "mock-executor",
  DATABASE_URL: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/formbuilder",
  CORS_ORIGINS: process.env.CORS_ORIGINS || "*",
  ...mockEnv(google),
});
const app = await createApp(cfg);
const server = Bun.serve({ port, fetch: app.fetch });
console.log(`Mock mode: app on ${server.url}, fake Google on ${google.url}. Sign-in is automatic.`);
