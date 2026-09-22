-- mercy-engine: the band memo is on file and runs 2:07, not the 41 s the seed
-- guessed; SW-05's line about it and SW-06's duration follow the recording.
--   docker compose exec -T mercy-engine-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < services/mercy-engine/scripts/migrate_live_memo_length.sql
-- Idempotent: safe to run again.
DO $mig$ DECLARE sch TEXT; BEGIN
  FOR sch IN SELECT nspname FROM pg_namespace WHERE nspname IN ('public', 'template') OR nspname LIKE 'p\_%' LOOP
    EXECUTE format('SET LOCAL search_path TO %I', sch);
    IF to_regclass('evidence_cache') IS NOT NULL THEN
      UPDATE evidence_cache SET content = jsonb_set(content, '{memo_seconds}', '127'),
             summary = replace(summary, 'A 41-second voice memo was recorded at 02:15', 'A two-minute voice memo was recorded at 02:15')
       WHERE evidence_id = 'SW-05';
      UPDATE evidence_cache SET content = jsonb_set(content, '{duration_seconds}', '127'),
             summary = replace(summary, '41 seconds', 'two minutes')
       WHERE evidence_id = 'SW-06';
      -- the cached copies of the Haven entry and of anything the map re-reads
      DELETE FROM evidence_cache WHERE evidence_id = 'HAV-031';
    END IF;
  END LOOP;
END $mig$;
