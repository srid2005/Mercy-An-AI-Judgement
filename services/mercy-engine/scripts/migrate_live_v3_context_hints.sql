-- mercy-engine: the context chains, for a running game (init.sql only runs on a
-- fresh volume). Adds context_hints -- the hint desk's answer to "what is on
-- their screen right now" rather than "which beat are they stuck on" -- and
-- context_hints_taken, the half of the charge ledger keyed the way a context
-- step is keyed, so a step and a beat tier are never charged against each
-- other.
--   docker compose exec -T mercy-engine-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < services/mercy-engine/scripts/migrate_live_v3_context_hints.sql
-- Idempotent: safe to run again -- the bodies and the goto targets are
-- re-applied, the ledger and the points a participant has already spent are
-- left alone. Every schema is upgraded ('public', 'template' and every live
-- p_*), so a running event does not need a rebuild.
--
-- The bodies are the same text as db/init.sql; change them in both or the next
-- event and the running one disagree.

-- Held once for the session and copied into each schema below, so the words
-- are written out exactly once in this file.
CREATE TEMP TABLE tmp_context_hints (screen TEXT, detail TEXT, step INTEGER, body TEXT, goto_tab TEXT, goto_focus TEXT);
INSERT INTO tmp_context_hints (screen, detail, step, body, goto_tab, goto_focus) VALUES
    -- The laptop, before they are in it.
    ('laptop-boot', '', 1,
     'That machine is Meera''s own, imaged the morning after she was taken, and it is still starting. Nothing on this screen is evidence and nothing on it needs you. What comes next is her login, and her login is the first thing in this file you have to solve. Press this again when you are looking at it: I answer the screen you are standing on, not the case in general.',
     'laptop', NULL),

    ('laptop-lock', '', 1,
     'Four digits, and she did not pick them out of the air. The screen in front of you tells you what they are made of -- there is a line of small grey text under the box, and it is the truth, not decoration. Read that before you start guessing at it.',
     NULL, NULL),
    ('laptop-lock', '', 2,
     'Her birth year. Hers, not yours, and you are not expected to carry it in your head. I am: her particulars are the first thing on this file. The victim card at the top of the hearing has her date of birth in it, second line under IDENTITY. I am opening it for you now.',
     'mercy', 'victim-popover'),
    ('laptop-lock', '', 3,
     '12-03-1998. The four digits are the year and nothing else: 1998. If it is refused you have typed the day and the month with it.',
     'laptop', NULL),

    ('laptop-desktop', '', 1,
     'You are in. Four things on that desktop carry this case and the rest is her ordinary life. Orbit, which is the only road to her accounts -- Loop, Wisp, Haven. Quill, her mail, which has a lock of its own. Notes, seven of them, one of which she should have shredded. File Explorer, where her documents are. PulseFit is there too and it will be empty: her band''s trail is under seal until you have earned it in the hearing.',
     NULL, NULL),
    ('laptop-desktop', '', 2,
     'One thing on this machine is locked and everything else is open, which is how she thought of it too: Documents, and then Dad. What is behind that padlock is the police file on her father''s death. The password for it is not hidden anywhere clever -- she wrote it down on this same laptop, in the same list as the wifi and the printer.',
     NULL, NULL),

    -- The apps that carry the case. These say what an app is and how to work
    -- it; what the answer IS stays priced on the beat chain, so a step here
    -- never names a piece of evidence or its id.
    ('laptop-app', 'files', 1,
     'Her documents are what anyone''s are: an Aadhaar copy, a resume, a policy, a marriage certificate, a Coorg booking she never used. One folder is not. It carries a padlock on its tile and it is the only locked thing on this machine. Documents.',
     NULL, NULL),
    ('laptop-app', 'files', 2,
     'Documents, then Dad. Behind it: the police file on her father''s death, and one video she kept a local copy of when she had stopped trusting anything to stay online. The password is written down in Notes -- the yellow one, in with the wifi and the printer, exactly where she was told never to put it.',
     NULL, NULL),

    ('laptop-app', 'notes', 1,
     'Seven notes, and two of them are the case. One is a list of passwords she meant to change and never did. One is four sentences her father used to say, and the fourth of those sentences is about the rock he died on. The grocery list is a grocery list.',
     NULL, NULL),
    ('laptop-app', 'notes', 2,
     'The yellow note, ''logins (CHANGE THESE!!)''. Second line down: Dad''s folder, 1708RoseCafe. That opens Documents\Dad in File Explorer, and her father''s case file is inside it.',
     NULL, NULL),

    ('laptop-app', 'orbit', 1,
     'Orbit reaches four addresses and nothing else; the rest of the internet is outside my sandbox and the browser will tell you so. loop.social, wisp.chat, haven.cloud, quill.mail -- her whole life in four bookmarks. Two of the four are locked, and the third asks you questions instead.',
     NULL, NULL),
    ('laptop-app', 'orbit', 2,
     'The key in the toolbar is her saved passwords, and it will show them to anyone who can answer the laptop''s own PIN -- which you can, since you are past the lock screen. Quill''s is saved there. Loop''s never was; she refused to let it. Haven''s was, and she deleted it twelve days before she was taken.',
     NULL, NULL),

    ('laptop-app', 'quill', 1,
     'Her mail is locked, and what it offers is a riddle rather than a hint: my father-in-law''s son''s name. Read it as she wrote it -- she is the one speaking, and she married into your family.',
     NULL, NULL),
    ('laptop-app', 'quill', 2,
     'Her father-in-law is your father. Your father''s son is you. The answer is your own name, and Orbit''s password manager has it saved as well if you would rather read it than reason it. What is inside is a correspondence she kept off her phone on purpose -- and the one-time codes Haven sends land in here too.',
     NULL, NULL),

    ('laptop-app', 'wisp', 1,
     'Wisp opens straight in; she never locked it. Six conversations -- Nikhil, Rahul, Priya, your brother, the college group, and you. The night she was taken is at the bottom of all six. Read them by their clock, not by whose name looks interesting.',
     NULL, NULL),
    ('laptop-app', 'wisp', 2,
     'One message in there landed after 23:00 that night -- an hour and a half after she was already gone -- and she never opened it. Who sent it, and where he says he was when he sent it, is the half of your own night that you have still not put in front of me.',
     NULL, NULL),

    ('laptop-app', 'loop', 1,
     'Loop is locked, and its help does not hint, it asks: when did everything change? It is a date, typed as eight digits with nothing between them, and it is the date this entire file starts from -- the morning her father was found at the base of the rock.',
     NULL, NULL),
    ('laptop-app', 'loop', 2,
     '14 October 2018. 14102018. Once you are in, the posts that matter to you are not her own: read the accounts around her, and read the night she was taken by its timestamps rather than by its faces.',
     NULL, NULL),

    ('laptop-app', 'haven', 1,
     'Haven is her video diary, and it is the spine of this case: thirty-one recordings, dated, tagged and transcribed, including one the laptop never had a copy of. There is no password on it -- she deleted the saved one. Getting in is two steps instead: a code, and then four questions about her.',
     NULL, NULL),
    ('laptop-app', 'haven', 2,
     'The code is emailed. Ask Haven for it and then go and read it in Quill: it is a real message arriving in her inbox, and it dies after ten minutes, so open the mail first and ask for the code second. Then four security questions, and every answer to them is somewhere else in this case -- where she was born, the dog, the person she loved, and the password she has used since she was a child, that last one without the year on the end of it.',
     NULL, NULL),
    ('laptop-app', 'haven', 3,
     'Bengaluru. Bruno. Arjun. NeverForget. Capitals and punctuation do not matter to it. Inside, work by date: what she tagged to her father''s case, and everything she recorded in her last fortnight.',
     NULL, NULL),

    ('laptop-app', 'pulsefit', 1,
     'Her band kept transmitting after she went out of that door. What it sent is under evidence seal until you have named the man she was afraid of, and I am the one who breaks that seal. If this screen is empty, that is the seal -- and what opens it is not on this laptop, it is in the hearing.',
     'mercy', NULL),
    ('laptop-app', 'pulsefit', 2,
     'Five alerts, 22:41 through 02:14, and then the band stops. They are not an answer, they are a route: take them to the city model in the order she sent them, one flight each, and read what the drones bring back from every one. The last fix is the only one that is not a building, and it is the loosest of the five by a long way.',
     'map', NULL),

    -- The rest of the laptop. A short honest step that clears the ground is
    -- worth its five points at an event run against a clock.
    ('laptop-app', 'photos', 1,
     'Her camera roll, her wedding, her screenshots, and a folder of pictures somebody sent her that she kept out of the way. There is nothing in here that a beat of this hearing asks for. The photographs that decide this case are on the feed, not on the disk.',
     NULL, NULL),
    ('laptop-app', 'notepad', 1,
     'A text viewer. It shows you whatever File Explorer handed it and it holds nothing of its own. If you are reading her notes to herself, read them -- but the case is not in this window, it is in the window that opened it.',
     NULL, NULL),
    ('laptop-app', 'movies', 1,
     'The laptop''s player. The only recording she kept a local copy of sits in the locked folder with her father''s case file; everything else she made lives in her diary, online, where he could not reach it.',
     NULL, NULL),

    -- The map. Mine, not hers: nothing on it is evidence until the drones
    -- bring something back.
    ('map-idle', '', 1,
     'This model is mine, not hers. Nothing on it is evidence until my drones bring something back. You send them two ways: type a latitude and a longitude into the box on the right and launch, or right-click any building on the model. Four lift off the roof of Police HQ, thread between the buildings, and sweep sixty metres around the point.',
     NULL, NULL),
    ('map-idle', '', 2,
     'Coordinates come from the case, not from the map: I will not mark her for you, and I will not stop you looking anywhere. A sweep that finds nothing costs you only the flight and it takes a place off the list. When there is finally a car worth following, the padlock on Vehicle tracking opens by itself.',
     NULL, NULL),

    ('map-search', '', 1,
     'Let it finish. The drones fly the line the streets allow and the frames come back as they sweep; the report is written when they are home, and a second flight will not leave the roof until the first has reported. The speed control runs the city at three times if you are impatient -- the sweep itself ignores it.',
     NULL, NULL),
    ('map-search', '', 2,
     'Every sweep is logged whatever it finds. If you are following a car, it waits at the kerb until your drones have cleared the stop it is standing at, and I do not name the next stop until this one is finished -- so nothing is lost by taking them one at a time, and nothing is gained by hurrying them.',
     NULL, NULL);

