CREATE TABLE workspace_project_views (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
  selected_artifact_id uuid,
  last_opened_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, user_id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES projects(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, selected_artifact_id) REFERENCES artifacts(workspace_id, id) ON DELETE SET NULL (selected_artifact_id)
);
CREATE INDEX workspace_project_views_recent_idx ON workspace_project_views(workspace_id, user_id, last_opened_at DESC, project_id DESC);
