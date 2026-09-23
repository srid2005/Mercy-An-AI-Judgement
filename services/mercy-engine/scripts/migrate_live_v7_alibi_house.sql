-- mercy-engine v7: the alibi's house. The story puts Arjun at his BROTHER's
-- house that night, with his mother there (WA-197 "Reached bhaiya's", HAV-031
-- "Arjun's at his brother's", the console's charge card). Two hint bodies said
-- "your mother's house"; a participant reading Wisp would find them at odds
-- with the record. Idempotent: replace() is a no-op once applied. Every schema.
--   docker compose exec -T mercy-engine-db psql -U mercy -d mercy_engine < services/mercy-engine/scripts/migrate_live_v7_alibi_house.sql
DO $mig$ DECLARE sch TEXT; BEGIN
  FOR sch IN SELECT nspname FROM pg_namespace WHERE nspname IN ('public', 'template') OR nspname LIKE 'p\_%' LOOP
    EXECUTE format('SET LOCAL search_path TO %I', sch);
    CONTINUE WHEN to_regclass('hints') IS NULL;
    EXECUTE format($u$UPDATE %I.hints SET body = replace(replace(body, 'your mother''s house', 'your brother''s house'), 'chai at your mother''s', 'chai at your brother''s') WHERE body LIKE '%%mother''s%%'$u$, sch);
    CONTINUE WHEN to_regclass('context_hints') IS NULL;
    EXECUTE format($u$UPDATE %I.context_hints SET body = replace(replace(body, 'your mother''s house', 'your brother''s house'), 'chai at your mother''s', 'chai at your brother''s') WHERE body LIKE '%%mother''s%%'$u$, sch);
  END LOOP;
END $mig$;
