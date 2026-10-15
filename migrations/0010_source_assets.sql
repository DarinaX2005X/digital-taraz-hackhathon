CREATE TABLE source_assets (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  source_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  upload_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES identity_users(id),
  producer_key text NOT NULL CHECK (char_length(producer_key) BETWEEN 1 AND 512),
  byte_hash text NOT NULL CHECK (byte_hash ~ '^[a-f0-9]{64}$'),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  media_type text NOT NULL CHECK (media_type IN ('image/png','image/jpeg','image/webp')),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  storage_key text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','ready')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,source_version_id,producer_key),
  FOREIGN KEY(workspace_id,source_id,source_version_id) REFERENCES source_versions(workspace_id,source_id,id),
  FOREIGN KEY(workspace_id,source_id,upload_id) REFERENCES source_uploads(workspace_id,source_id,id),
  CHECK (width::bigint * height::bigint <= 20000000),
  CHECK (storage_key = workspace_id::text || '/' || id::text || '/original')
);
CREATE INDEX source_assets_upload_idx ON source_assets(workspace_id,upload_id,id);

CREATE FUNCTION source_assets_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.workspace_id <> NEW.workspace_id OR OLD.source_id <> NEW.source_id OR OLD.source_version_id <> NEW.source_version_id OR OLD.upload_id <> NEW.upload_id OR OLD.created_by <> NEW.created_by OR OLD.producer_key <> NEW.producer_key OR OLD.byte_hash <> NEW.byte_hash OR OLD.byte_size <> NEW.byte_size OR OLD.media_type <> NEW.media_type OR OLD.width <> NEW.width OR OLD.height <> NEW.height OR OLD.storage_key <> NEW.storage_key OR OLD.id <> NEW.id OR OLD.created_at <> NEW.created_at OR OLD.state = 'ready' THEN
    RAISE EXCEPTION 'source asset is immutable' USING ERRCODE='23514',CONSTRAINT='source_asset_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER source_assets_immutable BEFORE UPDATE ON source_assets FOR EACH ROW EXECUTE FUNCTION source_assets_guard();
