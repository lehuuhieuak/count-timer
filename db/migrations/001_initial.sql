CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS anonymous_users (
  id UUID PRIMARY KEY,
  token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS timer_states (
  user_id UUID PRIMARY KEY REFERENCES anonymous_users(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  up_value_ms BIGINT NOT NULL DEFAULT 0 CHECK (up_value_ms >= 0),
  up_started_at_ms BIGINT CHECK (up_started_at_ms IS NULL OR up_started_at_ms >= 0),
  down_value_ms BIGINT NOT NULL DEFAULT 1500000 CHECK (down_value_ms >= 0),
  down_started_at_ms BIGINT CHECK (down_started_at_ms IS NULL OR down_started_at_ms >= 0),
  duration_ms BIGINT NOT NULL DEFAULT 1500000 CHECK (duration_ms BETWEEN 1000 AND 359999000),
  sound_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  down_run_id UUID NOT NULL,
  completed_run_id UUID
);

CREATE TABLE IF NOT EXISTS browser_tabs (
  user_id UUID NOT NULL REFERENCES anonymous_users(id) ON DELETE CASCADE,
  tab_id TEXT NOT NULL,
  last_seen_at_ms BIGINT NOT NULL CHECK (last_seen_at_ms >= 0),
  closed_at_ms BIGINT CHECK (closed_at_ms IS NULL OR closed_at_ms >= 0),
  PRIMARY KEY (user_id, tab_id)
);

INSERT INTO schema_migrations (version)
VALUES (1)
ON CONFLICT (version) DO NOTHING;
