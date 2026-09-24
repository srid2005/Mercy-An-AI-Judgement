-- mercy-engine v11: hint rows stop naming calendar dates.
--
-- Every service's seed re-anchors the story to yesterday at seed time
-- (haven/db/init.sql:t, social-media/db/init.sql:t), so a Haven entry the
-- story recorded on 10 August is dated three weeks before whatever day the
-- event runs on, and a hint that says "recorded 10 August" or "scroll to
-- August 2024" sends a participant looking for a date that is not on the
-- screen. Five rows of the beat ladder and three of the DISCOVER chains said
-- such dates; they now say what the screen can confirm: the entry's title and
-- its distance from the night she was taken ("about three weeks before",
-- "three days before", "months before"). No code changes.
--   docker compose exec -T mercy-engine-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < services/mercy-engine/scripts/migrate_live_v11_hints_relative_dates.sql
-- Idempotent: safe to run again -- the bodies are re-applied, the ledgers
-- and the bill are left alone, no column is ever dropped. Every schema is
-- upgraded ('public', 'template' and every live p_*), so a running event
-- does not need a rebuild; the engine reads the rows on every press.
--
-- The rows below are the same bytes as db/init.sql's seed; change them in both
-- or the next event and the running one disagree.

-- Held once for the session and copied into each schema below, so the words
-- are written out exactly once in this file.
CREATE TEMP TABLE tmp_hints (checkpoint_code TEXT, tier INTEGER, body TEXT);
INSERT INTO tmp_hints (checkpoint_code, tier, body) VALUES
    ('gate_timeline', 2, 'In File Explorer open Documents, then Dad, then FATHER_DEATH_CASE.pdf, and go to page 3. It shows the forest gate register: a scooter in at 06:05, out at 07:35, marked fast. Then open Haven and find the entry called Timelines, recorded about three weeks before she was taken. In it she says a jogger heard two men on the rock at 07:10. Open both, then attach both.'),
    ('the_object', 2, 'Open FATHER_DEATH_CASE.pdf at page 2, exhibit 4. The effects found with him include a blue carabiner with a tag reading TD 2018, and it was not his. Then open Loop and find Rahul Nair''s post from Turahalli, months before she was taken. His caption says same rock, same carabiner, still on my 2018 batch tag. Open both, then attach both.'),
    ('the_object', 3, 'Attach CASE-EFFECTS, page 2 exhibit 4 of the case file, together with SOC-025, Rahul Nair''s Turahalli post on Loop. Then tell me: the blue carabiner tagged TD 2018 found with her father was not his. It is a Trail Diaries 2018 batch tag, and Rahul Nair posted himself wearing that same tag at that same rock.'),
    ('the_motive', 2, 'In Haven open the entry called Close, recorded three days before she was taken. She says the jogger, S. Iyer, heard the older man say I told you to stay away from her, and then saw a young man run down the trail with blood on his knuckles. She also says her father''s diary says Warned him off about a man called R, three times. Open it, then attach it.'),
    ('the_motive', 3, 'Attach HAV-029, the Haven entry called Close, recorded three days before she was taken. Then tell me: the motive is not yours. Her father warned a man called R to stay away from Meera, three times in his own diary, and the jogger heard him say it on the rock the morning he died. The man he warned off is the one with a reason.');

CREATE TEMP TABLE tmp_discover_hints (app TEXT, checkpoint_code TEXT, step INTEGER, body TEXT);
INSERT INTO tmp_discover_hints (app, checkpoint_code, step, body) VALUES
    ('loop', 'the_object', 2,
     'Loop holds the photo that matches the object in the case file. Once you are in, find Rahul Nair''s posts and open the one from Turahalli, months before she was taken, a climbing photo. Read the caption about his carabiner and its batch tag. Open it so it lands in your evidence index.'),
    ('haven', 'gate_timeline', 2,
     'Haven holds her own account of the morning her father died. Once you are in, scroll up to about three weeks before she was taken and open the entry called Timelines. In it she repeats what a jogger heard on the rock that morning. Open it so it lands in your evidence index.'),
    ('haven', 'the_motive', 2,
     'Haven holds her reason. Once you are in, open the newest entries, the ones from the last two weeks before she disappeared. The entry called Close, recorded three days before she was taken, the one where she says she is close, names what the jogger heard her father say and what her father wrote in his diary. Open it so it lands in your evidence index.');

DO $mig$ DECLARE sch TEXT; BEGIN
  FOR sch IN SELECT nspname FROM pg_namespace WHERE nspname IN ('public', 'template') OR nspname LIKE 'p\_%' LOOP
    EXECUTE format('SET LOCAL search_path TO %I', sch);
    -- only a schema that is actually one of ours, and one that has seen v2:
    -- a schema with no hints table has no ladder to rewrite
    CONTINUE WHEN to_regclass('case_state') IS NULL OR to_regclass('hints') IS NULL;
    EXECUTE format($ins$
      INSERT INTO %I.hints (checkpoint_code, tier, body)
      SELECT checkpoint_code, tier, body FROM tmp_hints
      ON CONFLICT (checkpoint_code, tier) DO UPDATE SET body = EXCLUDED.body$ins$, sch);
    -- the DISCOVER chains arrived with v9; a schema without them has no
    -- steps to rewrite either
    CONTINUE WHEN to_regclass('discover_hints') IS NULL;
    EXECUTE format($ins$
      INSERT INTO %I.discover_hints (app, checkpoint_code, step, body)
      SELECT app, checkpoint_code, step, body FROM tmp_discover_hints
      ON CONFLICT (app, checkpoint_code, step) DO UPDATE SET body = EXCLUDED.body$ins$, sch);
  END LOOP;
END $mig$;

DROP TABLE tmp_hints;
DROP TABLE tmp_discover_hints;
