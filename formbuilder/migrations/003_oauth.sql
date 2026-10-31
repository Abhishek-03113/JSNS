-- OAuth 2.1 authorization server for MCP clients (claude.ai custom connectors).
-- Clients register themselves (RFC 7591), users approve on a consent page, and each approval is a
-- grant holding a rotating refresh token and short-lived access tokens.

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id text PRIMARY KEY,
  secret_hash text,
  name text NOT NULL DEFAULT '',
  redirect_uris jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash text PRIMARY KEY,
  client_id text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  scope text NOT NULL DEFAULT '',
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash text NOT NULL UNIQUE,
  scope text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_grants_user_idx ON oauth_grants(user_id);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  token_hash text PRIMARY KEY,
  grant_id uuid NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_access_tokens_grant_idx ON oauth_access_tokens(grant_id);

ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_access_tokens ENABLE ROW LEVEL SECURITY;
