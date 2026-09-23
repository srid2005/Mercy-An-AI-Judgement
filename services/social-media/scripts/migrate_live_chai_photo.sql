-- Loop: the alibi post (SOC-050, Vikram's late-night chai) has its photograph.
--   docker compose exec -T social-media-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < services/social-media/scripts/migrate_live_chai_photo.sql
-- Idempotent: safe to run again.
DO $mig$ DECLARE sch TEXT; BEGIN
  FOR sch IN SELECT nspname FROM pg_namespace WHERE nspname IN ('public', 'template') OR nspname LIKE 'p\_%' LOOP
    EXECUTE format('SET LOCAL search_path TO %I', sch);
    IF to_regclass('posts') IS NOT NULL THEN
      UPDATE posts SET image_url = '/images/posts/chai-night.jpg' WHERE image_url = '/images/posts/chai-night.svg';
    END IF;
  END LOOP;
END $mig$;
