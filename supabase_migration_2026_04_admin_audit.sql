-- Admin audit log — records every admin action so a breach leaves
-- a trail that survives the attacker's cleanup attempts.
--
-- Apply via Supabase SQL editor OR via
--   psql "$SUPABASE_DB_URL" -f supabase_migration_2026_04_admin_audit.sql

BEGIN;

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id           BIGSERIAL PRIMARY KEY,
  actor_id     UUID,                        -- admin who performed the action
  actor_email  TEXT,                        -- snapshotted so deletion doesn't lose it
  action       TEXT NOT NULL,               -- 'delete_user' | 'set_tier' | 'grant_admin' ...
  target_id    UUID,                        -- affected user (nullable for non-user actions)
  payload      JSONB,                       -- before/after, any relevant context
  ip           INET,
  user_agent   TEXT,
  success      BOOLEAN NOT NULL DEFAULT TRUE,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_actor_idx   ON admin_audit_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx  ON admin_audit_log (target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_action_idx  ON admin_audit_log (action, created_at DESC);

-- RLS: NOBODY reads this from client. Service-role only.
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

-- No SELECT / INSERT / UPDATE / DELETE policies for anon or authenticated.
-- Service-role bypasses RLS entirely (by design). If admin panel ever
-- needs to render this, add a narrow policy:
--   CREATE POLICY "admins read audit" ON admin_audit_log
--     FOR SELECT USING (
--       EXISTS (SELECT 1 FROM user_profiles
--               WHERE id = auth.uid() AND tier = 'admin')
--     );
-- Left off for now: audit log is a forensic artifact, not a live dashboard.

COMMIT;
