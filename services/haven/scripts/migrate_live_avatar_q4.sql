-- haven: Meera's Quill profile photo as her Haven avatar, and the fourth
-- security question (the childhood password, without the year). Applied to
-- the single-player schema and the event's template; participant schemas
-- resolve users and security_questions from template.
--   docker compose exec -T haven-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < services/haven/scripts/migrate_live_avatar_q4.sql
-- Idempotent: safe to run again.
DO $mig$ DECLARE sch TEXT; BEGIN
  FOREACH sch IN ARRAY ARRAY['public', 'template'] LOOP
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = sch) THEN
      EXECUTE format('SET LOCAL search_path TO %I', sch);
      UPDATE users SET avatar_url = '/images/avatars/meera.png' WHERE username = 'meera';
      INSERT INTO security_questions (position, question, hint, answer_normalized) VALUES
        (4, 'I have always used this password, since I was a child -- but for this, use it without the year.',
            'Rahul still teases me about it. Loop knows.', 'neverforget')
      ON CONFLICT (position) DO UPDATE SET question = EXCLUDED.question, hint = EXCLUDED.hint, answer_normalized = EXCLUDED.answer_normalized;
    END IF;
  END LOOP;
END $mig$;
