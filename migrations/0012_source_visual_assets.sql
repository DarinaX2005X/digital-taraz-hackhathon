ALTER TABLE source_uploads DROP CONSTRAINT source_uploads_format_check;
ALTER TABLE source_uploads ADD CONSTRAINT source_uploads_format_check CHECK (format IN ('text','csv','tsv','xlsx','docx','pdf','png','jpeg','webp','ttf','otf','woff'));
ALTER TABLE source_uploads ADD CONSTRAINT source_uploads_font_size_check CHECK (format NOT IN ('ttf','otf','woff') OR declared_size <= 5242880);

ALTER TABLE source_assets DROP CONSTRAINT source_assets_media_type_check;
ALTER TABLE source_assets DROP CONSTRAINT source_assets_byte_size_check;
ALTER TABLE source_assets DROP CONSTRAINT source_assets_width_check;
ALTER TABLE source_assets DROP CONSTRAINT source_assets_height_check;
ALTER TABLE source_assets ALTER COLUMN width DROP NOT NULL;
ALTER TABLE source_assets ALTER COLUMN height DROP NOT NULL;
ALTER TABLE source_assets ADD COLUMN name text NOT NULL DEFAULT '' CHECK (char_length(name) <= 240);
ALTER TABLE source_assets ADD COLUMN kind text NOT NULL DEFAULT 'image' CHECK (kind IN ('image','font'));
ALTER TABLE source_assets ADD COLUMN font_metadata jsonb CHECK (font_metadata IS NULL OR jsonb_typeof(font_metadata)='object');
ALTER TABLE source_assets ADD COLUMN license jsonb NOT NULL DEFAULT '{"permission":"unknown","canEmbed":false}'::jsonb CHECK (jsonb_typeof(license)='object');
ALTER TABLE source_assets ADD CONSTRAINT source_assets_media_type_check CHECK ((kind='image' AND media_type IN ('image/png','image/jpeg','image/webp')) OR (kind='font' AND media_type IN ('font/ttf','font/otf','font/woff')));
ALTER TABLE source_assets ADD CONSTRAINT source_assets_byte_size_check CHECK (byte_size BETWEEN 1 AND 20971520 AND (kind<>'font' OR byte_size<=5242880));
ALTER TABLE source_assets ADD CONSTRAINT source_assets_kind_metadata_check CHECK ((kind='image' AND width>0 AND height>0 AND width IS NOT NULL AND height IS NOT NULL AND font_metadata IS NULL) OR (kind='font' AND width IS NULL AND height IS NULL AND font_metadata IS NOT NULL));
CREATE INDEX source_assets_kind_idx ON source_assets(workspace_id,kind,id) WHERE state='ready';

CREATE OR REPLACE FUNCTION source_assets_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(OLD)-'state') IS DISTINCT FROM (to_jsonb(NEW)-'state') OR OLD.state='ready' OR NEW.state<>'ready' THEN
    RAISE EXCEPTION 'source asset is immutable' USING ERRCODE='23514',CONSTRAINT='source_asset_immutable';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE source_pages ADD COLUMN review_revision integer NOT NULL DEFAULT 0 CHECK (review_revision>=0);
ALTER TABLE source_pages ADD COLUMN original_content jsonb CHECK (original_content IS NULL OR jsonb_typeof(original_content)='object');
ALTER TABLE source_pages ADD COLUMN corrected_content jsonb CHECK (corrected_content IS NULL OR jsonb_typeof(corrected_content)='object');
ALTER TABLE source_pages ADD COLUMN reviewed_at timestamptz;
ALTER TABLE source_pages ADD COLUMN reviewed_by uuid REFERENCES identity_users(id);
CREATE TABLE source_ocr_batches (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, source_id uuid NOT NULL, upload_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES identity_users(id), operation_id uuid NOT NULL, body_hash text NOT NULL CHECK(body_hash ~ '^[a-f0-9]{64}$'),
  source_version_id uuid NOT NULL, byte_hash text NOT NULL CHECK(byte_hash ~ '^[a-f0-9]{64}$'), locale text NOT NULL CHECK(locale IN ('ru','kk','en')),
  pages jsonb NOT NULL CHECK(jsonb_typeof(pages)='array' AND jsonb_array_length(pages) BETWEEN 1 AND 10), request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'), maximum_page_usd text NOT NULL CHECK(char_length(maximum_page_usd)<=30 AND maximum_page_usd ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,12})?$'), run_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,actor_id,operation_id), UNIQUE(workspace_id,upload_id,id),
  FOREIGN KEY(workspace_id,source_id,upload_id) REFERENCES source_uploads(workspace_id,source_id,id)
);
CREATE FUNCTION source_ocr_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(OLD)-'run_id') IS DISTINCT FROM (to_jsonb(NEW)-'run_id') OR (OLD.run_id IS NOT NULL AND OLD.run_id IS DISTINCT FROM NEW.run_id) THEN
    RAISE EXCEPTION 'source recognition batch is immutable' USING ERRCODE='23514',CONSTRAINT='source_ocr_batch_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER source_ocr_batch_immutable BEFORE UPDATE ON source_ocr_batches FOR EACH ROW EXECUTE FUNCTION source_ocr_batch_guard();
ALTER TABLE source_pages ADD COLUMN batch_id uuid REFERENCES source_ocr_batches(id);
ALTER TABLE source_pages ADD CONSTRAINT source_pages_review_check CHECK ((reviewed_at IS NULL AND reviewed_by IS NULL) OR (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND corrected_content IS NOT NULL AND state='ready'));
CREATE INDEX source_pages_run_idx ON source_pages(run_id) WHERE run_id IS NOT NULL;

CREATE FUNCTION source_page_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM source_uploads WHERE id=OLD.upload_id AND published_version_id IS NOT NULL) THEN
    RAISE EXCEPTION 'published source page is immutable' USING ERRCODE='23514',CONSTRAINT='source_page_immutable';
  END IF;
  IF OLD.original_content IS NOT NULL AND OLD.original_content IS DISTINCT FROM NEW.original_content THEN
    RAISE EXCEPTION 'recognized source page is immutable' USING ERRCODE='23514',CONSTRAINT='source_page_raw_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER source_pages_review_immutable BEFORE UPDATE ON source_pages FOR EACH ROW EXECUTE FUNCTION source_page_review_guard();
