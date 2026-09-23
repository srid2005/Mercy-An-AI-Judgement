-- mercy-engine: MERCY sets the number herself now. Every turn of /api/argue
-- returns a verdict and a delta and the standing moves by it, so her own
-- transcript row has to carry both -- a reload reads back the same moves the
-- participant watched the meter make, and the hint engine can see how the
-- recent turns went. checkpoints stop touching guilt_percent; what the beat
-- list reports is the standing as it actually was when the beat fired
-- (guilt_at_hit), not the old script's target, which stays only so the
-- retuning history is readable.
--   docker compose exec -T mercy-engine-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < services/mercy-engine/scripts/migrate_live_v2_ai_meter.sql
-- Idempotent: ADD COLUMN IF NOT EXISTS, safe to run again. Every schema is
-- upgraded -- 'public' (single player), 'template' (what the next
-- participant is cloned from) and every live p_* -- so a running event does
-- not need a rebuild.
DO $mig$ DECLARE sch TEXT; BEGIN
  FOR sch IN SELECT nspname FROM pg_namespace WHERE nspname IN ('public', 'template') OR nspname LIKE 'p\_%' LOOP
    EXECUTE format('SET LOCAL search_path TO %I', sch);
    IF to_regclass('transcript') IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I.transcript ADD COLUMN IF NOT EXISTS verdict TEXT', sch);
      EXECUTE format('ALTER TABLE %I.transcript ADD COLUMN IF NOT EXISTS delta NUMERIC(4,1)', sch);
      -- the CHECK is added separately: a column that already exists keeps
      -- whatever constraint it has, and a re-run must not try to add it twice
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = format('%I.transcript', sch)::regclass AND conname = 'transcript_verdict_check'
      ) THEN
        EXECUTE format(
          'ALTER TABLE %I.transcript ADD CONSTRAINT transcript_verdict_check
             CHECK (verdict IN (''advanced'', ''partial'', ''rejected'', ''contradicted''))', sch);
      END IF;
    END IF;
    IF to_regclass('checkpoints') IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I.checkpoints ADD COLUMN IF NOT EXISTS guilt_at_hit NUMERIC(4,1)', sch);
      -- a beat already hit under the old rules: the script's number is the
      -- only record of where the meter was, so keep reporting that one
      EXECUTE format('UPDATE %I.checkpoints SET guilt_at_hit = guilt_after WHERE hit = true AND guilt_at_hit IS NULL', sch);
    END IF;
  END LOOP;
END $mig$;
