-- mercy-engine: the band memo's audio_url for a running game (init.sql only
-- runs on a fresh volume). Adds the key to SW-06's content; everything else
-- in the row -- the transcript, the items, the timestamp -- stays as it is.
-- The recording is served by city-map (public/audio/SW-06-band-memo.{m4a,
-- mp3,wav} behind GET /audio/SW-06-band-memo), so the URL is the browser's
-- route to that container, absolute, the same as init.sql writes it.
--   docker compose exec -T mercy-engine-db psql -v ON_ERROR_STOP=1 -U mercy -d mercy_engine < services/mercy-engine/scripts/migrate_live_sw06_audio.sql
-- Idempotent: safe to run again. evidence_cache.content is JSONB, so || is
-- a key merge, not a string concatenation; a second run rewrites the same
-- key with the same value. A database without an SW-06 row yet (seeded
-- before the SOS trail) needs scripts/migrate_live_sos.sql first.
BEGIN;
UPDATE evidence_cache
   SET content = content || '{"audio_url":"http://localhost:4011/audio/SW-06-band-memo"}'::jsonb
 WHERE evidence_id = 'SW-06';
COMMIT;
