CREATE TABLE demo_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  definition jsonb NOT NULL CHECK ((definition->>'synthetic' = 'true') IS TRUE),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
