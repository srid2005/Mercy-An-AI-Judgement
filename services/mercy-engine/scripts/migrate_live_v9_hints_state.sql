-- mercy-engine v9: hints follow the participant's state.
--
-- POST /api/hint now resolves where the participant is standing against
-- where the beat's next piece is read, and serves the stage that fits: the
-- laptop's lock chain before they are in; an app's gate chain while they are
-- provably held at it; a DISCOVER chain when they are anywhere else (the
-- hearing, the desktop, Orbit on no site, the wrong app) -- step 1 says the
-- app exists and how to open it, step 2 what it holds for this beat; the beat
-- ladder inside the right app, started at the tier written for that app; and,
-- when the chain in use is spent, its most direct step again, free, with
-- repeat:true so the console shows the words instead of "nothing added"
-- (server.js:placesOf, hereOf, discoverChain, serveChain). The rest is code.
-- What the schema carries is the new table the DISCOVER chains live in, and
-- its rows. The ledger is the existing context_hints_taken, under screen
-- 'discover', so no ledger is rebuilt under a running game.
--   docker compose exec -T mercy-engine-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < services/mercy-engine/scripts/migrate_live_v9_hints_state.sql
-- Idempotent: safe to run again -- the table is created only where it is
-- missing, the bodies are re-applied, the ledgers and the bill are left
-- alone. Every schema is upgraded ('public', 'template' and every live p_*),
-- so a running event does not need a rebuild.
--
-- The rows below are the same bytes as db/init.sql's seed; change them in both
-- or the next event and the running one disagree.

