CREATE TABLE material_collections (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
  kind text NOT NULL CHECK (kind IN ('catalog','prices','history','brand','general')),
  access_class text NOT NULL CHECK (access_class IN ('internal','confidential')),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  mapping jsonb,
  record_count integer NOT NULL DEFAULT 0 CHECK (record_count >= 0),
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
);
CREATE INDEX material_collections_list_idx ON material_collections(workspace_id,project_id,updated_at DESC,id DESC);
CREATE INDEX material_collections_workspace_idx ON material_collections(workspace_id,updated_at DESC,id DESC);

CREATE TABLE material_operations (
  workspace_id uuid NOT NULL REFERENCES identity_workspaces(id),
  actor_id uuid NOT NULL REFERENCES identity_users(id),
  operation_id uuid NOT NULL,
  operation text NOT NULL,
  body_hash text NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY(workspace_id,actor_id,operation_id)
);

CREATE TABLE material_mapping_versions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  collection_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  mapping jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(collection_id,revision),
  UNIQUE(collection_id,id),
  FOREIGN KEY(workspace_id,collection_id) REFERENCES material_collections(workspace_id,id)
);

CREATE TABLE material_imports (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  collection_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES identity_users(id),
  source_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  source_revision integer NOT NULL CHECK (source_revision > 0),
  content_hash text NOT NULL,
  mapping jsonb NOT NULL,
  mapping_hash text NOT NULL,
  expected_revision integer NOT NULL CHECK (expected_revision >= 0),
  status text NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing','preview','applied','cancelled','failed')),
  next_chunk integer NOT NULL DEFAULT 0 CHECK (next_chunk >= 0),
  chunk_count integer NOT NULL CHECK (chunk_count >= 0),
  header_seen boolean NOT NULL DEFAULT false,
  review_revision integer NOT NULL DEFAULT 0 CHECK (review_revision >= 0),
  counts jsonb NOT NULL,
  error_code text,
  applied_revision integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(collection_id,id),
  FOREIGN KEY(workspace_id,collection_id) REFERENCES material_collections(workspace_id,id),
  FOREIGN KEY(workspace_id,source_id,source_version_id) REFERENCES source_versions(workspace_id,source_id,id)
);
CREATE INDEX material_imports_collection_idx ON material_imports(collection_id,created_at DESC,id DESC);
CREATE INDEX material_imports_content_idx ON material_imports(collection_id,content_hash,mapping_hash) WHERE status='applied';

CREATE TABLE material_records (
  id uuid PRIMARY KEY,
  collection_id uuid NOT NULL REFERENCES material_collections(id),
  identity_hash text NOT NULL,
  identity_key text NOT NULL,
  current_revision integer NOT NULL CHECK (current_revision > 0),
  missing boolean NOT NULL DEFAULT false,
  label text NOT NULL,
  cells jsonb NOT NULL,
  row_hash text NOT NULL,
  UNIQUE(collection_id,identity_hash),
  UNIQUE(collection_id,id)
);
CREATE INDEX material_records_page_idx ON material_records(collection_id,id) WHERE missing=false;
CREATE INDEX material_records_search_idx ON material_records USING gin(to_tsvector('simple',label));

CREATE TABLE material_resolutions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  collection_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  kind text NOT NULL CHECK (kind IN ('import','correction','undo')),
  import_id uuid,
  mapping_version_id uuid,
  undo_of uuid REFERENCES material_resolutions(id),
  reason text NOT NULL,
  actor_id uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(collection_id,revision),
  UNIQUE(collection_id,id),
  FOREIGN KEY(workspace_id,collection_id) REFERENCES material_collections(workspace_id,id),
  FOREIGN KEY(collection_id,import_id) REFERENCES material_imports(collection_id,id),
  FOREIGN KEY(collection_id,mapping_version_id) REFERENCES material_mapping_versions(collection_id,id)
);

CREATE TABLE material_record_versions (
  id uuid PRIMARY KEY,
  collection_id uuid NOT NULL,
  record_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  resolution_id uuid NOT NULL,
  missing boolean NOT NULL,
  label text NOT NULL,
  cells jsonb NOT NULL,
  row_hash text NOT NULL,
  UNIQUE(collection_id,record_id,revision),
  FOREIGN KEY(collection_id,record_id) REFERENCES material_records(collection_id,id),
  FOREIGN KEY(collection_id,resolution_id) REFERENCES material_resolutions(collection_id,id)
);
CREATE INDEX material_record_versions_snapshot_idx ON material_record_versions(collection_id,record_id,revision DESC);
CREATE INDEX material_record_versions_resolution_idx ON material_record_versions(collection_id,resolution_id,record_id);

CREATE TABLE material_import_rows (
  import_id uuid NOT NULL REFERENCES material_imports(id),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  record_id uuid NOT NULL,
  provisional_record_id uuid NOT NULL,
  identity_key text,
  identity_hash text,
  label text NOT NULL,
  cells jsonb NOT NULL,
  row_hash text NOT NULL,
  issues jsonb NOT NULL,
  change text NOT NULL DEFAULT 'added' CHECK (change IN ('added','changed','unchanged','missing','ambiguous')),
  excluded boolean NOT NULL DEFAULT false,
  key_override text,
  PRIMARY KEY(import_id,ordinal)
);
CREATE INDEX material_import_rows_key_idx ON material_import_rows(import_id,identity_hash) WHERE excluded=false;
CREATE INDEX material_import_rows_change_idx ON material_import_rows(import_id,change,ordinal);

CREATE TABLE material_import_edits (
  id uuid PRIMARY KEY,
  import_id uuid NOT NULL REFERENCES material_imports(id),
  revision integer NOT NULL CHECK (revision > 0),
  before_rows jsonb NOT NULL,
  after_rows jsonb NOT NULL,
  actor_id uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(import_id,revision)
);
