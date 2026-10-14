CREATE TABLE projects (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES identity_workspaces(id),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
  goal text CHECK (goal IS NULL OR length(goal) <= 12000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','trashed')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by uuid NOT NULL REFERENCES identity_users(id),
  creation_key uuid NOT NULL,
  creation_body_hash text NOT NULL CHECK (creation_body_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id,id),
  CONSTRAINT projects_creation_key UNIQUE (workspace_id,created_by,creation_key)
);
CREATE INDEX projects_workspace_updated_idx ON projects(workspace_id,updated_at,id);
ALTER TABLE identity_project_grants ADD CONSTRAINT identity_project_grants_project_fk
  FOREIGN KEY (workspace_id,project_id) REFERENCES projects(workspace_id,id);

CREATE TABLE sources (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES identity_workspaces(id), project_id uuid NOT NULL,
  access_class text NOT NULL DEFAULT 'internal' CHECK (access_class IN ('internal','confidential')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','ready','unavailable','trashed')),
  current_version_id uuid, current_revision integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES identity_users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id,id),
  CONSTRAINT sources_project_fk FOREIGN KEY (workspace_id,project_id) REFERENCES projects(workspace_id,id),
  CONSTRAINT sources_head_check CHECK ((current_version_id IS NULL AND current_revision = 0 AND state <> 'ready') OR (current_version_id IS NOT NULL AND current_revision > 0))
);
CREATE INDEX sources_project_idx ON sources(workspace_id,project_id,id);
CREATE TABLE source_versions (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, source_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0), snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid NOT NULL REFERENCES identity_users(id), created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_versions_source_id_key UNIQUE (workspace_id,source_id,id),
  CONSTRAINT source_versions_source_revision_key UNIQUE (workspace_id,source_id,revision),
  CONSTRAINT source_versions_head_key UNIQUE (workspace_id,source_id,id,revision),
  CONSTRAINT source_versions_source_fk FOREIGN KEY (workspace_id,source_id) REFERENCES sources(workspace_id,id)
);
ALTER TABLE sources ADD CONSTRAINT sources_current_version_fk FOREIGN KEY (workspace_id,id,current_version_id,current_revision)
  REFERENCES source_versions(workspace_id,source_id,id,revision) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE artifact_chunks (
  workspace_id uuid NOT NULL REFERENCES identity_workspaces(id), hash text NOT NULL CHECK (hash ~ '^[a-f0-9]{64}$'),
  data jsonb NOT NULL, byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 1048576), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,hash)
);
CREATE TABLE artifact_chunk_edges (
  workspace_id uuid NOT NULL, parent_hash text NOT NULL, child_hash text NOT NULL,
  PRIMARY KEY (workspace_id,parent_hash,child_hash),
  CONSTRAINT artifact_chunk_edges_parent_fk FOREIGN KEY (workspace_id,parent_hash) REFERENCES artifact_chunks(workspace_id,hash) ON DELETE CASCADE,
  CONSTRAINT artifact_chunk_edges_child_fk FOREIGN KEY (workspace_id,child_hash) REFERENCES artifact_chunks(workspace_id,hash),
  CONSTRAINT artifact_chunk_edges_not_self_check CHECK (parent_hash <> child_hash)
);
CREATE TABLE artifact_content_manifests (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, root_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artifact_content_manifests_workspace_id_key UNIQUE (workspace_id,id),
  CONSTRAINT artifact_content_manifests_workspace_hash_key UNIQUE (workspace_id,root_hash),
  CONSTRAINT artifact_content_manifests_reference_key UNIQUE (workspace_id,id,root_hash),
  CONSTRAINT artifact_content_manifests_root_fk FOREIGN KEY (workspace_id,root_hash) REFERENCES artifact_chunks(workspace_id,hash)
);
CREATE TABLE artifacts (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES identity_workspaces(id), project_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('document','table','design','plan')), schema_version integer NOT NULL CHECK (schema_version > 0),
  current_revision integer NOT NULL CHECK (current_revision >= 0), title text NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in-review','approved','archived','trashed')),
  access_class text NOT NULL DEFAULT 'internal' CHECK (access_class IN ('internal','confidential')),
  content_id uuid NOT NULL, content_hash text NOT NULL,
  created_by uuid NOT NULL REFERENCES identity_users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  trashed_at timestamptz, trash_previous_status text,
  UNIQUE (workspace_id,id),
  CONSTRAINT artifacts_project_fk FOREIGN KEY (workspace_id,project_id) REFERENCES projects(workspace_id,id),
  CONSTRAINT artifacts_content_fk FOREIGN KEY (workspace_id,content_id,content_hash) REFERENCES artifact_content_manifests(workspace_id,id,root_hash),
  CONSTRAINT artifacts_trash_check CHECK ((status = 'trashed' AND trashed_at IS NOT NULL AND trash_previous_status IS NOT NULL AND trash_previous_status IN ('draft','in-review','approved','archived')) OR (status <> 'trashed' AND trashed_at IS NULL AND trash_previous_status IS NULL))
);
CREATE INDEX artifacts_project_updated_idx ON artifacts(workspace_id,project_id,updated_at,id);
CREATE INDEX artifacts_trash_idx ON artifacts(workspace_id,trashed_at);
CREATE TABLE artifact_versions (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, artifact_id uuid NOT NULL, revision integer NOT NULL,
  parent_revision integer, content_id uuid NOT NULL, content_hash text NOT NULL, snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  project_id uuid NOT NULL, title text NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
  status text NOT NULL CHECK (status IN ('draft','in-review','approved','archived','trashed')), schema_version integer NOT NULL CHECK (schema_version > 0),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000), author_id uuid NOT NULL REFERENCES identity_users(id),
  input_revisions jsonb NOT NULL CHECK (jsonb_typeof(input_revisions) = 'object'), created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artifact_versions_revision_key UNIQUE (workspace_id,artifact_id,revision),
  CONSTRAINT artifact_versions_workspace_id_key UNIQUE (workspace_id,id),
  CONSTRAINT artifact_versions_artifact_fk FOREIGN KEY (workspace_id,artifact_id) REFERENCES artifacts(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT artifact_versions_content_fk FOREIGN KEY (workspace_id,content_id,content_hash) REFERENCES artifact_content_manifests(workspace_id,id,root_hash),
  CONSTRAINT artifact_versions_project_fk FOREIGN KEY (workspace_id,project_id) REFERENCES projects(workspace_id,id),
  CONSTRAINT artifact_versions_revision_check CHECK (revision >= 0 AND (parent_revision IS NULL OR parent_revision < revision)),
  CONSTRAINT artifact_versions_parent_fk FOREIGN KEY (workspace_id,artifact_id,parent_revision) REFERENCES artifact_versions(workspace_id,artifact_id,revision) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE artifacts ADD CONSTRAINT artifacts_current_revision_fk FOREIGN KEY (workspace_id,id,current_revision)
  REFERENCES artifact_versions(workspace_id,artifact_id,revision) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE artifact_version_pins (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, artifact_id uuid NOT NULL, revision integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('branch','export','retained')), retainer_id uuid NOT NULL, holding_artifact_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artifact_version_pins_retainer_key UNIQUE (workspace_id,kind,retainer_id,artifact_id,revision),
  CONSTRAINT artifact_version_pins_version_fk FOREIGN KEY (workspace_id,artifact_id,revision) REFERENCES artifact_versions(workspace_id,artifact_id,revision),
  CONSTRAINT artifact_version_pins_holder_fk FOREIGN KEY (workspace_id,holding_artifact_id) REFERENCES artifacts(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE artifact_command_groups (
  workspace_id uuid NOT NULL REFERENCES identity_workspaces(id), id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES identity_users(id),
  body_hash text NOT NULL CHECK (body_hash ~ '^[a-f0-9]{64}$'), origin text NOT NULL CHECK (origin IN ('human','ai','import')),
  action text NOT NULL DEFAULT 'apply' CHECK (action IN ('apply','undo','redo')), reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000), changeset_id uuid,
  committed_revisions jsonb NOT NULL CHECK (jsonb_typeof(committed_revisions) = 'object'), is_active boolean NOT NULL DEFAULT true,
  undone_by_group_id uuid, undoes_group_id uuid, redoes_group_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,id),
  CONSTRAINT artifact_command_groups_undone_by_fk FOREIGN KEY (workspace_id,undone_by_group_id) REFERENCES artifact_command_groups(workspace_id,id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT artifact_command_groups_undoes_fk FOREIGN KEY (workspace_id,undoes_group_id) REFERENCES artifact_command_groups(workspace_id,id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT artifact_command_groups_redoes_fk FOREIGN KEY (workspace_id,redoes_group_id) REFERENCES artifact_command_groups(workspace_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX artifact_command_groups_recent_idx ON artifact_command_groups(workspace_id,created_at,id);
CREATE TABLE artifact_commands (
  workspace_id uuid NOT NULL, id uuid NOT NULL, group_id uuid NOT NULL, artifact_id uuid NOT NULL,
  base_revision integer NOT NULL, revision integer NOT NULL, operations jsonb NOT NULL, inverse_operations jsonb NOT NULL, before_hashes jsonb NOT NULL, after_hashes jsonb NOT NULL,
  PRIMARY KEY (workspace_id,id),
  CONSTRAINT artifact_commands_group_artifact_key UNIQUE (workspace_id,group_id,artifact_id),
  CONSTRAINT artifact_commands_group_fk FOREIGN KEY (workspace_id,group_id) REFERENCES artifact_command_groups(workspace_id,id),
  CONSTRAINT artifact_commands_artifact_fk FOREIGN KEY (workspace_id,artifact_id) REFERENCES artifacts(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT artifact_commands_revision_fk FOREIGN KEY (workspace_id,artifact_id,revision) REFERENCES artifact_versions(workspace_id,artifact_id,revision) ON DELETE CASCADE,
  CONSTRAINT artifact_commands_revision_check CHECK (base_revision >= 0 AND revision = base_revision + 1),
  CONSTRAINT artifact_commands_arrays_check CHECK (jsonb_typeof(operations) = 'array' AND jsonb_typeof(inverse_operations) = 'array' AND jsonb_typeof(before_hashes) = 'object' AND jsonb_typeof(after_hashes) = 'object')
);
CREATE INDEX artifact_commands_history_idx ON artifact_commands(workspace_id,artifact_id,revision);
CREATE TABLE artifact_operation_receipts (
  workspace_id uuid NOT NULL REFERENCES identity_workspaces(id), actor_id uuid NOT NULL REFERENCES identity_users(id), operation_id uuid NOT NULL,
  kind text NOT NULL, body_hash text NOT NULL CHECK (body_hash ~ '^[a-f0-9]{64}$'), result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,actor_id,operation_id)
);
CREATE TABLE artifact_tombstones (
  workspace_id uuid NOT NULL REFERENCES identity_workspaces(id), artifact_id uuid NOT NULL, deleted_by uuid NOT NULL REFERENCES identity_users(id), deleted_at timestamptz NOT NULL DEFAULT now(),
  cleanup_state text NOT NULL DEFAULT 'pending' CHECK (cleanup_state IN ('pending','complete')), cleanup_attempts integer NOT NULL DEFAULT 0 CHECK (cleanup_attempts >= 0), cleanup_after timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,artifact_id)
);
CREATE INDEX artifact_tombstones_cleanup_idx ON artifact_tombstones(cleanup_state,cleanup_after);
CREATE TABLE workspace_event_heads (
  workspace_id uuid PRIMARY KEY REFERENCES identity_workspaces(id), cursor bigint NOT NULL DEFAULT 0, retained_after bigint NOT NULL DEFAULT 0,
  CONSTRAINT workspace_event_heads_cursor_check CHECK (cursor >= retained_after AND retained_after >= 0)
);
CREATE TABLE workspace_events (
  workspace_id uuid NOT NULL REFERENCES identity_workspaces(id), cursor bigint NOT NULL,
  project_id uuid NOT NULL, access_class text NOT NULL DEFAULT 'internal' CHECK (access_class IN ('internal','confidential')),
  kind text NOT NULL, object_id uuid NOT NULL, revision integer NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,cursor),
  CONSTRAINT workspace_events_project_fk FOREIGN KEY (workspace_id,project_id) REFERENCES projects(workspace_id,id),
  CONSTRAINT workspace_events_cursor_check CHECK (cursor > 0 AND revision >= 0),
  CONSTRAINT workspace_events_payload_check CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 32768)
);
CREATE INDEX workspace_events_retention_idx ON workspace_events(created_at);

CREATE FUNCTION artifact_reject_immutable_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'versioned content is immutable' USING ERRCODE='23514', CONSTRAINT='artifact_content_immutable';
END;
$$;
CREATE TRIGGER source_versions_immutable BEFORE UPDATE ON source_versions FOR EACH ROW EXECUTE FUNCTION artifact_reject_immutable_update();
CREATE TRIGGER artifact_chunks_immutable BEFORE UPDATE ON artifact_chunks FOR EACH ROW EXECUTE FUNCTION artifact_reject_immutable_update();
CREATE TRIGGER artifact_chunk_edges_immutable BEFORE UPDATE ON artifact_chunk_edges FOR EACH ROW EXECUTE FUNCTION artifact_reject_immutable_update();
CREATE TRIGGER artifact_content_manifests_immutable BEFORE UPDATE ON artifact_content_manifests FOR EACH ROW EXECUTE FUNCTION artifact_reject_immutable_update();
CREATE TRIGGER artifact_versions_immutable BEFORE UPDATE ON artifact_versions FOR EACH ROW EXECUTE FUNCTION artifact_reject_immutable_update();
CREATE TRIGGER artifact_commands_immutable BEFORE UPDATE ON artifact_commands FOR EACH ROW EXECUTE FUNCTION artifact_reject_immutable_update();
CREATE TRIGGER artifact_operation_receipts_immutable BEFORE UPDATE ON artifact_operation_receipts FOR EACH ROW EXECUTE FUNCTION artifact_reject_immutable_update();
