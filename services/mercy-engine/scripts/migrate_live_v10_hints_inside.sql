-- mercy-engine v10: the app they are standing in answers first.
--
-- POST /api/hint now serves an INSIDE chain before a DISCOVER chain: when the
-- participant is in an app whose gate is open (or that has none) and at least
-- one un-hit beat -- any beat, not only the next -- still needs a piece that
-- is read in that app and has not been argued, the desk says what is in this
-- app and why it matters, in story order, ids and claims last. A participant
-- who had just signed in to Haven used to be told "there is a chat app called
-- Wisp" because the next beat lived there; Haven holds three pieces for three
-- open beats, and the newest releases the band's alerts (server.js:insideOf).
-- Spent, the chain falls to the beat ladder for the earliest open beat with a
-- piece in that app; an app that no beat reads (Quill, Notes, Photos) gets one
-- honest step and then the DISCOVER chain as before. The rest is code. What
-- the schema carries is the table the INSIDE chains live in, and its rows.
-- The ledger is the existing context_hints_taken, under screen 'inside', so
-- no ledger is rebuilt under a running game.
--   docker compose exec -T mercy-engine-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < services/mercy-engine/scripts/migrate_live_v10_hints_inside.sql
-- Idempotent: safe to run again -- the table is created only where it is
-- missing, the bodies are re-applied, the ledgers and the bill are left
-- alone, no column is ever dropped. Every schema is upgraded ('public',
-- 'template' and every live p_*), so a running event does not need a
-- rebuild. Run it BEFORE preparing templates for the next event.
--
-- The rows below are the same bytes as db/init.sql's seed; change them in both
-- or the next event and the running one disagree.

