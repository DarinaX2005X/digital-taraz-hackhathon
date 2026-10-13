CREATE TABLE identity_users (
  id uuid PRIMARY KEY, name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120), email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false, image text, locale text NOT NULL DEFAULT 'ru' CHECK (locale IN ('ru','kk','en')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email = lower(email) AND length(email) <= 254)
);
CREATE TABLE identity_sessions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, ip_address text, user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX identity_sessions_user_idx ON identity_sessions(user_id);
CREATE TABLE identity_accounts (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
  account_id text NOT NULL, provider_id text NOT NULL, password text, access_token text, refresh_token text, id_token text, scope text,
  access_token_expires_at timestamptz, refresh_token_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider_id, account_id)
);
CREATE INDEX identity_accounts_user_idx ON identity_accounts(user_id);
CREATE TABLE identity_verifications (
  id uuid PRIMARY KEY, identifier text NOT NULL UNIQUE, value text NOT NULL, expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE identity_email_tokens (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'), user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE INDEX identity_email_tokens_expiry_idx ON identity_email_tokens(expires_at);
CREATE TABLE identity_intents (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'), browser_hash text NOT NULL, goal text NOT NULL CHECK (length(goal) BETWEEN 1 AND 12000), return_to text NOT NULL,
  idempotency_hash text NOT NULL UNIQUE, body_hash text NOT NULL, claimed_by uuid REFERENCES identity_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX identity_intents_expiry_idx ON identity_intents(expires_at);
CREATE TABLE identity_rate_limits (key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL);
CREATE INDEX identity_rate_limits_expiry_idx ON identity_rate_limits(expires_at);
