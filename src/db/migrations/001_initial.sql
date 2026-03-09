CREATE TABLE IF NOT EXISTS missions (
  mission_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  skill_version_id TEXT NOT NULL,
  risk_tier TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  terminal_at TIMESTAMPTZ NULL,
  data JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS missions_status_updated_idx ON missions (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS mission_steps (
  step_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  step_key TEXT NOT NULL,
  status TEXT NOT NULL,
  available_at TIMESTAMPTZ NOT NULL,
  lease_expires_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS mission_steps_ready_idx ON mission_steps (status, available_at);
CREATE INDEX IF NOT EXISTS mission_steps_mission_idx ON mission_steps (mission_id, updated_at);

CREATE TABLE IF NOT EXISTS approval_requests (
  approval_request_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ NULL,
  data JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS approval_requests_pending_idx ON approval_requests (status, requested_at);

CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  promoted BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS artifacts_mission_idx ON artifacts (mission_id, created_at);

CREATE TABLE IF NOT EXISTS events (
  sequence BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  mission_id TEXT NULL,
  step_id TEXT NULL,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  plane TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  ts TIMESTAMPTZ NOT NULL,
  payload_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS events_mission_seq_idx ON events (mission_id, sequence);

CREATE TABLE IF NOT EXISTS skill_versions (
  skill_version_id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL,
  lane_mode TEXT NOT NULL,
  data JSONB NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS skill_versions_skill_version_idx ON skill_versions (skill_id, version);

CREATE TABLE IF NOT EXISTS conversation_messages (
  message_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS conversation_messages_created_idx ON conversation_messages (created_at DESC);

CREATE TABLE IF NOT EXISTS user_preferences (
  preference_key TEXT PRIMARY KEY,
  updated_at TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS mission_summary_view (
  mission_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  operator_action_needed BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_queue_view (
  approval_request_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS overview_health_view (
  view_key TEXT PRIMARY KEY,
  updated_at TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS projection_watermarks (
  projection_name TEXT PRIMARY KEY,
  last_event_sequence BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
