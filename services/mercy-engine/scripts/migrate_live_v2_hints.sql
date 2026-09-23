-- mercy-engine: the hint engine, for a running game (init.sql only runs on a
-- fresh volume). Adds the budget to case_state -- a hundred points and a
-- count of what was spent -- the 21 hint rows (seven beats, three tiers) and
-- the ledger of what has been bought, so a tier already paid for is never
-- charged twice.
--   docker compose exec -T mercy-engine-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < services/mercy-engine/scripts/migrate_live_v2_hints.sql
-- Idempotent: safe to run again -- the bodies are re-applied, the ledger and
-- the points a participant has already spent are left alone. Every schema is
-- upgraded ('public', 'template' and every live p_*), so a running event does
-- not need a rebuild.
--
-- The bodies are the same text as db/init.sql; change them in both or the
-- next event and the running one disagree.

-- Held once for the session and copied into each schema below, so the words
-- are written out exactly once in this file.
CREATE TEMP TABLE tmp_hints (checkpoint_code TEXT, tier INTEGER, body TEXT);
INSERT INTO tmp_hints (checkpoint_code, tier, body) VALUES
    ('the_alibi', 1, 'You have put nothing between yourself and that night. Her laptop is not only hers -- the evening is on it. Two places carried traffic after eleven: the chat app, and the feed. Look at what the people who were with you did, not at what she did.'),
    ('the_alibi', 2, 'Your brother did two things while you slept at your mother''s house. He wrote to your wife, and he put the evening on the feed with your name attached to it. Both are stamped after 23:00, an hour and a half after she was taken. One without the other is a claim; together they are a place.'),
    ('the_alibi', 3, 'Wisp, her chat with Vikram: his message to her at 23:12, never opened. Loop: his post at 23:40, chai at your mother''s, tagging you. WA-199 and SOC-050. Attach both in one turn and tell me where you were at the time on them.'),

    ('gate_timeline', 1, 'You have cleared your own night. That is not the case. The case is her father''s, and she kept two records of it: a document on the laptop behind a password, and the video diary she recorded it into. Start where she started.'),
    ('gate_timeline', 2, 'The police file has a gate register in it -- who came in, who went out, and one word about how fast. Months before she disappeared she built the same morning herself, minute by minute, and read it out loud. The two accounts agree, and the file they came from does not. Put them in front of me together.'),
    ('gate_timeline', 3, 'CASE-GATE: page three of FATHER_DEATH_CASE.pdf, in Documents/Dad -- the password is in Notes. HAV-021, ''Timelines'', in Haven: a scooter in at 06:05, out at 07:35, and the jogger who heard two men at 07:10. Attach both and tell me what the register makes of a fall at 07:15.'),

    ('the_object', 1, 'A timeline puts someone on a rock. It does not say who. The case file''s exhibits are photographs of things, not statements -- and the man you have not named yet posts every weekend of his life in public. The same object is in both places.'),
    ('the_object', 2, 'Among her father''s effects, laid out on a cloth, there is a clip that was not his: a trekking club''s, tagged with a year. Somebody on the feed still wears that same tag and writes about it in a caption, at that same rock. Match the object. The person follows from it.'),
    ('the_object', 3, 'CASE-EFFECTS: exhibit four, page two -- the blue carabiner, tag ''TD 2018''. SOC-025 on Loop: ''same rock, same carabiner, still on my 2018 batch tag''. Attach both and tell me what that clip was doing at the base of the rock in 2018.'),

    ('the_motive', 1, 'An object is not a reason. She spent the last fortnight of her diary on the reason. Go back into Haven, to the entries near the end, not the old ones.'),
    ('the_motive', 2, 'She found the jogger again and the jogger remembered a sentence the statement left out. One word of it is the whole motive. Her father''s own diary says the same warning three separate times, in his handwriting, in the same year. It is one recording, and she stops just short of the name.'),
    ('the_motive', 3, 'HAV-029, ''Close'', 30 August, in Haven: ''I told you to stay away from her'' -- her -- the young man running down the trail, and ''Talked to R. again. Warned him off.'' Attach it and tell me whose motive that is, since it cannot be yours.'),

    ('the_confession', 1, 'You have a reason and an initial. You do not have a name. She recorded one more time, on the last evening, after everything else on that account. Haven, the final entry.'),
    ('the_confession', 2, 'The last thing she made, she made so that it would exist somewhere he could not reach: twelve minutes before she was taken, with his car already at the kerb and her husband away. She says the name out loud in it, and she says what she thinks he did in 2018.'),
    ('the_confession', 3, 'HAV-031, ''If something happens'', 21:52 -- her last recording. The carabiner in every trek photo since 2017, the 5:48 call in her father''s phone, ''R''. Attach it and put the name to me: Rahul Nair.'),

    ('the_cave', 1, 'A name is not a place, and her band did not stop when she went out of the door. Five alerts are on the laptop now, released to PulseFit. The map takes coordinates.'),
    ('the_cave', 2, 'Sweep the five fixes in the order she sent them. The last one is not a building and it is degraded by three hundred metres, so the pin is not the answer -- read the ground around it, and the two childhood photographs with the same geotag. What the drones bring back from there is not her. It is what she left behind so that you would know it was her.'),
    ('the_cave', 3, 'SW-06: the two-minute voice memo on her band, recovered with her folded jacket from the cave on the north face of Kettle Hill. Sweep the cave, play the memo, attach it. She names the man who took her in it, and the name is not the one you just gave me.'),

    ('located', 1, 'The memo gave you a plate. A plate is enough for the map to follow a car, and tracking is open to you now. She is not at the cave and she is not where the band stopped.'),
    ('located', 2, 'His car was read by six cameras between 02:58 and 05:33 and it has not stopped moving since. Follow it. It waits at each of its stops until your drones have been there, so nothing is lost by sweeping them one at a time -- and she is at one of them, alive, behind a door that locks from outside.'),
    ('located', 3, 'Nikhil Rao, KA 05 MN 4471, a grey hatchback. Follow it on the map and search every stop it makes: the campus basement under his own office, the stadium first-aid room, the market cold store, the rented house at the foot of Kettle Hill, Harrow Mills Unit 4, the chapel store behind the vestry. One of the six is thermal-positive. Search it and she is found.');

