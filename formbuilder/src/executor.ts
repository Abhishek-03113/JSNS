/**
 * The executor: the Apps Script (apps-script/) that creates forms as each signed-in user.
 *
 * Set up once by the admin from the dashboard, without touching environment variables:
 *   1. setup()  creates the script project in the admin's Drive, uploads the code, deploys it
 *               as an API executable (or updates the existing deployment), and remembers the IDs.
 *   2. The admin links the script to the Google Cloud project that owns the OAuth client
 *      (Apps Script editor → Project Settings → Change project). Google has no API for this.
 *   3. verify() runs ping() through scripts.run. Success means forms can be made.
 * APPS_SCRIPT_EXECUTOR_ID still overrides everything when set.
 */
import { EXECUTOR_FILES } from "./assets.ts";
import type { Config } from "./config.ts";
import type { Store, User } from "./db.ts";
import { AppError } from "./errors.ts";
import { scriptEditorUrl, type AppsScriptClient } from "./google/appsScript.ts";

const KEY = "executor";

interface ExecutorSetting {
  scriptId: string;
  deploymentId: string;
  version: number;
  ownerEmail: string;
  verified: boolean;
  verifiedAt: string | null;
  updatedAt: string;
}

export interface ExecutorStatus {
  /** Forms can be made (an ID is known; for dashboard setups, also verified). */
  ready: boolean;
  source: "env" | "dashboard" | "none";
  step: "create" | "link" | "done";
  scriptId: string | null;
  deploymentId: string | null;
  editorUrl: string | null;
  ownerEmail: string | null;
  verifiedAt: string | null;
  /** The Cloud project number to link the script to (the numeric prefix of the OAuth client ID). */
  projectNumber: string | null;
}

export class ExecutorService {
  private cache: { at: number; value: ExecutorSetting | null } | null = null;

  constructor(
    private cfg: Config,
    private store: Store,
  ) {}

  private async setting(): Promise<ExecutorSetting | null> {
    if (this.cache && Date.now() - this.cache.at < 15_000) return this.cache.value;
    const value = await this.store.getSetting<ExecutorSetting>(KEY);
    this.cache = { at: Date.now(), value };
    return value;
  }

  private async save(v: ExecutorSetting) {
    await this.store.setSetting(KEY, v);
    this.cache = { at: Date.now(), value: v };
  }

  /** The ID scripts.run is called with, or "" when form making isn't set up. */
  async id(): Promise<string> {
    if (this.cfg.executorScriptId) return this.cfg.executorScriptId;
    return (await this.setting())?.deploymentId ?? "";
  }

  projectNumber(): string | null {
    return /^(\d+)-/.exec(this.cfg.googleClientId)?.[1] ?? null;
  }

  async status(): Promise<ExecutorStatus> {
    const projectNumber = this.projectNumber();
    if (this.cfg.executorScriptId)
      return { ready: true, source: "env", step: "done", scriptId: null, deploymentId: this.cfg.executorScriptId, editorUrl: null, ownerEmail: null, verifiedAt: null, projectNumber };
    const s = await this.setting();
    if (!s)
      return { ready: false, source: "none", step: "create", scriptId: null, deploymentId: null, editorUrl: null, ownerEmail: null, verifiedAt: null, projectNumber };
    return {
      ready: s.verified,
      source: "dashboard",
      step: s.verified ? "done" : "link",
      scriptId: s.scriptId,
      deploymentId: s.deploymentId,
      editorUrl: scriptEditorUrl(s.scriptId),
      ownerEmail: s.ownerEmail,
      verifiedAt: s.verifiedAt,
      projectNumber,
    };
  }

  async isAdmin(user: User): Promise<boolean> {
    if (this.cfg.adminEmails.length) return this.cfg.adminEmails.includes(user.email.toLowerCase());
    return (await this.store.firstUserId()) === user.id;
  }

  /** Step 1: create (or update) the script and its API-executable deployment in the admin's Drive. */
  async setup(admin: User, token: string, api: AppsScriptClient): Promise<ExecutorStatus> {
    if (this.cfg.executorScriptId)
      throw new AppError(409, "executor_from_env", "The executor is set by APPS_SCRIPT_EXECUTOR_ID on the server. Remove that variable to manage it here.");
    const existing = await this.setting();
    // Only the account that owns the script can update it.
    const reuse = existing && existing.ownerEmail.toLowerCase() === admin.email.toLowerCase() ? existing : null;
    const scriptId = reuse?.scriptId ?? (await api.createProject(token, "MCQ Form Builder executor")).scriptId;
    await api.updateContent(token, scriptId, [
      { name: "Code", type: "SERVER_JS", source: EXECUTOR_FILES.code },
      { name: "appsscript", type: "JSON", source: EXECUTOR_FILES.manifest },
    ]);
    const { versionNumber } = await api.createVersion(token, scriptId, "MCQ Form Builder executor " + new Date().toISOString());
    let deploymentId = reuse?.deploymentId;
    if (deploymentId) await api.updateDeployment(token, scriptId, deploymentId, versionNumber, "API executable");
    else deploymentId = (await api.createDeployment(token, scriptId, versionNumber, "API executable")).deploymentId;
    await this.save({
      scriptId,
      deploymentId,
      version: versionNumber,
      ownerEmail: admin.email,
      // An update to an already linked script keeps working; a new script must be linked and checked.
      verified: !!reuse?.verified,
      verifiedAt: reuse?.verified ? reuse.verifiedAt : null,
      updatedAt: new Date().toISOString(),
    });
    return this.status();
  }

  /** Step 3: run ping() as the admin. Explains the usual failure (script not linked yet) in plain words. */
  async verify(token: string, api: AppsScriptClient): Promise<ExecutorStatus> {
    const s = await this.setting();
    if (!this.cfg.executorScriptId && !s) throw new AppError(409, "executor_missing", "Create the executor script first (step 1).");
    try {
      await api.ping(token);
    } catch (e) {
      if (e instanceof AppError && ["executor_not_found", "google_permission_denied", "script_error"].includes(e.code)) {
        throw new AppError(
          409,
          "executor_not_linked",
          `Google won't run the script yet. Open the script, go to Project Settings, choose Change project and enter ${this.projectNumber() ?? "your Cloud project number"}, then check again. Google can take a minute to apply the change.`,
          { google: (e.details as { google?: string } | undefined)?.google ?? e.message },
        );
      }
      throw e;
    }
    if (s && !this.cfg.executorScriptId) await this.save({ ...s, verified: true, verifiedAt: new Date().toISOString() });
    return this.status();
  }
}
