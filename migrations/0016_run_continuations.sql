CREATE TABLE agent_run_continuations (
  workspace_id uuid NOT NULL,
  parent_run_id uuid NOT NULL,
  child_run_id uuid PRIMARY KEY,
  created_by uuid NOT NULL REFERENCES identity_users(id),
  request_key_hash text NOT NULL CHECK (request_key_hash ~ '^[a-f0-9]{64}$'),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  reason text NOT NULL CHECK (reason IN ('deadline', 'goal-change', 'follow-up')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id,parent_run_id) REFERENCES agent_runs(workspace_id,id),
  FOREIGN KEY (workspace_id,child_run_id) REFERENCES agent_runs(workspace_id,id),
  UNIQUE (parent_run_id,created_by,request_key_hash),
  UNIQUE (parent_run_id),
  CHECK (parent_run_id <> child_run_id)
);
CREATE INDEX agent_run_continuations_workspace_idx ON agent_run_continuations(workspace_id,parent_run_id);