DO $mig$ DECLARE sch TEXT; BEGIN
  FOR sch IN SELECT nspname FROM pg_namespace WHERE nspname IN ('public', 'template') OR nspname LIKE 'p\_%' LOOP
    EXECUTE format('SET LOCAL search_path TO %I', sch);
    -- only a schema that is actually one of ours
    CONTINUE WHEN to_regclass('case_state') IS NULL;
    EXECUTE format($ddl$
      CREATE TABLE IF NOT EXISTS %I.context_hints (
        screen      TEXT NOT NULL,
        detail      TEXT NOT NULL DEFAULT '',
        step        INTEGER NOT NULL CHECK (step IN (1, 2, 3)),
        body        TEXT NOT NULL,
        goto_tab    TEXT CHECK (goto_tab IN ('mercy', 'laptop', 'map')),
        goto_focus  TEXT,
        PRIMARY KEY (screen, detail, step))$ddl$, sch);
    EXECUTE format($ddl$
      CREATE TABLE IF NOT EXISTS %I.context_hints_taken (
        screen      TEXT NOT NULL,
        detail      TEXT NOT NULL DEFAULT '',
        step        INTEGER NOT NULL,
        cost        INTEGER NOT NULL,
        taken_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (screen, detail, step))$ddl$, sch);
    -- the bodies are re-applied on a re-run; a chain that has been rewritten
    -- since the last migration should read the same in every live schema
    EXECUTE format($ins$
      INSERT INTO %I.context_hints (screen, detail, step, body, goto_tab, goto_focus)
      SELECT screen, detail, step, body, goto_tab, goto_focus FROM tmp_context_hints
      ON CONFLICT (screen, detail, step)
      DO UPDATE SET body = EXCLUDED.body, goto_tab = EXCLUDED.goto_tab, goto_focus = EXCLUDED.goto_focus$ins$, sch);
    -- a step withdrawn from db/init.sql goes out of the live schemas too,
    -- unless somebody has already paid for it: those words stay readable
    EXECUTE format($del$
      DELETE FROM %I.context_hints h
      WHERE NOT EXISTS (SELECT 1 FROM tmp_context_hints t
                        WHERE t.screen = h.screen AND t.detail = h.detail AND t.step = h.step)
        AND NOT EXISTS (SELECT 1 FROM %I.context_hints_taken k
                        WHERE k.screen = h.screen AND k.detail = h.detail AND k.step = h.step)$del$, sch, sch);
  END LOOP;
END $mig$;

DROP TABLE tmp_context_hints;
