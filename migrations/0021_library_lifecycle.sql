CREATE TABLE library_source_lifecycle (
  workspace_id uuid NOT NULL,
  source_id uuid NOT NULL,
  metadata_revision integer NOT NULL DEFAULT 1,
  lifecycle_state text NOT NULL DEFAULT 'active',
  restore_state text,
  source_state text NOT NULL,
  trashed_at timestamptz,
  updated_by uuid NOT NULL REFERENCES identity_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT library_source_lifecycle_pkey PRIMARY KEY(workspace_id,source_id),
  CONSTRAINT library_source_lifecycle_source_fk FOREIGN KEY(workspace_id,source_id) REFERENCES sources(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT library_source_lifecycle_revision_check CHECK(metadata_revision BETWEEN 1 AND 2147483647),
  CONSTRAINT library_source_lifecycle_state_check CHECK(lifecycle_state IN ('active','archived','trashed')),
  CONSTRAINT library_source_lifecycle_source_state_check CHECK(source_state IN ('pending','ready','unavailable')),
  CONSTRAINT library_source_lifecycle_trash_check CHECK(
    (lifecycle_state='trashed' AND restore_state IN ('active','archived') AND trashed_at IS NOT NULL)
    OR (lifecycle_state IN ('active','archived') AND restore_state IS NULL AND trashed_at IS NULL)
  )
);
CREATE INDEX library_source_lifecycle_state_idx ON library_source_lifecycle(workspace_id,lifecycle_state,updated_at DESC,source_id DESC);

CREATE TABLE library_collection_lifecycle (
  workspace_id uuid NOT NULL,
  collection_id uuid NOT NULL,
  metadata_revision integer NOT NULL DEFAULT 1,
  lifecycle_state text NOT NULL DEFAULT 'active',
  restore_state text,
  trashed_at timestamptz,
  updated_by uuid NOT NULL REFERENCES identity_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT library_collection_lifecycle_pkey PRIMARY KEY(workspace_id,collection_id),
  CONSTRAINT library_collection_lifecycle_collection_fk FOREIGN KEY(workspace_id,collection_id) REFERENCES material_collections(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT library_collection_lifecycle_revision_check CHECK(metadata_revision BETWEEN 1 AND 2147483647),
  CONSTRAINT library_collection_lifecycle_state_check CHECK(lifecycle_state IN ('active','archived','trashed')),
  CONSTRAINT library_collection_lifecycle_trash_check CHECK(
    (lifecycle_state='trashed' AND restore_state IN ('active','archived') AND trashed_at IS NOT NULL)
    OR (lifecycle_state IN ('active','archived') AND restore_state IS NULL AND trashed_at IS NULL)
  )
);
CREATE INDEX library_collection_lifecycle_state_idx ON library_collection_lifecycle(workspace_id,lifecycle_state,updated_at DESC,collection_id DESC);

CREATE TABLE library_lifecycle_operations (
  workspace_id uuid NOT NULL REFERENCES identity_workspaces(id),
  actor_id uuid NOT NULL REFERENCES identity_users(id),
  operation_id uuid NOT NULL,
  object_kind text NOT NULL,
  source_id uuid,
  collection_id uuid,
  operation text NOT NULL,
  body_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  CONSTRAINT library_lifecycle_operations_pkey PRIMARY KEY(workspace_id,actor_id,operation_id),
  CONSTRAINT library_lifecycle_operations_source_fk FOREIGN KEY(workspace_id,source_id) REFERENCES sources(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT library_lifecycle_operations_collection_fk FOREIGN KEY(workspace_id,collection_id) REFERENCES material_collections(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT library_lifecycle_operations_object_check CHECK(
    (object_kind='source' AND source_id IS NOT NULL AND collection_id IS NULL)
    OR (object_kind='collection' AND source_id IS NULL AND collection_id IS NOT NULL)
  ),
  CONSTRAINT library_lifecycle_operations_operation_check CHECK(
    operation IN (
      'source.rename','source.move','source.duplicate','source.trash','source.restore',
      'collection.rename','collection.move','collection.duplicate','collection.trash','collection.restore'
    ) AND split_part(operation,'.',1)=object_kind
  ),
  CONSTRAINT library_lifecycle_operations_hash_check CHECK(body_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT library_lifecycle_operations_result_check CHECK(jsonb_typeof(result)='object'),
  CONSTRAINT library_lifecycle_operations_expiry_check CHECK(expires_at>created_at)
);
CREATE INDEX library_lifecycle_operations_expiry_idx ON library_lifecycle_operations(expires_at);

INSERT INTO library_source_lifecycle(workspace_id,source_id,lifecycle_state,restore_state,source_state,trashed_at,updated_by,updated_at)
SELECT workspace_id,id,
  CASE WHEN state='trashed' THEN 'trashed' ELSE 'active' END,
  CASE WHEN state='trashed' THEN 'active' ELSE NULL END,
  CASE WHEN state='trashed' THEN CASE WHEN current_version_id IS NULL THEN 'unavailable' ELSE 'ready' END ELSE state END,
  CASE WHEN state='trashed' THEN updated_at ELSE NULL END,
  created_by,updated_at
FROM sources;

INSERT INTO library_collection_lifecycle(workspace_id,collection_id,updated_by,updated_at)
SELECT workspace_id,id,created_by,updated_at FROM material_collections;

CREATE FUNCTION library_create_source_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state='trashed' THEN
    RAISE EXCEPTION 'A new source cannot start in trash' USING ERRCODE='23514', CONSTRAINT='library_source_lifecycle_initial_state';
  END IF;
  INSERT INTO library_source_lifecycle(workspace_id,source_id,metadata_revision,lifecycle_state,source_state,updated_by,updated_at)
  VALUES(NEW.workspace_id,NEW.id,1,'active',NEW.state,NEW.created_by,NEW.updated_at);
  RETURN NEW;
END;
$$;
CREATE TRIGGER library_create_source_lifecycle
AFTER INSERT ON sources FOR EACH ROW EXECUTE FUNCTION library_create_source_lifecycle();

CREATE FUNCTION library_sync_source_content_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state<>'trashed' THEN
    UPDATE library_source_lifecycle SET source_state=NEW.state
    WHERE workspace_id=NEW.workspace_id AND source_id=NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER library_sync_source_content_state
AFTER UPDATE OF state ON sources FOR EACH ROW
WHEN (OLD.state IS DISTINCT FROM NEW.state)
EXECUTE FUNCTION library_sync_source_content_state();

CREATE FUNCTION library_create_collection_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO library_collection_lifecycle(workspace_id,collection_id,metadata_revision,lifecycle_state,updated_by,updated_at)
  VALUES(NEW.workspace_id,NEW.id,1,'active',NEW.created_by,NEW.updated_at);
  RETURN NEW;
END;
$$;
CREATE TRIGGER library_create_collection_lifecycle
AFTER INSERT ON material_collections FOR EACH ROW EXECUTE FUNCTION library_create_collection_lifecycle();
