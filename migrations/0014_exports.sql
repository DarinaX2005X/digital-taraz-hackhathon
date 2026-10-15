CREATE TABLE export_jobs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES identity_workspaces(id),
  created_by uuid NOT NULL REFERENCES identity_users(id),
  operation_id uuid NOT NULL,
  body_hash text NOT NULL CHECK (body_hash ~ '^[a-f0-9]{64}$'),
  input_manifest jsonb NOT NULL CHECK (jsonb_typeof(input_manifest) = 'object'),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','rendering','partial','ready','failed','cancelled')),
  files jsonb NOT NULL CHECK (jsonb_typeof(files) = 'array'),
  final_manifest jsonb,
  final_hash text CHECK (final_hash ~ '^[a-f0-9]{64}$'),
  lease_id uuid,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(workspace_id,created_by,operation_id),
  UNIQUE(workspace_id,id),
  CHECK ((status='rendering') = (lease_id IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK ((status='ready') = (final_manifest IS NOT NULL AND final_hash IS NOT NULL))
);
CREATE INDEX export_jobs_owner_recent_idx ON export_jobs(workspace_id,created_by,created_at DESC);
CREATE TABLE export_file_cleanup (
  storage_key text PRIMARY KEY,
  workspace_id uuid NOT NULL,
  job_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,job_id) REFERENCES export_jobs(workspace_id,id),
  CHECK (length(storage_key) = 110)
);
CREATE FUNCTION protect_export_manifest() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.input_manifest IS DISTINCT FROM OLD.input_manifest OR NEW.input_hash IS DISTINCT FROM OLD.input_hash OR NEW.body_hash IS DISTINCT FROM OLD.body_hash OR NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Export input is immutable';
  END IF;
  IF OLD.final_manifest IS NOT NULL AND (NEW.final_manifest IS DISTINCT FROM OLD.final_manifest OR NEW.final_hash IS DISTINCT FROM OLD.final_hash OR NEW.files IS DISTINCT FROM OLD.files) THEN
    RAISE EXCEPTION 'Export receipt is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER export_manifest_immutable BEFORE UPDATE ON export_jobs FOR EACH ROW EXECUTE FUNCTION protect_export_manifest();
