import { SQL } from "bun";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { randomToken, sha256 } from "./crypto.ts";
import type { FormPayload } from "./mcq/script.ts";

export interface User {
  id: string;
  google_sub: string;
  email: string;
  name: string;
  picture: string;
  refresh_token_enc: string | null;
  access_token_enc: string | null;
  access_token_expires_at: Date;
  scopes: string;
  created_at: Date;
  updated_at: Date;
}

export type FormStatus = "pending" | "created" | "failed";

export interface FormRecord {
  id: string;
  user_id: string;
  title: string;
  description: string;
  question_count: number;
  unanswered_count: number;
  payload: FormPayload;
  script_source: string;
  status: FormStatus;
  error: string | null;
  form_id: string | null;
  edit_url: string | null;
  published_url: string | null;
  script_project_id: string | null;
  response_count: number | null;
  accepting_responses: boolean | null;
  stats_updated_at: Date | null;
  source: string;
  created_at: Date;
  updated_at: Date;
}

export interface ApiToken {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  created_at: Date;
  last_used_at: Date | null;
}

const MIGRATIONS_DIR = join(import.meta.dir, "..", "migrations");
const OAUTH_STATE_TTL = "10 minutes";

export class Store {
  readonly sql: SQL;

  /**
   * @param url postgres:// connection string. For Supabase use the pooler URL; prepared statements are
   *            off so the transaction pooler (port 6543) works too.
   */
  constructor(url: string, opts: { max?: number } = {}) {
    this.sql = new SQL({ url, prepare: false, max: opts.max ?? 10 });
  }

