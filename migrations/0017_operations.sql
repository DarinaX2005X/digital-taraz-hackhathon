-- Work-resource membership uses a workspace-scoped foreign key. Membership id
-- is already globally unique; this supporting key additionally proves scope.
CREATE UNIQUE INDEX identity_memberships_workspace_id_id_key
  ON identity_memberships(workspace_id, id);

CREATE TABLE work_resources (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES identity_workspaces(id),
  display_name text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  membership_id uuid,
  timezone text NOT NULL,
  access_class text NOT NULL DEFAULT 'internal',
  notes text,
  revision integer NOT NULL DEFAULT 1,
  current_availability_version_id uuid,
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_resources_workspace_id_id_key UNIQUE(workspace_id, id),
  CONSTRAINT work_resources_membership_fk FOREIGN KEY(workspace_id, membership_id) REFERENCES identity_memberships(workspace_id, id),
  CONSTRAINT work_resources_name_check CHECK(length(btrim(display_name)) BETWEEN 1 AND 160),
  CONSTRAINT work_resources_kind_check CHECK(kind IN ('person','equipment','place','other')),
  CONSTRAINT work_resources_status_check CHECK(status IN ('active','archived')),
  CONSTRAINT work_resources_access_check CHECK(access_class IN ('internal','confidential')),
  CONSTRAINT work_resources_timezone_check CHECK(length(timezone) BETWEEN 1 AND 80),
  CONSTRAINT work_resources_revision_check CHECK(revision > 0),
  CONSTRAINT work_resources_notes_check CHECK(notes IS NULL OR length(notes) <= 4000)
);
CREATE INDEX work_resources_list_idx ON work_resources(workspace_id, status, updated_at, id);

CREATE TABLE work_resource_versions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  revision integer NOT NULL,
  display_name text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL,
  current_availability_version_id uuid,
  membership_id uuid,
  timezone text NOT NULL,
  access_class text NOT NULL,
  notes text,
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_resource_versions_resource_revision_key UNIQUE(workspace_id, resource_id, revision),
  CONSTRAINT work_resource_versions_resource_fk FOREIGN KEY(workspace_id, resource_id) REFERENCES work_resources(workspace_id, id),
  CONSTRAINT work_resource_versions_membership_fk FOREIGN KEY(workspace_id, membership_id) REFERENCES identity_memberships(workspace_id, id),
  CONSTRAINT work_resource_versions_revision_check CHECK(revision > 0),
  CONSTRAINT work_resource_versions_name_check CHECK(length(btrim(display_name)) BETWEEN 1 AND 160),
  CONSTRAINT work_resource_versions_kind_check CHECK(kind IN ('person','equipment','place','other')),
  CONSTRAINT work_resource_versions_status_check CHECK(status IN ('active','archived')),
  CONSTRAINT work_resource_versions_access_check CHECK(access_class IN ('internal','confidential'))
);

CREATE TABLE availability_versions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  revision integer NOT NULL,
  timezone text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  verified_at timestamptz,
  note text,
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT availability_versions_workspace_id_id_key UNIQUE(workspace_id, id),
  CONSTRAINT availability_versions_resource_revision_key UNIQUE(workspace_id, resource_id, revision),
  CONSTRAINT availability_versions_resource_fk FOREIGN KEY(workspace_id, resource_id) REFERENCES work_resources(workspace_id, id),
  CONSTRAINT availability_versions_revision_check CHECK(revision > 0),
  CONSTRAINT availability_versions_effective_check CHECK(effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT availability_versions_sources_check CHECK(jsonb_typeof(source_refs) = 'array' AND jsonb_array_length(source_refs) <= 100),
  CONSTRAINT availability_versions_note_check CHECK(note IS NULL OR length(note) <= 4000)
);
CREATE INDEX availability_versions_resource_idx ON availability_versions(workspace_id, resource_id, revision);

CREATE TABLE availability_week_intervals (
  availability_version_id uuid NOT NULL REFERENCES availability_versions(id) ON DELETE CASCADE,
  weekday integer NOT NULL,
  ordinal integer NOT NULL,
  start_minute integer NOT NULL,
  end_minute integer NOT NULL,
  PRIMARY KEY(availability_version_id, weekday, ordinal),
  CONSTRAINT availability_week_intervals_weekday_check CHECK(weekday BETWEEN 1 AND 7),
  CONSTRAINT availability_week_intervals_ordinal_check CHECK(ordinal BETWEEN 0 AND 23),
  CONSTRAINT availability_week_intervals_range_check CHECK(start_minute BETWEEN 0 AND 1439 AND end_minute BETWEEN 1 AND 1440 AND start_minute < end_minute)
);

CREATE TABLE availability_exceptions (
  availability_version_id uuid NOT NULL REFERENCES availability_versions(id) ON DELETE CASCADE,
  date date NOT NULL,
  label text,
  PRIMARY KEY(availability_version_id, date),
  CONSTRAINT availability_exceptions_label_check CHECK(label IS NULL OR length(btrim(label)) BETWEEN 1 AND 240)
);

CREATE TABLE availability_exception_intervals (
  availability_version_id uuid NOT NULL,
  date date NOT NULL,
  ordinal integer NOT NULL,
  start_minute integer NOT NULL,
  end_minute integer NOT NULL,
  PRIMARY KEY(availability_version_id, date, ordinal),
  CONSTRAINT availability_exception_intervals_exception_fk FOREIGN KEY(availability_version_id, date) REFERENCES availability_exceptions(availability_version_id, date) ON DELETE CASCADE,
  CONSTRAINT availability_exception_intervals_ordinal_check CHECK(ordinal BETWEEN 0 AND 23),
  CONSTRAINT availability_exception_intervals_range_check CHECK(start_minute BETWEEN 0 AND 1439 AND end_minute BETWEEN 1 AND 1440 AND start_minute < end_minute)
);

ALTER TABLE work_resources ADD CONSTRAINT work_resources_current_availability_fk
  FOREIGN KEY(workspace_id, current_availability_version_id)
  REFERENCES availability_versions(workspace_id, id);

ALTER TABLE work_resource_versions ADD CONSTRAINT work_resource_versions_current_availability_fk
  FOREIGN KEY(workspace_id, current_availability_version_id)
  REFERENCES availability_versions(workspace_id, id);

CREATE TABLE operations_idempotency (
  workspace_id uuid NOT NULL REFERENCES identity_workspaces(id),
  actor_id uuid NOT NULL REFERENCES identity_users(id),
  operation_id uuid NOT NULL,
  kind text NOT NULL,
  body_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(workspace_id, actor_id, operation_id),
  CONSTRAINT operations_idempotency_kind_check CHECK(length(kind) BETWEEN 1 AND 80),
  CONSTRAINT operations_idempotency_hash_check CHECK(body_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT operations_idempotency_expiry_check CHECK(expires_at > created_at)
);
CREATE INDEX operations_idempotency_expiry_idx ON operations_idempotency(expires_at);

