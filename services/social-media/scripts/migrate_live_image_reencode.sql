-- Loop: the seeded photographs were re-encoded (scripts/optimise-images.py) and
-- every post image left PNG for JPEG -- 46 MB of posts became 3.4 MB, which is
-- most of the first-render lag on event wifi. The files on disk are renamed, so
-- a running deployment's image_url rows have to follow or the feed goes blank.
--   docker compose exec -T social-media-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < services/social-media/scripts/migrate_live_image_reencode.sql
-- Idempotent: safe to run again, and safe to run before or after the older
-- migrate_live_* scripts, which now write .jpg themselves.
--
-- Avatars kept their extension (128x128 PNG is ~27 KB), so users.avatar_url,
-- feed_filler.account_avatar and dm_filler_threads.account_avatar are untouched.
-- Player-created posts carry a data: URL and never match the prefix below.
DO $mig$ DECLARE sch TEXT; BEGIN
  FOR sch IN SELECT nspname FROM pg_namespace WHERE nspname IN ('public', 'template') OR nspname LIKE 'p\_%' LOOP
    EXECUTE format('SET LOCAL search_path TO %I', sch);
    -- posts is cloned per participant; feed_filler is static and lives only in
    -- template, so each table is guarded on its own rather than the schema.
    IF to_regclass('posts') IS NOT NULL THEN
      UPDATE posts SET image_url = left(image_url, length(image_url) - 4) || '.jpg'
       WHERE image_url LIKE '/images/posts/%.png';
    END IF;
    IF to_regclass('feed_filler') IS NOT NULL THEN
      UPDATE feed_filler SET image_url = left(image_url, length(image_url) - 4) || '.jpg'
       WHERE image_url LIKE '/images/posts/%.png';
    END IF;
  END LOOP;
END $mig$;
