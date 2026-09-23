-- mercy-engine v5: the hint desk stops refusing.
--
-- The budget is gone. A hundred points spent down to zero meant a participant
-- who had bought five hints was told "not enough points" for the sixth, and
-- an event run against a clock has no use for a hint button that can say no.
-- POST /api/hint now charges every step at its price (5 / 10 / 20) with no
-- ceiling, and what the bill comes to is the leaderboard's key under
-- 'solved', lowest first -- so the price is as real as it was, it just never
-- stops you. This adds that bill to case_state as hint_cost and starts it at
-- what the two ledgers already say each participant has paid: a game in
-- progress carries its spending across, rather than opening the new column at
-- zero as if nothing had been bought.
--   docker compose exec -T mercy-engine-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < services/mercy-engine/scripts/migrate_live_v5_hint_cost.sql
-- Idempotent: safe to run again -- the column is added once, and the bill is
-- re-derived from the ledgers, which is the same number every time because
-- server.js writes the ledger row and the bill in one transaction. Every
-- schema is upgraded ('public', 'template' and every live p_*), so a running
-- event does not need a rebuild.
--
-- `points` stays in the table, untouched, with whatever each participant had
-- left. Nothing reads it any more; dropping a column under a running event
-- buys nothing that ignoring it does not.

DO $mig$ DECLARE sch TEXT; BEGIN
  FOR sch IN SELECT nspname FROM pg_namespace WHERE nspname IN ('public', 'template') OR nspname LIKE 'p\_%' LOOP
    EXECUTE format('SET LOCAL search_path TO %I', sch);
    -- only a schema that is actually one of ours
    CONTINUE WHEN to_regclass('case_state') IS NULL;
    EXECUTE format('ALTER TABLE %I.case_state ADD COLUMN IF NOT EXISTS hint_cost INTEGER NOT NULL DEFAULT 0', sch);
    -- a schema that never saw v2 has no ledger and nothing to carry across;
    -- one that saw v2 but not v3 has the beat ledger only
    CONTINUE WHEN to_regclass('hints_taken') IS NULL;
    IF to_regclass('context_hints_taken') IS NULL THEN
      EXECUTE format($sum$
        UPDATE %I.case_state SET hint_cost = (SELECT COALESCE(sum(cost), 0) FROM %I.hints_taken)
        WHERE id = 1$sum$, sch, sch);
    ELSE
      EXECUTE format($sum$
        UPDATE %I.case_state SET hint_cost = (SELECT COALESCE(sum(cost), 0) FROM %I.hints_taken)
                                          + (SELECT COALESCE(sum(cost), 0) FROM %I.context_hints_taken)
        WHERE id = 1$sum$, sch, sch, sch);
    END IF;
  END LOOP;
END $mig$;
