-- mercy-engine v6: the hint desk answers progress first.
--
-- POST /api/hint now picks the beat before the screen: a screen chain is
-- served only while the participant is held at a gate that is provably still
-- shut, and the beat ladder starts past the advice they have already followed
-- (server.js:heldAtGate, server.js:ladderStart). That is code, not schema.
-- What the schema carries is the one ladder the new start order exposed:
-- the_cave's tier 2 opened with "sweep the five fixes in order", which is
-- what a participant who has swept all five is now shown first, and neither
-- it nor tier 3 said where the cave is in her own words. Tier 1 takes the
-- sweep-in-order instruction; tier 2 stands on its own for someone standing
-- on the fifth pin -- the degraded fix, and the cave from the two childhood
-- photographs she captioned "our secret kingdom" (SOC-006, the geotag of
-- city-map's kettle-cave spot); tier 3 names the piece and the exact place.
--   docker compose exec -T mercy-engine-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < services/mercy-engine/scripts/migrate_live_v6_hints_progress.sql
-- Idempotent: safe to run again -- the bodies are re-applied, the ledgers and
-- the bill are left alone. Every schema is upgraded ('public', 'template' and
-- every live p_*), so a running event does not need a rebuild. A participant
-- who has already bought a the_cave tier keeps that row and reads the new
-- words for it, free, the next time they ask.
--
-- The rows below are the same bytes as db/init.sql's seed; change them in both
-- or the next event and the running one disagree.

-- Held once for the session and copied into each schema below, so the words
-- are written out exactly once in this file.
CREATE TEMP TABLE tmp_hints (checkpoint_code TEXT, tier INTEGER, body TEXT);
INSERT INTO tmp_hints (checkpoint_code, tier, body) VALUES
    ('the_cave', 1, 'A name is not a place, and her band did not stop when she went out of the door. Five alerts are on the laptop now, released to PulseFit, and the map takes coordinates. Sweep them in the order she sent them, one flight each: the drones will not enter the last one blind.'),
    ('the_cave', 2, 'The fifth fix is the only one that is not a building, and the band was under rock when it sent it: three hundred metres of error, so the pin is scree and thorn, and the pin is not the place. She told you the place herself, when she was a child. ''Our secret kingdom'' -- the cave in the two childhood photographs on her feed, tagged to Rahul, the one he asked her about the night before she was taken. Those photographs carry a geotag. Take it to the map, once the four fixes before it are swept. What the drones bring back from there is not her. It is what she left behind so that you would know it was her.'),
    ('the_cave', 3, 'SW-06: the two-minute voice memo on her band, recovered with her folded jacket from the cave on the north face of Kettle Hill -- the geotag on SOC-006, 12.951181, 77.501304, the one cave on that face of the model. Sweep it, play the memo, attach it. She names the man who took her in it, and the name is not the one you just gave me.');

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
  END LOOP;
END $mig$;

DROP TABLE tmp_hints;
