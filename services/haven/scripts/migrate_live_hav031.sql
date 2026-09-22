-- haven: the final recording (HAV-031, "If something happens") has its film;
-- its duration and transcript become what she actually says on camera and its
-- poster the frame taken from it. The long original is in
-- db/transcripts-full.backup.json. Applied to the single-player schema and to
-- the event's template (participant schemas resolve entries from template).
--   docker compose exec -T haven-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < services/haven/scripts/migrate_live_hav031.sql
-- Idempotent: safe to run again.
DO $mig$ DECLARE sch TEXT; BEGIN
  FOREACH sch IN ARRAY ARRAY['public', 'template'] LOOP
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = sch) THEN
      EXECUTE format('SET LOCAL search_path TO %I', sch);
      UPDATE entries SET duration_seconds = 36,
        poster_url = '/images/posters/2024-09-02.jpg',
        transcript = E'I''m recording this because I need it to exist somewhere he can''t reach.\n\nRahul''s Loop. Every trek photo since 2017. A blue carabiner on his strap in all of them, with the Trail Diaries tag. TD. He was a member in 2018.\n\nHis number is the 5:48 call in Dad''s phone. He''s "R". Dad warned him off three times that year. It''s in Dad''s handwriting. Dad went up to the rock that morning to end it. Rahul went too. Dad never came down.\n\nIt wasn''t an accident. Rahul killed my father.\n\nHe''s outside right now. I saw his car from the balcony. He''s texting that he just wants to talk. Arjun''s at his brother''s. N. isn''t picking up.\n\nIf something happens to me, it''s Rahul. Rahul Nair. It was always --'
      WHERE evidence_id = 'HAV-031';
    END IF;
  END LOOP;
END $mig$;
