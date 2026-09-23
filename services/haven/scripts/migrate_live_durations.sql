-- haven: six diary entries were labelled 30 s in the seed while their films run
-- 10 or 20 s (the originals in source-media/haven-videos-original have the same
-- lengths -- the label was wrong from the start, not changed by the re-encode).
-- The player draws the label from duration_seconds, so a 10 s clip read "0:30".
-- Idempotent: an UPDATE to the same value is a no-op. Every schema is upgraded.
--   docker compose exec -T haven-db psql -U mercy -d haven < services/haven/scripts/migrate_live_durations.sql
DO $mig$ DECLARE sch TEXT; BEGIN
  FOR sch IN SELECT nspname FROM pg_namespace WHERE nspname IN ('public', 'template') OR nspname LIKE 'p\_%' LOOP
    EXECUTE format('SET LOCAL search_path TO %I', sch);
    CONTINUE WHEN to_regclass('entries') IS NULL;
    EXECUTE format('UPDATE %I.entries SET duration_seconds = 10 WHERE evidence_id = ''HAV-022''', sch);
    EXECUTE format('UPDATE %I.entries SET duration_seconds = 20 WHERE evidence_id = ''HAV-025''', sch);
    EXECUTE format('UPDATE %I.entries SET duration_seconds = 10 WHERE evidence_id = ''HAV-027''', sch);
    EXECUTE format('UPDATE %I.entries SET duration_seconds = 20 WHERE evidence_id = ''HAV-028''', sch);
    EXECUTE format('UPDATE %I.entries SET duration_seconds = 20 WHERE evidence_id = ''HAV-029''', sch);
    EXECUTE format('UPDATE %I.entries SET duration_seconds = 20 WHERE evidence_id = ''HAV-030''', sch);
  END LOOP;
END $mig$;
