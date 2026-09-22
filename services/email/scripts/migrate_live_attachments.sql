-- Quill: the eight attachment images arrived; every attachment row points at
-- the JPG instead of the SVG placeholder. Applied to the single-player schema
-- and the event's template; participant schemas copy the attachment tables
-- from template when they are created (existing ones get it too, below).
--   docker compose exec -T email-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < services/email/scripts/migrate_live_attachments.sql
-- Idempotent: safe to run again.
DO $mig$ DECLARE sch TEXT; BEGIN
  FOR sch IN SELECT nspname FROM pg_namespace WHERE nspname IN ('public', 'template') OR nspname LIKE 'p\_%' LOOP
    EXECUTE format('SET LOCAL search_path TO %I', sch);
    IF to_regclass('email_attachments') IS NOT NULL THEN
      UPDATE email_attachments SET url = replace(url, '.svg', '.jpg'), content_type = 'image/jpeg' WHERE url LIKE '/images/attachments/%.svg';
    END IF;
    IF to_regclass('filler_email_attachments') IS NOT NULL THEN
      UPDATE filler_email_attachments SET url = replace(url, '.svg', '.jpg'), content_type = 'image/jpeg' WHERE url LIKE '/images/attachments/%.svg';
    END IF;
  END LOOP;
END $mig$;