-- Held once for the session and copied into each schema below, so the words
-- are written out exactly once in this file.
CREATE TEMP TABLE tmp_discover_hints (app TEXT, checkpoint_code TEXT, step INTEGER, body TEXT);
INSERT INTO tmp_discover_hints (app, checkpoint_code, step, body) VALUES
    -- Wisp: no gate. The alibi's first half.
    ('wisp', '', 1,
     'There is a chat app called Wisp with all of Meera''s messages. It is a website, not a desktop icon. On Meera''s Laptop open Orbit, the browser, and press Wisp Web on the bookmarks bar under the address box. It opens with no password. Every message you open is added to your evidence index.'),
    ('wisp', 'the_alibi', 2,
     'Wisp holds half of your alibi. In the list of chats on the left open the one with Vikram Kapoor, your brother, and scroll to the bottom, to the night she was taken. His last message to Meera says where you were that night and who was with you. Open it so it lands in your evidence index.'),

    -- Loop: a password gate. The alibi's other half, and the carabiner photo.
    ('loop', '', 1,
     'There is a social app called Loop where Meera and the people around her post. It is a website. On Meera''s Laptop open Orbit, the browser, and press Loop on the bookmarks bar under the address box. Loop asks for a password. Open it, then press Hint again from Loop''s login screen and I will tell you where the password is written.'),
    ('loop', 'the_alibi', 2,
     'Loop holds the other half of your alibi. Once you are in, find Vikram Kapoor''s post from the night she was taken, stamped 23:40. It is about late-night chai and it tags you. Open the post so it lands in your evidence index. Together with his message to Meera in Wisp it proves where you were.'),
    ('loop', 'the_object', 2,
     'Loop holds the photo that matches the object in the case file. Once you are in, find Rahul Nair''s posts and open the one from 12 May at Turahalli, a climbing photo. Read the caption about his carabiner and its batch tag. Open it so it lands in your evidence index.'),

    -- Quill: a password gate. No beat needs its mail; Haven's code lands here.
    ('quill', '', 1,
     'There is a mail app called Quill with Meera''s inbox. It has its own icon on Meera''s Laptop desktop. Double-click Quill. It asks for a password. Press Hint again from Quill''s login screen and I will tell you where the password is written.'),
    ('quill', '', 2,
     'Nothing this beat needs is in Quill itself. Quill matters for one thing: Haven, her video diary, signs you in by emailing a six-digit code to this inbox. Get into Quill first, then open Haven in Orbit and press Email me a sign-in code. The mail arrives here.'),

    -- Haven: the emailed code and four questions. Three beats read here.
    ('haven', '', 1,
     'There is a video diary called Haven with thirty-one recordings Meera made, each with a transcript. It is a website. On Meera''s Laptop open Orbit, the browser, and press Haven on the bookmarks bar under the address box. Haven signs you in with a code it emails to Quill and four security questions. Press Hint again from Haven''s sign-in screen and I will walk you through it.'),
    ('haven', 'gate_timeline', 2,
     'Haven holds her own account of the morning her father died. Once you are in, scroll to August 2024 and open the entry recorded on 10 August, the one whose title is about timelines. In it she repeats what a jogger heard on the rock that morning. Open it so it lands in your evidence index.'),
    ('haven', 'the_motive', 2,
     'Haven holds her reason. Once you are in, open the newest entries, the ones from the last two weeks before she disappeared. The entry recorded on 30 August, the one where she says she is close, names what the jogger heard her father say and what her father wrote in his diary. Open it so it lands in your evidence index.'),
    ('haven', 'the_confession', 2,
     'Haven holds her last recording, made at 21:52 on the night she was taken, after every other entry on the account. Once you are in, scroll to the newest entry. In it she says the man''s name out loud. Open it so it lands in your evidence index, then attach it and say the name she says.'),

    -- File Explorer: the case file behind the Dad folder's padlock.
    ('files', '', 1,
     'There is a police case file on her father''s death saved on Meera''s Laptop. Double-click File Explorer on the desktop, open Documents, and double-click the folder called Dad. It has a padlock on its tile and asks for a password. Press Hint again from File Explorer and I will tell you where the password is written.'),
    ('files', 'gate_timeline', 2,
     'The Dad folder holds FATHER_DEATH_CASE.pdf. Open it and go to page 3. It is the forest gate register for the morning he died: a scooter that went in early and came out fast. Read the page so it lands in your evidence index. It is half of this beat; the other half is her Haven entry about that morning.'),
    ('files', 'the_object', 2,
     'The Dad folder holds FATHER_DEATH_CASE.pdf. Open it and go to page 2, exhibit 4, the photograph of the things found with him. One of them is a climbing clip with a tag that was not his. Read the page so it lands in your evidence index. The same clip is in a photo on Loop.'),

    -- Notes: never a target of its own; the road to the Dad folder.
    ('notes', '', 1,
     'There is a Notes app on Meera''s Laptop where she kept her passwords. Double-click Notes on the desktop. Seven notes open. The yellow one whose title starts with logins is a list of her passwords. Nothing in Notes is evidence by itself. It is the key to the locked Dad folder in File Explorer.'),
    ('notes', '', 2,
     'In Notes open the yellow note whose title starts with logins. Its second line starts with Dad''s folder and the password is written on that line, before the brackets. Type it exactly as written, capitals included, into the padlock on the Dad folder in File Explorer, under Documents. The case file is inside.'),

    -- PulseFit: the band's alerts, sealed until the confession beat.
    ('pulsefit', '', 1,
     'There is an app called PulseFit on Meera''s Laptop that shows the SOS alerts her fitness band sent after she left the flat. Double-click PulseFit on the desktop. If it says No alerts on this device, the alerts are still under evidence seal. They are released when you name the man she feared in the MERCY AI Judge tab, using her last Haven recording.'),
    ('pulsefit', 'the_cave', 2,
     'PulseFit holds five alerts, sent between 22:41 and 02:14, each with a Send to map button. They are the trail to where she was taken. Send them to the City Map one at a time, in the order they were sent, and press Launch drones on the map for each one. Wait for each report before sending the next.'),

    -- Photos: never a target; a short honest step that clears the ground.
    ('photos', '', 1,
     'There is a Photos app on Meera''s Laptop with her Camera Roll, wedding pictures and screenshots. Double-click Photos on the desktop if you want to see them. Nothing in Photos is needed by any beat of this hearing. The photographs that decide the case are in the case file under Documents, then Dad, and on Loop.'),
    ('photos', '', 2,
     'Photos holds nothing this beat needs. Close it. Press Hint again from the MERCY AI Judge tab and I will point you at the app that does.'),

    -- The map: its own tab. The sweeps, then the car.
    ('map', '', 1,
     'There is a City Map, my model of the city, on its own tab at the top of the screen, next to Meera''s Laptop. Press City Map. On the right is a Drone search panel with two boxes for a latitude and a longitude and a Launch drones button. The drones search 60 metres around the point and report back, and every report is evidence you can attach.'),
    ('map', 'the_cave', 2,
     'The map is where the band''s five alerts are searched. Each alert in PulseFit on the laptop has a Send to map button that fills the Drone search boxes here. Press Launch drones for each, in the order they were sent. The fifth fix is 300 metres off, so its pin is not the place. Once the first four are swept, type Kettle into the search box at the top of the map and send the drones to the cave on Kettle Hill.'),
    ('map', 'located', 2,
     'The map is where his car is followed. At the top of the City Map press Vehicle tracking. It unlocked when the drones brought back her band''s memo. Type the name she says in the memo and the model follows his car. Every place it stops is listed. Press Send drones on each stop in turn and wait for the report. She is alive at one of them.');

DO $mig$ DECLARE sch TEXT; BEGIN
  FOR sch IN SELECT nspname FROM pg_namespace WHERE nspname IN ('public', 'template') OR nspname LIKE 'p\_%' LOOP
    EXECUTE format('SET LOCAL search_path TO %I', sch);
    -- only a schema that is actually one of ours, and one that has seen v3:
    -- a schema with no context chains has no ledger for a discover step
    CONTINUE WHEN to_regclass('case_state') IS NULL OR to_regclass('context_hints_taken') IS NULL;
    EXECUTE format($tbl$
      CREATE TABLE IF NOT EXISTS %I.discover_hints (
        app              TEXT NOT NULL,
        checkpoint_code  TEXT NOT NULL DEFAULT '',
        step             INTEGER NOT NULL CHECK (step IN (1, 2)),
        body             TEXT NOT NULL,
        PRIMARY KEY (app, checkpoint_code, step)
      )$tbl$, sch);
    EXECUTE format($ins$
      INSERT INTO %I.discover_hints (app, checkpoint_code, step, body)
      SELECT app, checkpoint_code, step, body FROM tmp_discover_hints
      ON CONFLICT (app, checkpoint_code, step) DO UPDATE SET body = EXCLUDED.body$ins$, sch);
  END LOOP;
END $mig$;

DROP TABLE tmp_discover_hints;
