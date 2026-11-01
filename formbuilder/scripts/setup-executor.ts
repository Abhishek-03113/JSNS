/**
 * Command-line version of the dashboard's "Set up form making" (step 1, and step 3 with --check).
 * Usually you don't need it: sign in as the admin and use the dashboard instead.
 *
 *   bun run setup:executor --email you@gmail.com           create or update + deploy the script
 *   bun run setup:executor --email you@gmail.com --check   check it runs (after linking it)
 */
import { parseArgs } from "node:util";
import { loadConfig } from "../src/config.ts";
import { Sealer } from "../src/crypto.ts";
import { Store } from "../src/db.ts";
import { ExecutorService } from "../src/executor.ts";
import { AppsScriptClient } from "../src/google/appsScript.ts";
import { TokenService } from "../src/google/oauth.ts";

const { values } = parseArgs({ options: { email: { type: "string" }, check: { type: "boolean" } } });
if (!values.email) {
  console.error("Usage: bun run setup:executor --email you@gmail.com [--check]");
  process.exit(1);
}

const cfg = loadConfig();
const store = new Store(cfg.databaseUrl, { max: 1 });
await store.migrate();
try {
  const user = await store.getUserByEmail(values.email);
  if (!user) throw new Error(`No user ${values.email}. Sign in to ${cfg.baseUrl} with that Google account first.`);
  const executor = new ExecutorService(cfg, store);
  const api = new AppsScriptClient(cfg, () => executor.id());
  const token = await new TokenService(cfg, store, new Sealer(cfg.sessionSecret)).accessToken(user);
  const s = values.check ? await executor.verify(token, api) : await executor.setup(user, token, api);
  console.log(JSON.stringify(s, null, 2));
  if (!s.ready)
    console.log(`\nNext: open ${s.editorUrl}, Project Settings > Change project, enter ${s.projectNumber ?? "your Cloud project number"}, then run again with --check.`);
} catch (e) {
  console.error("Failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await store.close();
}
