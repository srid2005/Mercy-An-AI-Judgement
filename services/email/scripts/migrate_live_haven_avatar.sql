-- Quill: Haven's mails carry the Haven logo now (public/images/avatars/haven.png).
-- Applied to the single-player schema, the event's template and every participant.
--   docker compose exec -T email-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < services/email/scripts/migrate_live_haven_avatar.sql
-- Idempotent: safe to run again.
DO $mig$ DECLARE sch TEXT; BEGIN
  FOR sch IN SELECT nspname FROM pg_namespace WHERE nspname IN ('public', 'template') OR nspname LIKE 'p\_%' LOOP
    EXECUTE format('SET LOCAL search_path TO %I', sch);
    IF to_regclass('users') IS NOT NULL THEN
      UPDATE users SET avatar_url = '/images/avatars/haven.png' WHERE avatar_url = '/images/avatars/haven.svg';
    END IF;
    IF to_regclass('filler_emails') IS NOT NULL THEN
      UPDATE filler_emails SET sender_avatar = '/images/avatars/haven.png' WHERE sender_avatar = '/images/avatars/haven.svg';
    END IF;
  END LOOP;
END $mig$;
