/**
 * Pushes apps-script/ to an Apps Script project in the given user's Drive and deploys it as an
 * API Executable, using that user's stored Google sign-in. Run it after signing in to the web app once.
 *
 *   bun run setup:executor --email you@gmail.com
 *   bun run setup:executor --email you@gmail.com --script-id <id> --deployment-id <id>   # push an update
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../src/config.ts";
import { Sealer } from "../src/crypto.ts";
import { Store } from "../src/db.ts";
import { AppsScriptClient, scriptEditorUrl } from "../src/google/appsScript.ts";
import { TokenService } from "../src/google/oauth.ts";

const { values } = parseArgs({
  options: { email: { type: "string" }, "script-id": { type: "string" }, "deployment-id": { type: "string" } },
});
if (!values.email) {
  console.error("Usage: bun run setup:executor --email you@gmail.com [--script-id ID --deployment-id ID]");
  process.exit(1);
}

const cfg = loadConfig();
const store = new Store(cfg.databaseUrl, { max: 1 });
await store.migrate();
const user = await store.getUserByEmail(values.email);
if (!user) {
  console.error(`No user ${values.email}. Sign in to ${cfg.baseUrl} with that Google account first.`);
  process.exit(1);
}

const api = new AppsScriptClient(cfg);
const token = await new TokenService(cfg, store, new Sealer(cfg.sessionSecret)).accessToken(user);
const dir = join(import.meta.dir, "..", "apps-script");
const files = [
  { name: "Code", type: "SERVER_JS" as const, source: await Bun.file(join(dir, "Code.gs")).text() },
  { name: "appsscript", type: "JSON" as const, source: await Bun.file(join(dir, "appsscript.json")).text() },
];

try {
  const scriptId = values["script-id"] || (await api.createProject(token, "MCQ Form Builder executor")).scriptId;
  await api.updateContent(token, scriptId, files);
  const { versionNumber } = await api.createVersion(token, scriptId, "MCQ Form Builder executor " + new Date().toISOString());
  let deploymentId = values["deployment-id"];
  if (deploymentId) await api.updateDeployment(token, scriptId, deploymentId, versionNumber, "API executable");
  else deploymentId = (await api.createDeployment(token, scriptId, versionNumber, "API executable")).deploymentId;

  console.log(`
Executor deployed (version ${versionNumber}).
  Script ID:      ${scriptId}
  Deployment ID:  ${deploymentId}
  Editor:         ${scriptEditorUrl(scriptId)}

Finish the setup (first time only):
  1. Open the editor link, go to Project Settings > Google Cloud Platform (GCP) Project,
     click "Change project" and enter the project NUMBER of the Cloud project that owns
     GOOGLE_CLIENT_ID. scripts.run only works when the script and the OAuth client share a project.
  2. Set APPS_SCRIPT_EXECUTOR_ID=${deploymentId} and restart the server.
  3. Check it: open ${cfg.baseUrl}/api/executor/ping while signed in.
To push a later change to apps-script/, run:
  bun run setup:executor --email ${values.email} --script-id ${scriptId} --deployment-id ${deploymentId}
`);
} catch (e) {
  console.error("Setup failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await store.close();
}
