CREATE TABLE dependency_graphs (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  edges jsonb NOT NULL CHECK (jsonb_typeof(edges)='array' AND jsonb_array_length(edges)<=1000),
  updated_by uuid NOT NULL REFERENCES identity_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,project_id),
  FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
);
CREATE TABLE dependency_operations (
  workspace_id uuid NOT NULL REFERENCES identity_workspaces(id),
  actor_id uuid NOT NULL REFERENCES identity_users(id),
  operation_id uuid NOT NULL,
  operation text NOT NULL,
  body_hash text NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY(workspace_id,actor_id,operation_id)
);
CREATE TABLE dependency_changesets (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 0 CHECK (revision>=0),
  state text NOT NULL CHECK (state IN ('ready','partially-applied','applied','rejected')),
  proposal jsonb NOT NULL CHECK (jsonb_typeof(proposal)='object'),
  accepted_group_ids uuid[] NOT NULL DEFAULT '{}',
  rejected_group_ids uuid[] NOT NULL DEFAULT '{}',
  command_group_id uuid,
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
  FOREIGN KEY(workspace_id,command_group_id) REFERENCES artifact_command_groups(workspace_id,id)
);
CREATE INDEX dependency_changesets_project_idx ON dependency_changesets(workspace_id,project_id,created_at DESC,id DESC);
CREATE TABLE dependency_command_effects (
  workspace_id uuid NOT NULL,
  command_group_id uuid NOT NULL,
  project_id uuid NOT NULL,
  effects jsonb NOT NULL CHECK(jsonb_typeof(effects)='array' AND jsonb_array_length(effects)<=2000),
  PRIMARY KEY(workspace_id,command_group_id,project_id),
  FOREIGN KEY(workspace_id,command_group_id) REFERENCES artifact_command_groups(workspace_id,id),
  FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
);
CREATE FUNCTION dependency_proposal_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.id<>NEW.id OR OLD.workspace_id<>NEW.workspace_id OR OLD.project_id<>NEW.project_id OR OLD.created_by<>NEW.created_by OR OLD.created_at<>NEW.created_at OR OLD.proposal<>NEW.proposal OR NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'changeset proposal is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dependency_changesets_immutable BEFORE UPDATE ON dependency_changesets FOR EACH ROW EXECUTE FUNCTION dependency_proposal_immutable();
