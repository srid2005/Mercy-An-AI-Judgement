-- mercy-lobby: the hint bill on the register (init.sql only runs on a fresh
-- volume). Adds players.hint_cost -- what the engine says a participant's
-- hints came to when their file closed, and the leaderboard's key under
-- 'solved', lowest first, in place of the budget they had left. A file that
-- closed before this column existed is carried across from that budget: it
-- was spent down from a hundred and never refused past zero, so a hundred
-- minus what was left is exactly what they paid, and the board reads the
-- same the moment this runs as it did the moment before. Everyone still
-- playing opens at 0 until their outcome comes in, which the board does not
-- rank on anyway.
--   docker compose exec -T lobby-db psql -v ON_ERROR_STOP=1 -U mercy -d lobby < services/mercy-lobby/scripts/migrate_live_hint_cost.sql
-- Idempotent: ADD COLUMN IF NOT EXISTS, and the carry-over only touches a
-- closed row still at 0 with a budget below a hundred, so a second run finds
-- nothing to do. There is no per-participant loop here, unlike the game
-- services' migrations: the register is one database the whole event shares
-- (db/init.sql says so), with no `template` and no p_* schemas to walk.
-- `points` stays, unread.
BEGIN;
ALTER TABLE players ADD COLUMN IF NOT EXISTS hint_cost INT NOT NULL DEFAULT 0;
UPDATE players SET hint_cost = 100 - points
 WHERE outcome IS NOT NULL AND hint_cost = 0 AND points < 100;
COMMIT;
