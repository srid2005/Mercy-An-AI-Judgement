-- mercy-engine: the event clock for a running game (init.sql only runs on a
-- fresh volume). Adds to case_state the four columns the lobby's start,
-- the deadline and the outcome report write -- started_at, deadline,
-- outcome, reported_at -- all NULL on the seeded row, which keeps its
-- verdict: a game in progress carries on, unstarted, until the lobby
-- starts its clock.
--   docker compose exec -T mercy-engine-db psql -v ON_ERROR_STOP=1 -U mercy -d mercy_engine < services/mercy-engine/scripts/migrate_live_clock.sql
-- Idempotent: ADD COLUMN IF NOT EXISTS, safe to run again. Only `public` is
-- touched -- the single-player database. A participant's schema is cloned
-- from `template`, which tenant.js replays from db/init.sql, so the event
-- build never needs this; a `template` built before these columns existed
-- is rebuilt by the event reset (POST /api/internal/reset).
BEGIN;
ALTER TABLE case_state ADD COLUMN IF NOT EXISTS started_at  TIMESTAMPTZ;
ALTER TABLE case_state ADD COLUMN IF NOT EXISTS deadline    TIMESTAMPTZ;
ALTER TABLE case_state ADD COLUMN IF NOT EXISTS outcome     TEXT CHECK (outcome IN ('solved', 'timeout', 'left'));
ALTER TABLE case_state ADD COLUMN IF NOT EXISTS reported_at TIMESTAMPTZ;
COMMIT;
