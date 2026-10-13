ALTER TABLE identity_users ADD COLUMN deletion_requested_at timestamptz;

CREATE TABLE identity_workspaces (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  authz_version integer NOT NULL DEFAULT 1 CHECK (authz_version > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deletion-pending')),
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deletion_requested_at timestamptz,
  cleanup_after timestamptz,
  CHECK ((status = 'active' AND deletion_requested_at IS NULL AND cleanup_after IS NULL)
    OR (status = 'deletion-pending' AND deletion_requested_at IS NOT NULL AND cleanup_after IS NOT NULL AND cleanup_after >= deletion_requested_at))
);

CREATE TABLE identity_memberships (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES identity_workspaces(id),
  user_id uuid NOT NULL REFERENCES identity_users(id),
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'reviewer')),
  scopes text[] NOT NULL CHECK (scopes <@ ARRAY['read','edit','approve','export','manage-members','read-confidential']::text[] AND scopes @> ARRAY['read']::text[]),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'revoked')),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id),
  CHECK (role <> 'owner' OR scopes @> ARRAY['read','edit','approve','export','manage-members','read-confidential']::text[]),
  CHECK ((state = 'active' AND revoked_at IS NULL) OR (state = 'revoked' AND revoked_at IS NOT NULL))
);
CREATE INDEX identity_memberships_user_idx ON identity_memberships(user_id, state);

-- The workspace row serializes concurrent ownership changes; the deferred check
-- also allows creating a workspace and its first owner in a single transaction.
CREATE FUNCTION identity_require_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE workspace uuid;
BEGIN
  IF TG_TABLE_NAME = 'identity_workspaces' THEN workspace := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN workspace := OLD.workspace_id;
  ELSE workspace := NEW.workspace_id;
  END IF;
  PERFORM id FROM identity_workspaces WHERE id = workspace FOR UPDATE;
  IF EXISTS (SELECT 1 FROM identity_workspaces WHERE id = workspace AND status = 'active')
     AND NOT EXISTS (SELECT 1 FROM identity_memberships WHERE workspace_id = workspace AND state = 'active' AND role = 'owner') THEN
    RAISE EXCEPTION 'active workspace requires an owner' USING ERRCODE = '23514', CONSTRAINT = 'identity_workspace_owner_required';
  END IF;
  IF TG_TABLE_NAME = 'identity_memberships' AND TG_OP = 'UPDATE' THEN
    IF OLD.workspace_id <> NEW.workspace_id THEN
      RAISE EXCEPTION 'membership workspace is immutable' USING ERRCODE = '23514', CONSTRAINT = 'identity_membership_workspace_immutable';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER identity_workspace_owner_required AFTER INSERT OR UPDATE ON identity_workspaces DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION identity_require_owner();
CREATE CONSTRAINT TRIGGER identity_membership_owner_required AFTER INSERT OR UPDATE OR DELETE ON identity_memberships DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION identity_require_owner();

CREATE TABLE identity_project_grants (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  scopes text[] NOT NULL CHECK (scopes <@ ARRAY['read','edit','approve','export','manage-members','read-confidential']::text[] AND scopes @> ARRAY['read']::text[]),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, user_id),
  FOREIGN KEY (workspace_id, user_id) REFERENCES identity_memberships(workspace_id, user_id)
);

CREATE TABLE identity_invitations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES identity_workspaces(id),
  created_by uuid NOT NULL REFERENCES identity_users(id),
  email text NOT NULL CHECK (email = lower(email) AND length(email) <= 254),
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'reviewer')),
  scopes text[] NOT NULL CHECK (scopes <@ ARRAY['read','edit','approve','export','manage-members','read-confidential']::text[] AND scopes @> ARRAY['read']::text[]),
  locale text NOT NULL CHECK (locale IN ('ru', 'kk', 'en')),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  token_nonce uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  accepted_by uuid REFERENCES identity_users(id),
  accepted_at timestamptz,
  delivery_state text NOT NULL DEFAULT 'pending' CHECK (delivery_state IN ('pending', 'sending', 'sent', 'uncertain')),
  delivery_id uuid NOT NULL,
  send_epoch integer NOT NULL DEFAULT 0 CHECK (send_epoch >= 0),
  send_lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (role <> 'owner' OR scopes @> ARRAY['read','edit','approve','export','manage-members','read-confidential']::text[]),
  CHECK ((status = 'accepted' AND accepted_by IS NOT NULL AND accepted_at IS NOT NULL) OR (status <> 'accepted' AND accepted_by IS NULL AND accepted_at IS NULL))
);
CREATE UNIQUE INDEX identity_invitations_pending_key ON identity_invitations(workspace_id, email) WHERE status = 'pending';
CREATE INDEX identity_invitations_expiry_idx ON identity_invitations(expires_at) WHERE status = 'pending';

CREATE TABLE identity_operations (
  key_hash text PRIMARY KEY CHECK (key_hash ~ '^[a-f0-9]{64}$'),
  actor_id uuid NOT NULL REFERENCES identity_users(id),
  workspace_id uuid REFERENCES identity_workspaces(id),
  kind text NOT NULL,
  body_hash text NOT NULL CHECK (body_hash ~ '^[a-f0-9]{64}$'),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX identity_operations_expiry_idx ON identity_operations(expires_at);

CREATE TABLE identity_deletion_requests (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES identity_users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  cleanup_after timestamptz NOT NULL,
  CHECK (cleanup_after >= requested_at)
);
CREATE INDEX identity_deletion_requests_cleanup_idx ON identity_deletion_requests(cleanup_after);
