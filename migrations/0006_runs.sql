CREATE TABLE agent_runs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES identity_workspaces(id),
  project_id uuid,
  created_by uuid NOT NULL REFERENCES identity_users(id),
  authz_version integer NOT NULL CHECK (authz_version > 0),
  capability_id text NOT NULL CHECK (length(capability_id) BETWEEN 3 AND 100),
  capability_version integer NOT NULL CHECK (capability_version > 0),
  required_scope text NOT NULL CHECK (required_scope IN ('read','edit','approve','export','manage-members','read-confidential')),
  confidential boolean NOT NULL,
  goal text NOT NULL CHECK (length(goal) BETWEEN 1 AND 12000),
  locale text NOT NULL CHECK (locale IN ('ru','kk','en')),
  input_refs jsonb NOT NULL CHECK (jsonb_typeof(input_refs) = 'array' AND jsonb_array_length(input_refs) <= 100),
  request_key_hash text NOT NULL CHECK (request_key_hash ~ '^[a-f0-9]{64}$'),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','waiting_input','review_ready','completed','failed','cancelled')),
  failure_code text,
  execution_epoch integer NOT NULL DEFAULT 0 CHECK (execution_epoch >= 0),
  lease_owner uuid,
  lease_until timestamptz,
  event_sequence bigint NOT NULL DEFAULT 0 CHECK (event_sequence >= 0 AND event_sequence <= 9007199254740991),
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count BETWEEN 0 AND 12),
  step_count integer NOT NULL DEFAULT 0 CHECK (step_count BETWEEN 0 AND 40),
  budget_limit_usd numeric(24,12) NOT NULL DEFAULT 0.5 CHECK (budget_limit_usd > 0 AND budget_limit_usd <= 0.5),
  reserved_usd numeric(24,12) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0 AND reserved_usd <> 'NaN'::numeric),
  spent_usd numeric(24,12) NOT NULL DEFAULT 0 CHECK (spent_usd >= 0 AND spent_usd <> 'NaN'::numeric),
  workflow_run_id text UNIQUE CHECK (length(workflow_run_id) <= 160),
  workflow_state text NOT NULL DEFAULT 'pending' CHECK (workflow_state IN ('pending','dispatching','started','uncertain')),
  workflow_dispatched_at timestamptz,
  started_at timestamptz,
  deadline_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,created_by,request_key_hash),
  FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
  CHECK ((lease_owner IS NULL) = (lease_until IS NULL)),
  CHECK (state = 'running' OR lease_owner IS NULL),
  CHECK ((started_at IS NULL) = (deadline_at IS NULL)),
  CHECK (deadline_at IS NULL OR deadline_at > started_at),
  CHECK ((state IN ('completed','cancelled','failed')) = (finished_at IS NOT NULL))
);
CREATE INDEX agent_runs_queue_idx ON agent_runs(state,created_at,id);
CREATE INDEX agent_runs_scope_idx ON agent_runs(workspace_id,project_id,created_at DESC,id);
CREATE INDEX agent_runs_lease_idx ON agent_runs(lease_until) WHERE state = 'running';

CREATE TABLE agent_run_steps (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES agent_runs(id),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 40),
  action text NOT NULL CHECK (action IN ('read_sources','extract_text','calculate','prepare_document','prepare_design','validate','save','export','continue','process')),
  tool_name text NOT NULL CHECK (length(tool_name) BETWEEN 1 AND 100),
  tool_version integer NOT NULL CHECK (tool_version > 0),
  state text NOT NULL DEFAULT 'planned' CHECK (state IN ('planned','claimed','succeeded','failed','skipped')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  execution_epoch integer,
  failure_code text,
  retryable boolean NOT NULL DEFAULT false,
  result_refs jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(result_refs) = 'array' AND jsonb_array_length(result_refs) <= 40),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id,id),
  UNIQUE(run_id,ordinal),
  CHECK ((state IN ('succeeded','failed','skipped')) = (finished_at IS NOT NULL)),
  CHECK (state <> 'claimed' OR execution_epoch IS NOT NULL)
);

CREATE TABLE agent_run_contexts (
  run_id uuid PRIMARY KEY REFERENCES agent_runs(id),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  state jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(state) = 'object' AND octet_length(state::text) <= 65536),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_tool_receipts (
  run_id uuid NOT NULL,
  step_id uuid NOT NULL,
  tool_call_id text NOT NULL CHECK (length(tool_call_id) BETWEEN 1 AND 128),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  output_hash text NOT NULL CHECK (output_hash ~ '^[a-f0-9]{64}$'),
  result_refs jsonb NOT NULL CHECK (jsonb_typeof(result_refs) = 'array' AND jsonb_array_length(result_refs) <= 40),
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(run_id,step_id,tool_call_id),
  UNIQUE(run_id,step_id,tool_call_id,input_hash),
  FOREIGN KEY(run_id,step_id) REFERENCES agent_run_steps(run_id,id)
);

