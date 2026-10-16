CREATE TABLE demo_execution_scopes (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  start_key_hash text NOT NULL UNIQUE CHECK(start_key_hash ~ '^[a-f0-9]{64}$'),
  locale text NOT NULL CHECK(locale IN ('ru','kk','en')),
  actor_id uuid NOT NULL REFERENCES identity_users(id),
  workspace_id uuid NOT NULL UNIQUE REFERENCES identity_workspaces(id),
  project_id uuid NOT NULL UNIQUE,
  revision integer NOT NULL DEFAULT 0 CHECK(revision >= 0),
  input_refs jsonb NOT NULL CHECK(jsonb_typeof(input_refs)='array' AND jsonb_array_length(input_refs) BETWEEN 1 AND 100),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT demo_execution_scopes_project_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
  CONSTRAINT demo_execution_scopes_expiry_check CHECK(expires_at>created_at)
);
CREATE INDEX demo_execution_scopes_expiry_idx ON demo_execution_scopes(expires_at);

CREATE TABLE demo_execution_operations (
  session_id uuid NOT NULL REFERENCES demo_execution_scopes(id),
  kind text NOT NULL CHECK(kind IN ('run','copy','resume')),
  key_hash text NOT NULL CHECK(key_hash ~ '^[a-f0-9]{64}$'),
  body_hash text NOT NULL CHECK(body_hash ~ '^[a-f0-9]{64}$'),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=65536),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(session_id,kind,key_hash)
);