  async migrate(): Promise<string[]> {
    const sql = this.sql;
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    await sql`ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY`;
    const done = new Set((await sql`SELECT name FROM schema_migrations`).map((r: { name: string }) => r.name));
    const applied: string[] = [];
    for (const name of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(name)) continue;
      const text = await Bun.file(join(MIGRATIONS_DIR, name)).text();
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`INSERT INTO schema_migrations (name) VALUES (${name})`;
      });
      applied.push(name);
    }
    return applied;
  }

  close() {
    return this.sql.close();
  }

  // Users

  async upsertUser(u: { google_sub: string; email: string; name: string; picture: string }): Promise<User> {
    const [row] = await this.sql`
      INSERT INTO users (google_sub, email, name, picture)
      VALUES (${u.google_sub}, ${u.email}, ${u.name}, ${u.picture})
      ON CONFLICT (google_sub) DO UPDATE SET email = excluded.email, name = excluded.name,
        picture = excluded.picture, updated_at = now()
      RETURNING *`;
    return row as User;
  }

  async getUser(id: string): Promise<User | null> {
    const [row] = await this.sql`SELECT * FROM users WHERE id = ${id}`;
    return (row as User) ?? null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const [row] = await this.sql`SELECT * FROM users WHERE lower(email) = lower(${email})`;
    return (row as User) ?? null;
  }

  async saveTokens(
    userId: string,
    t: { access_token_enc: string; access_token_expires_at: Date; refresh_token_enc?: string | null; scopes?: string },
  ) {
    await this.sql`
      UPDATE users SET access_token_enc = ${t.access_token_enc}, access_token_expires_at = ${t.access_token_expires_at},
        refresh_token_enc = COALESCE(${t.refresh_token_enc ?? null}, refresh_token_enc),
        scopes = COALESCE(${t.scopes ?? null}, scopes), updated_at = now()
      WHERE id = ${userId}`;
  }

  async clearTokens(userId: string) {
    await this.sql`
      UPDATE users SET access_token_enc = NULL, refresh_token_enc = NULL, access_token_expires_at = 'epoch',
        scopes = '', updated_at = now() WHERE id = ${userId}`;
  }

  // OAuth state: PKCE verifier + where to go after login, single use, short lived

  async putOAuthState(state: string, verifier: string, returnTo: string) {
    await this.sql`DELETE FROM oauth_states WHERE created_at < now() - ${OAUTH_STATE_TTL}::interval`;
    await this.sql`INSERT INTO oauth_states (state, verifier, return_to) VALUES (${state}, ${verifier}, ${returnTo})`;
  }

  async takeOAuthState(state: string): Promise<{ verifier: string; return_to: string } | null> {
    const [row] = await this.sql`
      DELETE FROM oauth_states WHERE state = ${state}
      RETURNING verifier, return_to, created_at > now() - ${OAUTH_STATE_TTL}::interval AS fresh`;
    return row && row.fresh ? { verifier: row.verifier, return_to: row.return_to } : null;
  }

  // Sessions: the cookie holds a random id, the database only its hash

  async createSession(userId: string, days: number): Promise<{ token: string }> {
    const token = randomToken(32);
    await this.sql`DELETE FROM sessions WHERE expires_at < now()`;
    await this.sql`
      INSERT INTO sessions (id_hash, user_id, expires_at)
      VALUES (${sha256(token)}, ${userId}, now() + ${days + " days"}::interval)`;
    return { token };
  }

  async userForSession(token: string): Promise<User | null> {
    const [row] = await this.sql`
      SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = ${sha256(token)} AND s.expires_at > now()`;
    return (row as User) ?? null;
  }

  async deleteSession(token: string) {
    await this.sql`DELETE FROM sessions WHERE id_hash = ${sha256(token)}`;
  }

  // API tokens: shown once, stored as a hash

  async createApiToken(userId: string, name: string): Promise<{ token: string; record: ApiToken }> {
    const token = "fbk_" + randomToken(30);
    const [row] = await this.sql`
      INSERT INTO api_tokens (user_id, name, token_hash, prefix)
      VALUES (${userId}, ${name}, ${sha256(token)}, ${token.slice(0, 10)})
      RETURNING id, user_id, name, prefix, created_at, last_used_at`;
    return { token, record: row as ApiToken };
  }

  async listApiTokens(userId: string): Promise<ApiToken[]> {
    return (await this.sql`
      SELECT id, user_id, name, prefix, created_at, last_used_at FROM api_tokens
      WHERE user_id = ${userId} ORDER BY created_at DESC`) as ApiToken[];
  }

  async deleteApiToken(userId: string, id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const rows = await this.sql`DELETE FROM api_tokens WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
    return rows.length > 0;
  }

  async userForApiToken(token: string): Promise<User | null> {
    const [row] = await this.sql`
      WITH t AS (UPDATE api_tokens SET last_used_at = now() WHERE token_hash = ${sha256(token)} RETURNING user_id)
      SELECT u.* FROM t JOIN users u ON u.id = t.user_id`;
    return (row as User) ?? null;
  }

  // Forms

  async insertForm(f: {
    user_id: string;
    title: string;
    description: string;
    question_count: number;
    unanswered_count: number;
    payload: FormPayload;
    script_source: string;
    source: string;
  }): Promise<FormRecord> {
    const [row] = await this.sql`
      INSERT INTO forms (user_id, title, description, question_count, unanswered_count, payload, script_source, status, source)
      VALUES (${f.user_id}, ${f.title}, ${f.description}, ${f.question_count}, ${f.unanswered_count},
        ${JSON.stringify(f.payload)}::jsonb, ${f.script_source}, 'pending', ${f.source})
      RETURNING *`;
    return row as FormRecord;
  }

  async markFormCreated(id: string, r: { form_id: string; edit_url: string; published_url: string }): Promise<FormRecord> {
    const [row] = await this.sql`
      UPDATE forms SET status = 'created', error = NULL, form_id = ${r.form_id}, edit_url = ${r.edit_url},
        published_url = ${r.published_url}, response_count = 0, accepting_responses = true,
        stats_updated_at = now(), updated_at = now()
      WHERE id = ${id} RETURNING *`;
    return row as FormRecord;
  }

  async markFormFailed(id: string, error: string): Promise<FormRecord> {
    const [row] = await this.sql`
      UPDATE forms SET status = 'failed', error = ${error.slice(0, 2000)}, updated_at = now() WHERE id = ${id} RETURNING *`;
    return row as FormRecord;
  }

  async setScriptProject(id: string, scriptProjectId: string) {
    await this.sql`UPDATE forms SET script_project_id = ${scriptProjectId}, updated_at = now() WHERE id = ${id}`;
  }

  async updateStats(userId: string, formId: string, s: { responses: number; accepting: boolean }) {
    await this.sql`
      UPDATE forms SET response_count = ${s.responses}, accepting_responses = ${s.accepting}, stats_updated_at = now()
      WHERE form_id = ${formId} AND user_id = ${userId}`;
  }

  async getForm(userId: string, id: string): Promise<FormRecord | null> {
    if (!isUuid(id)) return null;
    const [row] = await this.sql`SELECT * FROM forms WHERE id = ${id} AND user_id = ${userId}`;
    return (row as FormRecord) ?? null;
  }

  async listForms(userId: string, opts: { limit?: number; offset?: number; status?: FormStatus } = {}): Promise<{ forms: FormRecord[]; total: number }> {
    const limit = Math.min(Math.max(Math.floor(opts.limit ?? 50) || 50, 1), 200);
    const offset = Math.max(Math.floor(opts.offset ?? 0) || 0, 0);
    const status = opts.status ?? null;
    const forms = (await this.sql`
      SELECT * FROM forms WHERE user_id = ${userId} AND (${status}::text IS NULL OR status = ${status})
      ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`) as FormRecord[];
    const [{ n }] = await this.sql`
      SELECT count(*)::int AS n FROM forms WHERE user_id = ${userId} AND (${status}::text IS NULL OR status = ${status})`;
    return { forms, total: n };
  }

  async deleteForm(userId: string, id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const rows = await this.sql`DELETE FROM forms WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
    return rows.length > 0;
  }
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