CREATE TABLE agent_run_usage (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  step_id uuid NOT NULL,
  call_key text NOT NULL CHECK (length(call_key) BETWEEN 1 AND 128),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  workspace_id uuid NOT NULL,
  budget_day date NOT NULL,
  state text NOT NULL CHECK (state IN ('reserved','dispatched','succeeded','released','ambiguous')),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 128),
  endpoint text NOT NULL CHECK (length(endpoint) BETWEEN 1 AND 128),
  pricing_snapshot jsonb NOT NULL CHECK (octet_length(pricing_snapshot::text) <= 16384),
  reserved_usd numeric(24,12) NOT NULL CHECK (reserved_usd >= 0 AND reserved_usd <> 'NaN'::numeric),
  actual_usd numeric(24,12) CHECK (actual_usd >= 0 AND actual_usd <> 'NaN'::numeric),
  provider_request_id text CHECK (length(provider_request_id) <= 160),
  input_tokens integer CHECK (input_tokens >= 0),
  output_tokens integer CHECK (output_tokens >= 0),
  cached_input_tokens integer CHECK (cached_input_tokens IS NULL OR (input_tokens IS NOT NULL AND cached_input_tokens BETWEEN 0 AND input_tokens)),
  lease_epoch integer NOT NULL CHECK (lease_epoch > 0),
  dispatched_at timestamptz,
  reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id,call_key),
  FOREIGN KEY(run_id,step_id) REFERENCES agent_run_steps(run_id,id),
  FOREIGN KEY(workspace_id,run_id) REFERENCES agent_runs(workspace_id,id),
  CHECK ((state = 'succeeded') = (actual_usd IS NOT NULL)),
  CHECK ((state IN ('succeeded','released')) = (reconciled_at IS NOT NULL)),
  CHECK (state <> 'reserved' OR dispatched_at IS NULL),
  CHECK (state NOT IN ('dispatched','succeeded','ambiguous') OR dispatched_at IS NOT NULL)
);
CREATE INDEX agent_run_usage_day_idx ON agent_run_usage(budget_day,workspace_id,state);
CREATE INDEX agent_run_usage_run_idx ON agent_run_usage(run_id,created_at);

CREATE TABLE agent_budget_days (
  scope text NOT NULL CHECK (scope IN ('deployment','workspace')),
  scope_key text NOT NULL CHECK (length(scope_key) BETWEEN 1 AND 80),
  day date NOT NULL,
  reserved_usd numeric(24,12) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0 AND reserved_usd <> 'NaN'::numeric),
  spent_usd numeric(24,12) NOT NULL DEFAULT 0 CHECK (spent_usd >= 0 AND spent_usd <> 'NaN'::numeric),
  PRIMARY KEY(scope,scope_key,day),
  CHECK (scope <> 'deployment' OR scope_key = 'deployment')
);

CREATE TABLE agent_run_events (
  run_id uuid NOT NULL REFERENCES agent_runs(id),
  sequence bigint NOT NULL CHECK (sequence > 0 AND sequence <= 9007199254740991),
  id uuid NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('run_state','step_state','usage','result')),
  payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 16384),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(run_id,sequence)
);
CREATE INDEX agent_run_events_retention_idx ON agent_run_events(created_at);

CREATE TABLE agent_queue_workspaces (
  workspace_id uuid PRIMARY KEY REFERENCES identity_workspaces(id),
  last_served bigint NOT NULL DEFAULT 0 CHECK (last_served >= 0)
);
CREATE TABLE agent_queue_clock (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  sequence bigint NOT NULL DEFAULT 0 CHECK (sequence >= 0)
);
INSERT INTO agent_queue_clock(singleton,sequence) VALUES(true,0);

CREATE TABLE agent_run_operations (
  run_id uuid NOT NULL REFERENCES agent_runs(id),
  actor_id uuid NOT NULL REFERENCES identity_users(id),
  key_hash text NOT NULL CHECK (key_hash ~ '^[a-f0-9]{64}$'),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  kind text NOT NULL CHECK (kind IN ('cancel','resume')),
  result_epoch integer NOT NULL CHECK (result_epoch >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(run_id,actor_id,key_hash)
);
