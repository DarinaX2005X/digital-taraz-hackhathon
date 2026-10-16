CREATE TABLE business_contexts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES identity_workspaces(id),
  project_id uuid,
  scope text NOT NULL,
  owner_id uuid NOT NULL REFERENCES identity_users(id),
  title text NOT NULL,
  current_revision integer NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_contexts_workspace_id_id_key UNIQUE(workspace_id,id),
  CONSTRAINT business_contexts_project_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
  CONSTRAINT business_contexts_scope_check CHECK(scope IN ('workspace','project')),
  CONSTRAINT business_contexts_project_scope_check CHECK((scope='workspace' AND project_id IS NULL) OR (scope='project' AND project_id IS NOT NULL)),
  CONSTRAINT business_contexts_title_check CHECK(length(title) BETWEEN 1 AND 240),
  CONSTRAINT business_contexts_revision_check CHECK(current_revision>0),
  CONSTRAINT business_contexts_status_check CHECK(status IN ('active','archived'))
);
CREATE INDEX business_contexts_workspace_status_updated_idx ON business_contexts(workspace_id,status,updated_at,id);
CREATE INDEX business_contexts_project_idx ON business_contexts(workspace_id,project_id,updated_at,id);

CREATE TABLE business_context_versions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  context_id uuid NOT NULL,
  revision integer NOT NULL,
  scope text NOT NULL,
  project_id uuid,
  owner_id uuid NOT NULL REFERENCES identity_users(id),
  title text NOT NULL,
  items jsonb NOT NULL,
  brand_kit jsonb NOT NULL,
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_context_versions_revision_key UNIQUE(workspace_id,context_id,revision),
  CONSTRAINT business_context_versions_context_fk FOREIGN KEY(workspace_id,context_id) REFERENCES business_contexts(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT business_context_versions_project_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
  CONSTRAINT business_context_versions_revision_check CHECK(revision>0),
  CONSTRAINT business_context_versions_scope_check CHECK(scope IN ('workspace','project')),
  CONSTRAINT business_context_versions_project_scope_check CHECK((scope='workspace' AND project_id IS NULL) OR (scope='project' AND project_id IS NOT NULL)),
  CONSTRAINT business_context_versions_title_check CHECK(length(title) BETWEEN 1 AND 240),
  CONSTRAINT business_context_versions_items_check CHECK(jsonb_typeof(items)='array' AND octet_length(items::text)<=131072),
  CONSTRAINT business_context_versions_brand_kit_check CHECK(jsonb_typeof(brand_kit)='object' AND octet_length(brand_kit::text)<=131072),
  CONSTRAINT business_context_versions_reason_check CHECK(length(reason) BETWEEN 1 AND 1000)
);
CREATE INDEX business_context_versions_list_idx ON business_context_versions(workspace_id,context_id,revision);

CREATE TABLE artifact_version_comments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  artifact_id uuid NOT NULL,
  artifact_revision integer NOT NULL,
  parent_id uuid,
  target jsonb NOT NULL,
  body text NOT NULL,
  author_id uuid NOT NULL REFERENCES identity_users(id),
  state text NOT NULL DEFAULT 'open',
  resolved_by uuid REFERENCES identity_users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artifact_version_comments_workspace_id_id_key UNIQUE(workspace_id,id),
  CONSTRAINT artifact_version_comments_project_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
  CONSTRAINT artifact_version_comments_version_fk FOREIGN KEY(workspace_id,artifact_id,artifact_revision) REFERENCES artifact_versions(workspace_id,artifact_id,revision) ON DELETE CASCADE,
  CONSTRAINT artifact_version_comments_parent_fk FOREIGN KEY(workspace_id,parent_id) REFERENCES artifact_version_comments(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT artifact_version_comments_revision_check CHECK(artifact_revision>=0),
  CONSTRAINT artifact_version_comments_target_check CHECK(jsonb_typeof(target)='object' AND octet_length(target::text)<=16384),
  CONSTRAINT artifact_version_comments_body_check CHECK(length(body) BETWEEN 1 AND 8000),
  CONSTRAINT artifact_version_comments_state_check CHECK(state IN ('open','resolved')),
  CONSTRAINT artifact_version_comments_resolution_check CHECK((state='open' AND resolved_by IS NULL AND resolved_at IS NULL) OR (state='resolved' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL))
);
CREATE INDEX artifact_version_comments_version_state_created_idx ON artifact_version_comments(workspace_id,artifact_id,artifact_revision,state,created_at,id);
CREATE INDEX artifact_version_comments_author_idx ON artifact_version_comments(author_id,created_at,id);

