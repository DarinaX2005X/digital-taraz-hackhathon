CREATE TABLE agent_budget_authorizations (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 100),
  provider text NOT NULL CHECK (provider = 'openrouter'),
  state text NOT NULL CHECK (state IN ('inactive','active','closed')),
  limit_usd numeric(24,12) NOT NULL CHECK (limit_usd > 0 AND limit_usd <= 10),
  reserved_usd numeric(24,12) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0 AND reserved_usd <> 'NaN'::numeric),
  spent_usd numeric(24,12) NOT NULL DEFAULT 0 CHECK (spent_usd >= 0 AND spent_usd <> 'NaN'::numeric),
  key_fingerprint text NOT NULL CHECK (key_fingerprint ~ '^[a-f0-9]{64}$'),
  authority_ref text NOT NULL CHECK (length(authority_ref) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  CHECK (state <> 'active' OR activated_at IS NOT NULL)
);
CREATE UNIQUE INDEX agent_one_active_authorization ON agent_budget_authorizations(provider) WHERE state='active';

ALTER TABLE agent_run_steps ADD COLUMN input_state jsonb NOT NULL DEFAULT '{}'
  CHECK (jsonb_typeof(input_state) = 'object' AND octet_length(input_state::text) <= 65536);
ALTER TABLE agent_run_steps ADD COLUMN input_hash text
  CHECK (input_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE agent_run_usage ADD COLUMN authorization_id text REFERENCES agent_budget_authorizations(id);
ALTER TABLE agent_run_usage ADD COLUMN operation_key text
  CHECK (operation_key ~ '^[A-Za-z0-9_-]{1,90}$');
CREATE INDEX agent_run_usage_authorization_idx ON agent_run_usage(authorization_id,state);
CREATE UNIQUE INDEX agent_model_operation_idx ON agent_run_usage(run_id,step_id,operation_key) WHERE state <> 'released';

CREATE TABLE agent_model_outputs (
  usage_id uuid PRIMARY KEY REFERENCES agent_run_usage(id),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 131072),
  output_hash text NOT NULL CHECK (output_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_model_endpoints (
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 128),
  endpoint text NOT NULL CHECK (length(endpoint) BETWEEN 1 AND 128),
  kind text NOT NULL CHECK (kind IN ('text','image')),
  state text NOT NULL CHECK (state IN ('candidate','enabled','disabled','quarantined')),
  policy_revision integer NOT NULL CHECK (policy_revision > 0),
  pricing_snapshot jsonb NOT NULL CHECK (jsonb_typeof(pricing_snapshot) = 'object' AND octet_length(pricing_snapshot::text) <= 16384),
  pricing_hash text NOT NULL CHECK (pricing_hash ~ '^[a-f0-9]{64}$'),
  proof_state text NOT NULL CHECK (proof_state IN ('unproven','passed')),
  proof_ref text CHECK (length(proof_ref) BETWEEN 1 AND 200),
  quarantine_usage_id uuid REFERENCES agent_run_usage(id),
  quarantined_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (model,endpoint,kind),
  CHECK (state <> 'enabled' OR (proof_state='passed' AND proof_ref IS NOT NULL)),
  CHECK ((state='quarantined') = (quarantine_usage_id IS NOT NULL AND quarantined_at IS NOT NULL))
);

-- Activation is a separate operator action. A fresh database cannot renew a grant.
