CREATE TABLE source_details (
  source_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
  FOREIGN KEY(workspace_id,source_id) REFERENCES sources(workspace_id,id)
);

CREATE TABLE source_uploads (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  source_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES identity_users(id),
  operation_id uuid NOT NULL,
  body_hash text NOT NULL CHECK (body_hash ~ '^[a-f0-9]{64}$'),
  expected_revision integer NOT NULL CHECK (expected_revision >= 0),
  reserved_version_id uuid NOT NULL UNIQUE,
  published_version_id uuid,
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 240),
  declared_size integer NOT NULL CHECK (declared_size BETWEEN 1 AND 20971520),
  media_type text NOT NULL,
  format text NOT NULL CHECK (format IN ('text','csv','tsv','xlsx','docx','pdf','png','jpeg','webp')),
  options jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(options)='object'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','uploading','uploaded','processing','ready','partial','failed','cancelled')),
  token_hash text NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  token_expires_at timestamptz NOT NULL,
  lease_until timestamptz,
  original_key text,
  byte_hash text CHECK (byte_hash ~ '^[a-f0-9]{64}$'),
  byte_size integer CHECK (byte_size BETWEEN 1 AND 20971520),
  manifest jsonb CHECK (jsonb_typeof(manifest)='object'),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,actor_id,operation_id),
  UNIQUE(workspace_id,source_id,id),
  FOREIGN KEY(workspace_id,source_id) REFERENCES sources(workspace_id,id),
  FOREIGN KEY(workspace_id,source_id,published_version_id) REFERENCES source_versions(workspace_id,source_id,id),
  CHECK ((original_key IS NULL AND byte_hash IS NULL AND byte_size IS NULL) OR (original_key IS NOT NULL AND byte_hash IS NOT NULL AND byte_size IS NOT NULL)),
  CHECK (status <> 'ready' OR (published_version_id IS NOT NULL AND manifest IS NOT NULL AND original_key IS NOT NULL))
);
CREATE INDEX source_uploads_source_idx ON source_uploads(workspace_id,source_id,created_at DESC,id DESC);
CREATE INDEX source_uploads_cleanup_idx ON source_uploads(status,updated_at,id);

CREATE TABLE source_chunks (
  upload_id uuid NOT NULL REFERENCES source_uploads(id),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  hash text NOT NULL CHECK (hash ~ '^[a-f0-9]{64}$'),
  content jsonb NOT NULL CHECK (jsonb_typeof(content)='object'),
  PRIMARY KEY(upload_id,ordinal)
);

CREATE TABLE source_pages (
  upload_id uuid NOT NULL REFERENCES source_uploads(id),
  page integer NOT NULL CHECK (page BETWEEN 1 AND 100),
  state text NOT NULL CHECK (state IN ('pending','ready','needs-review','failed')),
  run_id uuid,
  diagnostics jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(diagnostics)='array'),
  PRIMARY KEY(upload_id,page)
);