CREATE TABLE artifact_version_decisions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  artifact_id uuid NOT NULL,
  artifact_revision integer NOT NULL,
  decision text NOT NULL,
  note text NOT NULL DEFAULT '',
  actor_id uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artifact_version_decisions_project_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
  CONSTRAINT artifact_version_decisions_version_fk FOREIGN KEY(workspace_id,artifact_id,artifact_revision) REFERENCES artifact_versions(workspace_id,artifact_id,revision) ON DELETE CASCADE,
  CONSTRAINT artifact_version_decisions_revision_check CHECK(artifact_revision>=0),
  CONSTRAINT artifact_version_decisions_decision_check CHECK(decision IN ('approved','changes_requested')),
  CONSTRAINT artifact_version_decisions_note_check CHECK(length(note)<=8000)
);
CREATE INDEX artifact_version_decisions_version_created_idx ON artifact_version_decisions(workspace_id,artifact_id,artifact_revision,created_at,id);
CREATE INDEX artifact_version_decisions_actor_idx ON artifact_version_decisions(actor_id,created_at,id);

CREATE TABLE work_rules (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES identity_workspaces(id),
  project_id uuid NOT NULL,
  owner_id uuid NOT NULL REFERENCES identity_users(id),
  title text NOT NULL,
  state text NOT NULL DEFAULT 'paused',
  current_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_rules_workspace_id_id_key UNIQUE(workspace_id,id),
  CONSTRAINT work_rules_project_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
  CONSTRAINT work_rules_title_check CHECK(length(title) BETWEEN 1 AND 240),
  CONSTRAINT work_rules_state_check CHECK(state IN ('enabled','paused','disabled')),
  CONSTRAINT work_rules_current_version_check CHECK(current_version>0)
);
CREATE INDEX work_rules_project_state_updated_idx ON work_rules(workspace_id,project_id,state,updated_at,id);
CREATE INDEX work_rules_owner_idx ON work_rules(owner_id,updated_at,id);

CREATE TABLE work_rule_versions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  version integer NOT NULL,
  definition jsonb NOT NULL,
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_rule_versions_version_key UNIQUE(workspace_id,rule_id,version),
  CONSTRAINT work_rule_versions_rule_fk FOREIGN KEY(workspace_id,rule_id) REFERENCES work_rules(workspace_id,id),
  CONSTRAINT work_rule_versions_version_check CHECK(version>0),
  CONSTRAINT work_rule_versions_definition_check CHECK(jsonb_typeof(definition)='object' AND octet_length(definition::text)<=131072),
  CONSTRAINT work_rule_versions_reason_check CHECK(length(reason) BETWEEN 1 AND 1000)
);
CREATE INDEX work_rule_versions_list_idx ON work_rule_versions(workspace_id,rule_id,version);

