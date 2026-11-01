import type { Config } from "../config.ts";
import { AppError } from "../errors.ts";
import type { FormPayload } from "../mcq/script.ts";

export interface CreatedForm {
  formId: string;
  title: string;
  editUrl: string;
  publishedUrl: string;
  /** forms.gle short link for students; empty when Google didn't give one. */
  shortUrl?: string;
  questionCount: number;
}

export interface FormStat {
  formId: string;
  ok: boolean;
  title?: string;
  responses?: number;
  accepting?: boolean;
  error?: string;
}

interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: { errorMessage?: string; errorType?: string; scriptStackTraceElements?: { function?: string; lineNumber?: number }[] }[];
  };
}

function apiError(status: number, body: GoogleErrorBody, what: string): AppError {
  const msg = body.error?.message || `HTTP ${status}`;
  if (/has not enabled the Apps Script API|Apps Script API has not been used/i.test(msg)) {
    const userSetting = /User has not enabled/i.test(msg);
    return new AppError(
      403,
      userSetting ? "apps_script_api_disabled_for_user" : "apps_script_api_disabled_for_project",
      userSetting
        ? "Turn on the Google Apps Script API for your account at https://script.google.com/home/usersettings, then try again."
        : "The Apps Script API is not enabled in this app's Google Cloud project.",
      { google: msg },
    );
  }
  if (status === 401) return new AppError(401, "reauth_required", "Google rejected the sign-in. Sign in again.", { google: msg });
  if (status === 404) return new AppError(502, "executor_not_found", `${what}: the Apps Script project or deployment was not found.`, { google: msg });
  if (status === 403)
    return new AppError(
      403,
      "google_permission_denied",
      `${what}: Google refused the request. Check that the executor is deployed as an API Executable in the same Cloud project as the OAuth client.`,
      { google: msg },
    );
  return new AppError(502, "google_api_error", `${what}: ${msg}`, { google: msg });
}

export class AppsScriptClient {
  constructor(private cfg: Config) {}

  private async call<T>(token: string, method: string, path: string, body?: unknown, what = "Apps Script API"): Promise<T> {
    const res = await fetch(this.cfg.google.scriptApiBase + path, {
      method,
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as T & GoogleErrorBody;
    if (!res.ok) throw apiError(res.status, json, what);
    return json;
  }

  /** scripts.run on the executor. Runs as the user who owns `token`. */
  async run<T>(token: string, fn: string, parameters: unknown[]): Promise<T> {
    if (!this.cfg.executorScriptId)
      throw new AppError(503, "executor_not_configured", "APPS_SCRIPT_EXECUTOR_ID is not set. Run `bun run setup:executor` first.");
    const out = await this.call<{ done?: boolean; response?: { result?: T }; error?: GoogleErrorBody["error"] }>(
      token,
      "POST",
      `/v1/scripts/${encodeURIComponent(this.cfg.executorScriptId)}:run`,
      { function: fn, parameters, devMode: false },
      `Running ${fn}`,
    );
    if (out.error) {
      const d = out.error.details?.[0];
      const at = d?.scriptStackTraceElements?.[0];
      throw new AppError(
        422,
        "script_error",
        `${fn} failed in Apps Script: ${d?.errorMessage || out.error.message || "unknown error"}`,
        { errorType: d?.errorType, at: at ? `${at.function}:${at.lineNumber}` : undefined },
      );
    }
    return out.response?.result as T;
  }

  async createForm(token: string, payload: FormPayload): Promise<CreatedForm> {
    const r = await this.run<CreatedForm>(token, "createMcqQuiz", [JSON.stringify(payload)]);
    if (!r || !r.formId || !r.editUrl) throw new AppError(502, "script_bad_result", "The executor script returned no form. Is the deployed version current?");
    return r;
  }

  async formStats(token: string, formIds: string[]): Promise<FormStat[]> {
    if (!formIds.length) return [];
    const r = await this.run<FormStat[]>(token, "getFormStats", [JSON.stringify(formIds)]);
    return Array.isArray(r) ? r : [];
  }

  ping(token: string) {
    return this.run<{ ok: boolean; user: string; at: string }>(token, "ping", []);
  }

  // Apps Script projects (script.projects / script.deployments scopes)

  createProject(token: string, title: string): Promise<{ scriptId: string }> {
    return this.call(token, "POST", "/v1/projects", { title }, "Creating the Apps Script project");
  }

  updateContent(token: string, scriptId: string, files: { name: string; type: "SERVER_JS" | "JSON"; source: string }[]) {
    return this.call(token, "PUT", `/v1/projects/${encodeURIComponent(scriptId)}/content`, { files }, "Uploading the script");
  }

  createVersion(token: string, scriptId: string, description: string): Promise<{ versionNumber: number }> {
    return this.call(token, "POST", `/v1/projects/${encodeURIComponent(scriptId)}/versions`, { description }, "Creating a script version");
  }

  createDeployment(token: string, scriptId: string, versionNumber: number, description: string): Promise<{ deploymentId: string }> {
    return this.call(
      token,
      "POST",
      `/v1/projects/${encodeURIComponent(scriptId)}/deployments`,
      { versionNumber, manifestFileName: "appsscript", description },
      "Deploying the script",
    );
  }

  updateDeployment(token: string, scriptId: string, deploymentId: string, versionNumber: number, description: string) {
    return this.call(
      token,
      "PUT",
      `/v1/projects/${encodeURIComponent(scriptId)}/deployments/${encodeURIComponent(deploymentId)}`,
      { deploymentConfig: { versionNumber, manifestFileName: "appsscript", description } },
      "Updating the deployment",
    );
  }
}

export const scriptEditorUrl = (scriptId: string) => `https://script.google.com/d/${scriptId}/edit`;

/** Manifest for a standalone copy of a form's script saved to the user's Drive. */
export const STANDALONE_MANIFEST = JSON.stringify(
  { timeZone: "Etc/UTC", runtimeVersion: "V8", exceptionLogging: "STACKDRIVER", oauthScopes: ["https://www.googleapis.com/auth/forms"] },
  null,
  2,
);
