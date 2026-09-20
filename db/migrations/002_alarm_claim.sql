ALTER TABLE timer_states
  ADD COLUMN IF NOT EXISTS alarm_claimed BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO schema_migrations (version)
VALUES (2)
ON CONFLICT (version) DO NOTHING;