CREATE TABLE work_occurrences (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  rule_version integer NOT NULL,
  trigger jsonb NOT NULL,
  state text NOT NULL,
  run_id uuid,
  branch_id uuid,
  reason_code text,
  restarted_from uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT work_occurrences_rule_version_id_key UNIQUE(rule_id,rule_version,id),
  CONSTRAINT work_occurrences_project_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
  CONSTRAINT work_occurrences_rule_version_fk FOREIGN KEY(workspace_id,rule_id,rule_version) REFERENCES work_rule_versions(workspace_id,rule_id,version),
  CONSTRAINT work_occurrences_run_fk FOREIGN KEY(workspace_id,run_id) REFERENCES agent_runs(workspace_id,id),
  CONSTRAINT work_occurrences_branch_fk FOREIGN KEY(branch_id) REFERENCES artifacts(id) ON DELETE SET NULL,
  CONSTRAINT work_occurrences_restart_fk FOREIGN KEY(restarted_from) REFERENCES work_occurrences(id),
  CONSTRAINT work_occurrences_rule_version_check CHECK(rule_version>0),
  CONSTRAINT work_occurrences_trigger_check CHECK(jsonb_typeof(trigger)='object' AND octet_length(trigger::text)<=32768),
  CONSTRAINT work_occurrences_state_check CHECK(state IN ('queued','running','waiting_input','paused','review_ready','completed','failed','cancelled')),
  CONSTRAINT work_occurrences_reason_code_check CHECK(reason_code IS NULL OR reason_code ~ '^[a-z][a-z0-9_.-]{0,119}$'),
  CONSTRAINT work_occurrences_completion_check CHECK((state IN ('completed','failed','cancelled'))=(completed_at IS NOT NULL))
);
CREATE INDEX work_occurrences_rule_created_idx ON work_occurrences(workspace_id,rule_id,created_at,id);
CREATE INDEX work_occurrences_state_updated_idx ON work_occurrences(workspace_id,state,updated_at,id);

CREATE TABLE outcome_observations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  occurrence_id uuid,
  run_id uuid,
  artifact_id uuid,
  artifact_revision integer,
  period_start date NOT NULL,
  period_end date NOT NULL,
  metric_key text NOT NULL,
  label text NOT NULL,
  value jsonb NOT NULL,
  evidence jsonb NOT NULL,
  note text NOT NULL DEFAULT '',
  recorded_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outcome_observations_project_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
  CONSTRAINT outcome_observations_occurrence_fk FOREIGN KEY(occurrence_id) REFERENCES work_occurrences(id),
  CONSTRAINT outcome_observations_run_fk FOREIGN KEY(workspace_id,run_id) REFERENCES agent_runs(workspace_id,id),
  CONSTRAINT outcome_observations_artifact_version_fk FOREIGN KEY(workspace_id,artifact_id,artifact_revision) REFERENCES artifact_versions(workspace_id,artifact_id,revision),
  CONSTRAINT outcome_observations_period_check CHECK(period_start<=period_end),
  CONSTRAINT outcome_observations_artifact_pair_check CHECK((artifact_id IS NULL)=(artifact_revision IS NULL)),
  CONSTRAINT outcome_observations_subject_check CHECK(occurrence_id IS NOT NULL OR run_id IS NOT NULL OR artifact_id IS NOT NULL),
  CONSTRAINT outcome_observations_metric_key_check CHECK(metric_key ~ '^[a-z][a-z0-9_.-]{0,119}$'),
  CONSTRAINT outcome_observations_label_check CHECK(length(label) BETWEEN 1 AND 240),
  CONSTRAINT outcome_observations_value_check CHECK(jsonb_typeof(value)='object' AND octet_length(value::text)<=32768),
  CONSTRAINT outcome_observations_evidence_check CHECK(jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=32768),
  CONSTRAINT outcome_observations_note_check CHECK(length(note)<=4000)
);
CREATE INDEX outcome_observations_project_period_idx ON outcome_observations(workspace_id,project_id,period_start,period_end,id);

CREATE TABLE business_continuity_operations (
  workspace_id uuid NOT NULL REFERENCES identity_workspaces(id),
  actor_id uuid NOT NULL REFERENCES identity_users(id),
  operation_id uuid NOT NULL,
  kind text NOT NULL,
  body_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_continuity_operations_pkey PRIMARY KEY(workspace_id,actor_id,operation_id),
  CONSTRAINT business_continuity_operations_kind_check CHECK(kind IN ('context','comment','resolve','decision','project-grant','rule','occurrence','outcome')),
  CONSTRAINT business_continuity_operations_body_hash_check CHECK(body_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT business_continuity_operations_result_check CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=262144)
);
CREATE INDEX business_continuity_operations_created_idx ON business_continuity_operations(workspace_id,created_at,operation_id);
