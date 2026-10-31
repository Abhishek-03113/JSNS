-- MCQ Form Builder schema. Safe to run more than once.
-- Row level security is switched on with no policies: Supabase's anon/authenticated
-- roles (PostgREST) see nothing; the app connects as the database owner and bypasses RLS.

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub text NOT NULL UNIQUE,
  email text NOT NULL,
  name text NOT NULL DEFAULT '',
  picture text NOT NULL DEFAULT '',
  refresh_token_enc text,
  access_token_enc text,
  access_token_expires_at timestamptz NOT NULL DEFAULT 'epoch',
  scopes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS oauth_states (
  state text PRIMARY KEY,
  verifier text NOT NULL,
  return_to text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  prefix text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

-- One row per Apps Script run: the script that was executed and the form it made.
CREATE TABLE IF NOT EXISTS forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  question_count integer NOT NULL,
  unanswered_count integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL,
  script_source text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'created', 'failed')),
  error text,
  form_id text,
  edit_url text,
  published_url text,
  script_project_id text,
  response_count integer,
  accepting_responses boolean,
  stats_updated_at timestamptz,
  source text NOT NULL DEFAULT 'api',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS forms_user_created_idx ON forms(user_id, created_at DESC);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms ENABLE ROW LEVEL SECURITY;