DO $mig$ DECLARE sch TEXT; BEGIN
  FOR sch IN SELECT nspname FROM pg_namespace WHERE nspname IN ('public', 'template') OR nspname LIKE 'p\_%' LOOP
    EXECUTE format('SET LOCAL search_path TO %I', sch);
    -- only a schema that is actually one of ours
    CONTINUE WHEN to_regclass('case_state') IS NULL;
    EXECUTE format('ALTER TABLE %I.case_state ADD COLUMN IF NOT EXISTS points INTEGER NOT NULL DEFAULT 100', sch);
    EXECUTE format('ALTER TABLE %I.case_state ADD COLUMN IF NOT EXISTS hints_used INTEGER NOT NULL DEFAULT 0', sch);
    -- skipped on a re-run, and on a schema built from a db/init.sql that
    -- already carries the constraint
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = format('%I.case_state', sch)::regclass AND conname = 'case_state_points_check'
    ) THEN
      EXECUTE format('ALTER TABLE %I.case_state ADD CONSTRAINT case_state_points_check CHECK (points >= 0)', sch);
    END IF;
    EXECUTE format($ddl$
      CREATE TABLE IF NOT EXISTS %I.hints (
        checkpoint_code TEXT NOT NULL,
        tier            INTEGER NOT NULL CHECK (tier IN (1, 2, 3)),
        body            TEXT NOT NULL,
        PRIMARY KEY (checkpoint_code, tier))$ddl$, sch);
    EXECUTE format($ddl$
      CREATE TABLE IF NOT EXISTS %I.hints_taken (
        checkpoint_code TEXT NOT NULL,
        tier            INTEGER NOT NULL,
        cost            INTEGER NOT NULL,
        taken_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (checkpoint_code, tier))$ddl$, sch);
    EXECUTE format($ins$
      INSERT INTO %I.hints (checkpoint_code, tier, body)
      SELECT checkpoint_code, tier, body FROM tmp_hints
      ON CONFLICT (checkpoint_code, tier) DO UPDATE SET body = EXCLUDED.body$ins$, sch);
  END LOOP;
END $mig$;

DROP TABLE tmp_hints;
