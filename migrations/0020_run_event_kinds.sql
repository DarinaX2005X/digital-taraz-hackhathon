ALTER TABLE agent_run_events
  DROP CONSTRAINT agent_run_events_kind_check;

ALTER TABLE agent_run_events
  ADD CONSTRAINT agent_run_events_kind_check
  CHECK (kind IN ('run_state','step_state','usage','result','branch_state','projection_changed'));
