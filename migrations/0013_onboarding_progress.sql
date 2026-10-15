CREATE TABLE onboarding_progress (
  user_id uuid NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
  tour_version integer NOT NULL CHECK (tour_version > 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  state text NOT NULL CHECK (state IN ('active', 'skipped', 'completed')),
  completed_steps text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tour_version),
  CHECK (cardinality(completed_steps) <= 6),
  CHECK (completed_steps <@ ARRAY['start','task','materials','edit','history','export']::text[])
);
