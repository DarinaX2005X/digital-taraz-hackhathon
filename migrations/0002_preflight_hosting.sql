CREATE TABLE preflight_hosting_probes (
  probe_id uuid PRIMARY KEY,
  workflow_run_id text UNIQUE,
  state text NOT NULL DEFAULT 'starting',
  start_deployment_id text NOT NULL,
  resume_deployment_id text,
  before_count integer NOT NULL DEFAULT 0,
  after_count integer NOT NULL DEFAULT 0,
  blob_path text,
  blob_sha256 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT preflight_hosting_state_check CHECK (state IN ('starting', 'waiting', 'completed', 'failed')),
  CONSTRAINT preflight_hosting_before_check CHECK (before_count BETWEEN 0 AND 1),
  CONSTRAINT preflight_hosting_after_check CHECK (after_count BETWEEN 0 AND 1),
  CONSTRAINT preflight_hosting_sha256_check CHECK (blob_sha256 IS NULL OR blob_sha256 ~ '^[a-f0-9]{64}$')
);
CREATE INDEX preflight_hosting_probes_created_at_idx ON preflight_hosting_probes(created_at);
