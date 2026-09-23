-- mercy-engine v8: every hint says it plainly.
--
-- Playtest feedback: the bodies read like riddles ("a name is not a place,
-- and her band did not stop when she went out of the door") and a participant
-- under the clock wants to be told which app to open, which item to read and
-- what to tell MERCY. Every one of the 21 beat tiers and 29 context steps is
-- rewritten in short direct sentences that name the app, the tab, the folder
-- and the button as the participant sees them: tier/step 1 says where to look,
-- 2 says exactly which item and what to do with it, 3 is the most direct
-- version (beat tier 3 names the evidence id and the exact argument). The one
-- rule that stands: no hint states a gate secret -- never the laptop PIN, the
-- Documents/Dad password, Loop's date or Haven's answers -- it says exactly
-- where that answer is written instead. Keys, tiers and steps are unchanged,
-- so the ladder logic and steps_total in server.js are untouched.
--   docker compose exec -T mercy-engine-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < services/mercy-engine/scripts/migrate_live_v8_hints_plain.sql
-- Idempotent: safe to run again -- the bodies are re-applied, the ledgers and
-- the bill are left alone. Every schema is upgraded ('public', 'template' and
-- every live p_*), so a running event does not need a rebuild. A participant
-- who has already bought a tier or a step keeps that row and reads the new
-- words for it, free, the next time they ask.
--
-- The rows below are the same bytes as db/init.sql's seed; change them in both
-- or the next event and the running one disagree.

-- Held once for the session and copied into each schema below, so the words
-- are written out exactly once in this file.
CREATE TEMP TABLE tmp_hints (checkpoint_code TEXT, tier INTEGER, body TEXT);
INSERT INTO tmp_hints (checkpoint_code, tier, body) VALUES
    ('the_alibi', 1, 'Start by proving where you were that night. On Meera''s Laptop open Orbit and use the Wisp Web bookmark. Open the chat with your brother, Vikram Kapoor. Then use the Loop bookmark and look at what Vikram posted that night. In both places look for anything stamped after 23:00.'),
    ('the_alibi', 2, 'Two records prove you were at your brother Vikram''s house, with your mother there. First, in Wisp, the chat with Vikram Kapoor: his message to Meera at 23:12 says you were staying over. Second, in Loop, Vikram''s post at 23:40 about late-night chai, tagging you. Open both so they land in your evidence index, then attach both together.'),
    ('the_alibi', 3, 'In the MERCY AI Judge tab attach WA-199 and SOC-050 in one turn. WA-199 is Vikram''s 23:12 message to Meera in Wisp. SOC-050 is his 23:40 chai post on Loop that tags you. Then tell me plainly: you were at your brother Vikram''s house with your mother from 22:20 that night, and these two records prove it.'),
    ('gate_timeline', 1, 'Your own night is cleared. The case is now her father''s death. Meera kept two records of it. One is the police case file, a PDF in File Explorer under Documents, in the locked folder called Dad. The other is her video diary in Haven, opened through Orbit. Open both and look for the morning he died.'),
    ('gate_timeline', 2, 'In File Explorer open Documents, then Dad, then FATHER_DEATH_CASE.pdf, and go to page 3. It shows the forest gate register: a scooter in at 06:05, out at 07:35, marked fast. Then open Haven and find the entry called Timelines, recorded 10 August. In it she says a jogger heard two men on the rock at 07:10. Open both, then attach both.'),
    ('gate_timeline', 3, 'Attach CASE-GATE, page 3 of FATHER_DEATH_CASE.pdf in Documents, then Dad, together with HAV-021, the Haven entry called Timelines. Then tell me: the report says her father fell alone at 07:15, but the gate register shows a scooter in at 06:05 and out at 07:35, and a jogger heard two men arguing on the rock at 07:10. He was not alone.'),
    ('the_object', 1, 'The timeline puts a second man on the rock but does not name him. The same object is in two places. One is the photograph of her father''s effects in FATHER_DEATH_CASE.pdf, in Documents, then Dad. The other is Loop, in the trekking posts of the people around her. Look for a climbing clip with a tag on it.'),
    ('the_object', 2, 'Open FATHER_DEATH_CASE.pdf at page 2, exhibit 4. The effects found with him include a blue carabiner with a tag reading TD 2018, and it was not his. Then open Loop and find Rahul Nair''s post from 12 May at Turahalli. His caption says same rock, same carabiner, still on my 2018 batch tag. Open both, then attach both.'),
    ('the_object', 3, 'Attach CASE-EFFECTS, page 2 exhibit 4 of the case file, together with SOC-025, Rahul Nair''s 12 May post on Loop. Then tell me: the blue carabiner tagged TD 2018 found with her father was not his. It is a Trail Diaries 2018 batch tag, and Rahul Nair posted himself wearing that same tag at that same rock.'),
    ('the_motive', 1, 'Her reason is in Haven, her video diary, opened through Orbit. Open Haven and read the newest entries, the ones from the last two weeks before she disappeared, not the old ones. Look for the entry where she says she is close.'),
    ('the_motive', 2, 'In Haven open the entry called Close, recorded 30 August. She says the jogger, S. Iyer, heard the older man say I told you to stay away from her, and then saw a young man run down the trail with blood on his knuckles. She also says her father''s diary says Warned him off about a man called R, three times. Open it, then attach it.'),
    ('the_motive', 3, 'Attach HAV-029, the Haven entry called Close from 30 August. Then tell me: the motive is not yours. Her father warned a man called R to stay away from Meera, three times in his own diary, and the jogger heard him say it on the rock the morning he died. The man he warned off is the one with a reason.'),
    ('the_confession', 1, 'You have a reason and an initial. You need the name. Meera recorded one last Haven entry on the evening she was taken, after every other entry on the account. Open Haven through Orbit and open the newest entry, the one dated the night she disappeared.'),
    ('the_confession', 2, 'In Haven open the entry called If something happens, recorded at 21:52 on the night she was taken. She says the man''s name out loud. She says his carabiner is in every trek photo since 2017, that his number is the 5:48 call in her father''s phone, and that he is R. Open it, attach it, and say the name she says.'),
    ('the_confession', 3, 'Attach HAV-031, the Haven entry called If something happens, recorded at 21:52 that night. Then tell me the name she gives: Rahul Nair. Say that his number is the 5:48 call in her father''s phone, that he is the R her father warned off, and that the TD 2018 carabiner is his. Naming him releases her band''s SOS alerts to the laptop.'),
    ('the_cave', 1, 'Her PulseFit band sent five SOS alerts after she left the flat, and they are now on Meera''s Laptop in the PulseFit app. Open PulseFit. Each alert has a Send to map button. Send them to the City Map one at a time, in the order they were sent, and press Launch drones for each one.'),
    ('the_cave', 2, 'The fifth alert''s pin is not the place. That fix is 300 metres off because the band was under rock. The place is a cave. On the City Map type Kettle into the search box at the top and pick Cave, Kettle Hill (north face). Press Send drones on it, or right-click it on the model. It is the cave from her childhood Loop photo captioned Our secret kingdom.'),
    ('the_cave', 3, 'On the City Map type 12.951181 and 77.501304 into the Drone search boxes and press Launch drones. This only works once the first four alerts have each been swept. The drones bring back her jacket and her band, and the band holds a voice memo. Play it. Then attach SW-06 and tell me the name she says in it took her. It is not Rahul.'),
    ('located', 1, 'The memo gave you the driver''s name, and that opens Vehicle tracking on the City Map. She is not at the cave and not where the band stopped. Open the City Map and press the Vehicle tracking button at the top. Type the name from the memo and follow his car.'),
    ('located', 2, 'His car was read by six cameras between 02:58 and 05:33, and the model is following it. In Vehicle tracking every place it stops is listed. When it stops, press Send drones on that stop and wait for the report. The car waits there until the drones have searched. Search each stop in turn. She is alive at one of them.'),
    ('located', 3, 'Nikhil Rao, plate KA 05 MN 4471, a grey Hyundai i20. In Vehicle tracking on the City Map type Nikhil and follow him. Send the drones to every stop in turn: Northwind Campus, Meridian Stadium, Old Town Market Hall, the rented house at the foot of Kettle Hill, Harrow Mills Unit 4 and Westhollow Chapel. One report will say Meera located. That ends the file.');

CREATE TEMP TABLE tmp_context_hints (screen TEXT, detail TEXT, step INTEGER, body TEXT);
INSERT INTO tmp_context_hints (screen, detail, step, body) VALUES
    ('laptop-boot', '', 1,
     'This is Meera''s laptop starting up. Nothing on this screen is evidence. Wait for it to finish. The next screen is the lock screen, which asks for a PIN. Press this button again when you are on the lock screen and I will tell you where the PIN is written.'),
    ('laptop-lock', '', 1,
     'The lock screen wants a four-digit PIN. Look under the PIN box. There is a small grey line that starts with Password hint. It tells you what the PIN is made from. Read it, then find that fact about Meera.'),
    ('laptop-lock', '', 2,
     'Her date of birth is on the VICTIM card at the top of the MERCY AI Judge tab. Click the VICTIM chip, and under IDENTITY read the Date of birth line. The laptop PIN is the year in that date. Type those four digits into the PIN box on the lock screen.'),
    ('laptop-desktop', '', 1,
     'You are in. The apps that carry this case are on the desktop. Orbit is the browser and the only way to Loop, Wisp and Haven, through its bookmarks bar. Quill is her mail. Notes holds her passwords. File Explorer holds her documents and the case file. PulseFit shows her band''s SOS alerts, but only after you have named the man she feared.'),
    ('laptop-desktop', '', 2,
     'Open File Explorer and go to Documents. The folder called Dad has a padlock on it. Inside it is the police file on her father''s death. The password for that folder is written in Notes, in the yellow note whose title starts with logins, on the line that starts with Dad''s folder. Read it there and type it into the padlock.'),
    ('laptop-app', 'files', 1,
     'Her documents are in Documents. Most are ordinary: a resume, an Aadhaar copy, a passport, insurance, a marriage certificate, contacts. The folder called Dad is the one that matters. It has a padlock on its tile and it is the only locked thing on this laptop. Open Documents and double-click Dad.'),
    ('laptop-app', 'files', 2,
     'Documents, then Dad. Inside are FATHER_DEATH_CASE.pdf, the police file on her father''s death, and one video she kept a local copy of. The folder password is in the Notes app, in the yellow note whose title starts with logins. The second line of that note starts with Dad''s folder, and the password is written after it. Type it exactly as written into the padlock.'),
    ('laptop-app', 'notes', 1,
     'Open Notes. There are seven notes and two of them matter. The yellow one whose title starts with logins is a list of her passwords, including the one for the Dad folder in File Explorer. The other yellow one, things Dad said, holds four sentences from her father. The rest are ordinary.'),
    ('laptop-app', 'notes', 2,
     'In Notes open the yellow note whose title starts with logins. Its second line starts with Dad''s folder. The password for that folder is written on that line, before the brackets. Type it exactly as written, capitals included, into the padlock on the Dad folder in File Explorer, under Documents. Her father''s case file is inside.'),
    ('laptop-app', 'orbit', 1,
     'Orbit is the browser. It reaches only four sites and shows an offline page for anything else. The bookmarks bar has Loop, Wisp Web and Haven. Quill is also its own app on the desktop. Wisp opens with no password. Loop and Quill each ask for a password. Haven emails you a code and then asks security questions.'),
    ('laptop-app', 'orbit', 2,
     'The key icon in Orbit''s toolbar opens her saved passwords. Revealing one asks for the laptop PIN, which you already have. Quill''s password is saved there. Loop''s password was never saved. Haven''s was removed twelve days before she was taken, so Haven has to be opened with its emailed code and her security questions.'),
    ('laptop-app', 'quill', 1,
     'Quill, her mail, is locked. Under the password box press Get help signing in. It shows her own password hint. The hint describes a person in her family by how he is related to her. Work out who that is. His first name is the password.'),
    ('laptop-app', 'quill', 2,
     'Her password hint means her husband. His name is on the VICTIM card at the top of the MERCY AI Judge tab, on the Husband line under IDENTITY. Type his first name into Quill''s password box. It is also saved in Orbit: press the key icon in the toolbar and reveal the quill.mail row with the laptop PIN. Haven''s sign-in codes arrive in this inbox.'),
    ('laptop-app', 'wisp', 1,
     'Wisp opens with no password. Six of the chats matter: Nikhil Rao, Rahul Nair, Priya Menon, Vikram Kapoor, the College Batch group, and you. The bank, delivery, promo and unknown-number chats are noise. Every message you open is added to your evidence index. Scroll to the bottom of each chat, to the night she was taken, and read by the timestamps.'),
    ('laptop-app', 'wisp', 2,
     'Open the chat with Vikram Kapoor, your brother. His message to Meera at 23:12 that night says you were staying over and that your mother fed you. She never opened it. Open it so it is in your evidence index. It is half of your alibi. The other half is Vikram''s post on Loop at 23:40 that night.'),
    ('laptop-app', 'loop', 1,
     'Loop is locked. Under the password box press Get help logging in. It asks: When did everything change? The answer is a date. Type it as eight digits with nothing between them: two for the day, two for the month, four for the year.'),
    ('laptop-app', 'loop', 2,
     'The day everything changed for Meera is the day her father died. That date is on the VICTIM card at the top of the MERCY AI Judge tab, under IDENTITY, on the Father line. Read it there and type it as eight digits, day month year, no slashes. Once inside, read the posts of the people around her, not only hers, and read the night she was taken by the timestamps.'),
    ('laptop-app', 'haven', 1,
     'Haven is her video diary. It holds thirty-one recordings with transcripts. There is no password. Sign-in is two steps. First press Email me a sign-in code, and the code arrives in Quill, her mail. Second, answer her security questions. Every question has a Show hint link beside it. Read the hints before you answer.'),
    ('laptop-app', 'haven', 2,
     'Open Quill first so the inbox is ready. Then in Haven press Email me a sign-in code, go back to Quill, open the new mail and type the six-digit code within ten minutes. Then answer the four security questions: where she was born, her pet''s name, her favourite person''s first name, and her childhood password without the year. Press Show hint under each one.'),
    ('laptop-app', 'haven', 3,
     'All four answers are written where you can read them. Birthplace: the VICTIM card at the top of the MERCY AI Judge tab, the Birthplace line, city name only. Pet: the same card, the Residence line names the dog. Favourite person: the same card, the Husband line, first name only. Childhood password: Loop, Messages, her chat with Rahul Nair, where she writes the word and then the year. Type only the word.'),
    ('laptop-app', 'pulsefit', 1,
     'PulseFit shows the SOS alerts from her band. If the screen says No alerts on this device, they are still under evidence seal. The seal breaks when you name the man she feared in the MERCY AI Judge tab, using her last Haven recording. Do that first, then come back here.'),
    ('laptop-app', 'pulsefit', 2,
     'Five alerts, from 22:41 to 02:14. Each has a Send to map button and a Copy button. Press Send to map on the first alert, go to the City Map tab and press Launch drones. Wait for the report, then do the same for the second, third, fourth and fifth, in that order. The fifth fix is 300 metres off, so its pin is not the place.'),
    ('laptop-app', 'photos', 1,
     'Photos shows her Camera Roll, her wedding pictures and her screenshots. Nothing in here is needed by any beat of this hearing. The photographs that decide this case are in the case file PDF under Documents, then Dad, and on Loop. Close this and go there.'),
    ('laptop-app', 'notepad', 1,
     'Notepad only shows a text file that File Explorer opened. It holds nothing of its own. The case is not in this window. Close it and go back to File Explorer, or to Notes for her passwords.'),
    ('laptop-app', 'movies', 1,
     'Movies & TV is the laptop''s video player. The only recording stored on this laptop is the video in the locked folder Documents, then Dad. Every other recording she made is in Haven, her online video diary, opened through Orbit. Go there.'),
    ('map-idle', '', 1,
     'This is my city model. Nothing on it is evidence until the drones report. To send them, type a latitude and a longitude into the Drone search boxes on the right and press Launch drones, or right-click any building on the model. The drones lift off Police HQ, search 60 metres around the point and report back.'),
    ('map-idle', '', 2,
     'The coordinates come from the case, not from the map. Her band''s SOS alerts in PulseFit on the laptop each have a Send to map button that fills the boxes here. A search that finds nothing costs only the flight and takes a place off the list. Vehicle tracking, the locked button at the top, opens by itself once the drones bring back her band''s memo.'),
    ('map-search', '', 1,
     'Let the flight finish. The drones follow the streets and the report is written when they are back. A second flight will not launch until the first has reported. The speed button at the top makes the cars and drones move faster, but the search itself runs at normal speed.'),
    ('map-search', '', 2,
     'Every search is logged on the right whether it finds anything or not, and every report is evidence you can attach in the MERCY AI Judge tab. If you are following a car, it waits at its stop until your drones have searched it, and the next stop is not shown until this one is done. Search the stops one at a time.');

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
    -- the context chains arrived with v3; a schema without them has no
    -- steps to rewrite either
    CONTINUE WHEN to_regclass('context_hints') IS NULL;
    EXECUTE format($ins$
      INSERT INTO %I.context_hints (screen, detail, step, body)
      SELECT screen, detail, step, body FROM tmp_context_hints
      ON CONFLICT (screen, detail, step) DO UPDATE SET body = EXCLUDED.body$ins$, sch);
  END LOOP;
END $mig$;

DROP TABLE tmp_hints;
DROP TABLE tmp_context_hints;
