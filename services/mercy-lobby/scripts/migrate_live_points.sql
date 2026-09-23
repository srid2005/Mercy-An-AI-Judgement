-- mercy-lobby: the hint budget on the register (init.sql only runs on a
-- fresh volume). Adds players.points -- what the engine says a participant
-- had left when their file closed, and the leaderboard's key under
-- 'solved'. Everyone already on the list keeps the full 100 until their
-- outcome comes in, so a board read before anyone has spent a point looks
-- exactly as it did.
--   docker compose exec -T lobby-db psql -v ON_ERROR_STOP=1 -U mercy -d lobby < services/mercy-lobby/scripts/migrate_live_points.sql
-- Idempotent: ADD COLUMN IF NOT EXISTS, safe to run again. There is no
-- per-participant loop here, unlike the game services' migrations: the
-- register is one database the whole event shares (db/init.sql says so),
-- with no `template` and no p_* schemas to walk.
BEGIN;
ALTER TABLE players ADD COLUMN IF NOT EXISTS points INT NOT NULL DEFAULT 100;
COMMIT;