-- Held once for the session and copied into each schema below, so the words
-- are written out exactly once in this file.
CREATE TEMP TABLE tmp_inside_hints (app TEXT, step INTEGER, body TEXT);
INSERT INTO tmp_inside_hints (app, step, body) VALUES
    -- Haven: three recordings, the newest first, because arguing it releases
    -- the band's alerts and the rest of the trail.
    ('haven', 1,
     'Haven holds three recordings this case needs. Start with the newest one, which is the last card at the bottom of the list, so scroll all the way down: If something happens, recorded at 21:52 on the night she was taken. It is the last thing she recorded. In it she names the man she was afraid of and says he killed her father. Open it and read the transcript so it lands in your evidence index. Once you argue it in the MERCY AI Judge tab I release her band''s SOS alerts to the laptop, and they are the trail to where she is.'),
    ('haven', 2,
     'Then two older entries, higher up the list. Scroll up about three weeks to Timelines. She lays out the morning her father died: a scooter in at 6:05, a jogger who heard two men arguing on the rock at 7:10, and a 5:48 call from a contact saved as R. It proves he was not alone. Then Close, recorded three days before she was taken: the jogger heard her father say I told you to stay away from her, and his diary says he warned R off three times. It proves the motive was not yours. Open both so they land in your evidence index.'),
    ('haven', 3,
     'The ids and the claims. HAV-031 is If something happens: attach it on its own and tell me the name she says, Rahul Nair, that his number is the 5:48 call in her father''s phone and that the TD 2018 carabiner is his. HAV-021 is Timelines: attach it together with CASE-GATE, page 3 of the case file in Documents, then Dad, and tell me her father was not alone on the rock. HAV-029 is Close: attach it on its own and tell me her father warned a man called R away from her three times, so the motive is his, not yours.'),

    -- Wisp: one piece, half of the alibi.
    ('wisp', 1,
     'Wisp holds one piece this case needs, and it is half of your alibi. In the list of chats on the left open Vikram Kapoor, your brother, and scroll to the bottom, to the night she was taken. His message to Meera at 23:12 says you were staying over at his house and that your mother fed you. It proves where you were when she was taken. Open it so it lands in your evidence index. Nothing else in Wisp is needed by any beat.'),
    ('wisp', 2,
     'The id is WA-199, Vikram''s 23:12 message to Meera. On its own it is not enough: I want both halves of the alibi in one turn. The other half is on Loop, Vikram''s post at 23:40 about late-night chai that tags you. In the MERCY AI Judge tab attach WA-199 and SOC-050 together and tell me you were at your brother Vikram''s house with your mother that night, and these two records prove it.'),

    -- Loop: the alibi's other half, the carabiner, and the cave for later.
    ('loop', 1,
     'Loop holds three pieces this case needs. First, the other half of your alibi: find Vikram Kapoor''s post from the night she was taken, stamped 23:40, about late-night chai with his little brother. It tags you. With his 23:12 message to Meera in Wisp it proves you were at his house. Open it so it lands in your evidence index.'),
    ('loop', 2,
     'Second, the carabiner: find Rahul Nair''s post from Turahalli at dawn, a climbing photo captioned same rock, same carabiner, still on my 2018 batch tag. The case file''s photo of her father''s effects shows a blue carabiner tagged TD 2018 that was not his. This post puts that tag on Rahul. Third, for later: Meera''s childhood photo captioned Our secret kingdom, a cave, tagged to Rahul. Its geotag is the cave on Kettle Hill where her band''s last alert leads. Open both so they land in your evidence index.'),
    ('loop', 3,
     'The ids and the claims. SOC-050 is Vikram''s 23:40 chai post: attach it with WA-199, his 23:12 message in Wisp, and tell me you were at your brother''s house with your mother that night. SOC-025 is Rahul''s Turahalli post: attach it with CASE-EFFECTS, page 2 exhibit 4 of the case file in Documents, then Dad, and tell me the TD 2018 carabiner found with her father is Rahul Nair''s. SOC-006 is the cave photo: no beat needs it attached, but its location is where to send the drones once the first four alerts are swept.'),

    -- File Explorer: two pages of the case file.
    ('files', 1,
     'The Dad folder holds FATHER_DEATH_CASE.pdf, the police file on her father''s death, and two of its pages are pieces this case needs. Page 3, exhibit 5, is the forest gate register: a scooter logged in at 06:05 and out at 07:35, marked fast, on a morning the report says he was alone. Page 2, exhibit 4, is the photograph of his effects: a blue carabiner with a tag reading TD 2018, and it was not his. Open the file and read both pages so they land in your evidence index.'),
    ('files', 2,
     'The ids and the claims. CASE-GATE is page 3: attach it with HAV-021, the Haven entry called Timelines, and tell me the register shows a scooter in at 06:05 and out at 07:35 and a jogger heard two men on the rock at 07:10, so her father was not alone. CASE-EFFECTS is page 2 exhibit 4: attach it with SOC-025, Rahul Nair''s Turahalli post on Loop, and tell me the TD 2018 carabiner was not her father''s and Rahul wears that tag. Nothing else in this folder is needed by any beat.'),

    -- PulseFit: the five alerts and why the order matters.
    ('pulsefit', 1,
     'PulseFit shows the SOS alerts her band sent after she left the flat. If it says No alerts on this device, they are still under evidence seal: in the MERCY AI Judge tab attach her last Haven recording, If something happens, and name the man she says killed her father. The alerts appear here the moment that is argued. There are five, from 22:41 to 02:14, and each has a Send to map button. They are the route she was taken on.'),
    ('pulsefit', 2,
     'Send them to the City Map one at a time, in the order they were sent, and press Launch drones on the map for each one. Wait for each report before sending the next. The first four are places she passed. The fifth, 02:14, is 300 metres off because the band was under rock: its pin is scree on the north face of Kettle Hill, and the place is the one cave on that face. Once the first four are swept, search the cave. The drones bring back her jacket and her band, and the band holds a voice memo that names the man who took her.'),

    -- The map: the sweeps, the cave, then the car.
    ('map', 1,
     'The map is where her band''s five alerts are searched. Each alert in PulseFit on Meera''s Laptop has a Send to map button that fills the Drone search boxes on the right. Press Launch drones for each one, in the order they were sent, 22:41 first, and wait for the report before the next. Every report is evidence you can attach. The first four are the route she was taken on. The fifth is 300 metres off and its pin is not the place.'),
    ('map', 2,
     'The place is a cave on the north face of Kettle Hill, the cave from her childhood Loop photo captioned Our secret kingdom. Once the first four alerts are swept, type Kettle into the search box at the top of the map and pick Cave, Kettle Hill (north face), or right-click it on the model. The drones bring back her folded jacket and her band, and the band holds a two-minute voice memo. Play it. It is SW-06: attach it in the MERCY AI Judge tab and tell me the name she says took her. It is not Rahul.'),
    ('map', 3,
     'The memo opens Vehicle tracking, the button at the top of the City Map. Type the name from the memo and the model follows his car through the cameras that read its plate. Every place it stops is listed. Press Send drones on each stop in turn and wait for the report; the car waits until the search is done. One report will say Meera located, and that ends the file.'),

    -- Quill, Notes, Photos: no beat reads here. One honest step each, so a
    -- participant standing in them is not sold the wrong app first.
    ('quill', 1,
     'Nothing any beat needs is in Quill''s mail itself. Quill matters for one thing: Haven, her video diary, signs you in by emailing a six-digit code to this inbox. Keep Quill open, open Haven in Orbit from the bookmarks bar, press Email me a sign-in code, then come back here and open the new mail. The three recordings the case needs are in Haven.'),
    ('notes', 1,
     'Nothing in Notes is evidence by itself. It is where she kept her passwords. The yellow note whose title starts with logins lists them, and its second line is the password for the locked Dad folder in File Explorer, under Documents, where the police case file is. Read it here, type it there. Nothing else in Notes is needed by any beat.'),
    ('photos', 1,
     'Nothing in Photos is needed by any beat of this hearing. It holds her Camera Roll, wedding pictures and screenshots. The photographs that decide the case are elsewhere: the police file in File Explorer under Documents, then Dad, and the posts on Loop. Close Photos and press Hint again, and I will point you at the app that matters now.');

DO $mig$ DECLARE sch TEXT; BEGIN
  FOR sch IN SELECT nspname FROM pg_namespace WHERE nspname IN ('public', 'template') OR nspname LIKE 'p\_%' LOOP
    EXECUTE format('SET LOCAL search_path TO %I', sch);
    -- only a schema that is actually one of ours, and one that has seen v3:
    -- a schema with no context chains has no ledger for an inside step
    CONTINUE WHEN to_regclass('case_state') IS NULL OR to_regclass('context_hints_taken') IS NULL;
    EXECUTE format($tbl$
      CREATE TABLE IF NOT EXISTS %I.inside_hints (
        app    TEXT NOT NULL,
        step   INTEGER NOT NULL CHECK (step IN (1, 2, 3)),
        body   TEXT NOT NULL,
        PRIMARY KEY (app, step)
      )$tbl$, sch);
    EXECUTE format($ins$
      INSERT INTO %I.inside_hints (app, step, body)
      SELECT app, step, body FROM tmp_inside_hints
      ON CONFLICT (app, step) DO UPDATE SET body = EXCLUDED.body$ins$, sch);
  END LOOP;
END $mig$;

DROP TABLE tmp_inside_hints;
