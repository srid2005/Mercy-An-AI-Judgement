-- mercy-engine v4: the hint desk stops acting and stops answering.
--
-- Two changes, both of them the same rule. A hint informs and does nothing
-- else -- no tab is switched, nothing is opened or revealed for the
-- participant -- so `goto_tab` / `goto_focus` are emptied on every row and
-- POST /api/hint no longer returns a goto. And no step states a PIN, a folder
-- password, a date or a security answer any more: the deepest step of a gate
-- chain names the place the answer is written down, precisely enough to walk
-- to, and the participant reads it themselves. The laptop-lock chain loses its
-- third step to that rule and is two steps long now.
--   docker compose exec -T mercy-engine-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < services/mercy-engine/scripts/migrate_live_v4_hints_info_only.sql
-- Idempotent: safe to run again -- the bodies are re-applied, the ledger and
-- the points a participant has already spent are left alone. Every schema is
-- upgraded ('public', 'template' and every live p_*), so a running event does
-- not need a rebuild.
--
-- The columns stay in the table. Dropping a column under a running event buys
-- nothing that emptying it does not.
--
-- The rows below are the same bytes as db/init.sql's seed; change them in both
-- or the next event and the running one disagree.

-- Held once for the session and copied into each schema below, so the words
-- are written out exactly once in this file.
CREATE TEMP TABLE tmp_context_hints (screen TEXT, detail TEXT, step INTEGER, body TEXT);
INSERT INTO tmp_context_hints (screen, detail, step, body) VALUES
    -- The laptop, before they are in it.
    ('laptop-boot', '', 1,
     'That machine is Meera''s own, imaged the morning after she was taken, and it is still starting. Nothing on this screen is evidence and nothing on it needs you. What comes next is her login, and her login is the first thing in this file you have to solve. Press this again when you are looking at it: I answer the screen you are standing on, not the case in general.'),

    -- The lock. Step 1 sends them to the screen's own password hint; step 2
    -- sends them to the one record in this hearing that carries what the hint
    -- asks for. Neither of them types four digits at a participant: a gate
    -- they were told the answer to is a gate they did not open.
    ('laptop-lock', '', 1,
     'Four digits, and she did not pick them out of the air. That screen carries a password hint of her own -- a line of small grey text under the box, below the refusal if it has already refused you once. It is the truth, not decoration. Read it before you guess at it.'),
    ('laptop-lock', '', 2,
     'What the hint asks for is hers, not yours, and you are not expected to carry it in your head. I am: her particulars are on this file. In the bar across the top of this hearing there is a chip marked VICTIM with her name under it. Open it, and read the second line under IDENTITY -- Date of birth. What that lock screen asked you for is in that line. Go and read it there; I do not say her answers out loud.'),

    ('laptop-desktop', '', 1,
     'You are in. Four things on that desktop carry this case and the rest is her ordinary life. Orbit, which is the only road to her accounts -- Loop, Wisp, Haven. Quill, her mail, which has a lock of its own. Notes, seven of them, one of which she should have shredded. File Explorer, where her documents are. PulseFit is there too and it will be empty: her band''s trail is under seal until you have earned it in the hearing.'),
    ('laptop-desktop', '', 2,
     'One thing on this machine is locked and everything else is open, which is how she thought of it too: Documents, and then Dad. What is behind that padlock is the police file on her father''s death. The password for it is not hidden anywhere clever -- she wrote it down on this same laptop, in the same list as the wifi and the printer.'),

    -- The apps that carry the case. These say what an app is and how to work
    -- it; what the answer IS stays priced on the beat chain, so a step here
    -- never names a piece of evidence or its id. A gate is the same rule: the
    -- deepest step says where the code is written down, never what it is.
    ('laptop-app', 'files', 1,
     'Her documents are what anyone''s are: an Aadhaar copy, a resume, a policy, a marriage certificate, a Coorg booking she never used. One folder is not. It carries a padlock on its tile and it is the only locked thing on this machine. Documents.'),
    ('laptop-app', 'files', 2,
     'Documents, then Dad. Behind it: the police file on her father''s death, and one video she kept a local copy of when she had stopped trusting anything to stay online. The password is written down in Notes -- the yellow one, in with the wifi and the printer, exactly where she was told never to put it.'),

    ('laptop-app', 'notes', 1,
     'Seven notes, and two of them are the case. One is a list of passwords she meant to change and never did. One is four sentences her father used to say, and the fourth of those sentences is about the rock he died on. The grocery list is a grocery list.'),
    ('laptop-app', 'notes', 2,
     'The yellow one, ''logins (CHANGE THESE!!)''. Second line down is Dad''s folder, and the password to it is written out on that line in her own hand, with the reason she chose it after it in brackets. Read it off the note and take it to the padlock in File Explorer: Documents, then Dad. Her father''s case file is inside.'),

    ('laptop-app', 'orbit', 1,
     'Orbit reaches four addresses and nothing else; the rest of the internet is outside my sandbox and the browser will tell you so. loop.social, wisp.chat, haven.cloud, quill.mail -- her whole life in four bookmarks. Two of the four are locked, and the third asks you questions instead.'),
    ('laptop-app', 'orbit', 2,
     'The key in the toolbar is her saved passwords, and it will show them to anyone who can answer the laptop''s own PIN -- which you can, since you are past the lock screen. Quill''s is saved there. Loop''s never was; she refused to let it. Haven''s was, and she deleted it twelve days before she was taken.'),

    ('laptop-app', 'quill', 1,
     'Her mail is locked. Under the box there is a link that offers to help you sign in, and what it gives you is not a hint but a riddle, in her own words, about a name. Press it and read it as she wrote it: she is the one speaking, and she married into your family.'),
    ('laptop-app', 'quill', 2,
     'Read the riddle from her side of that family and the name at the end of it is one you have known all your life. If you would rather read it than reason it, Orbit has it saved: the key in the browser''s toolbar, the quill.mail row, revealed with the laptop''s own PIN. What is inside the mail is a correspondence she kept off her phone on purpose -- and the one-time codes Haven sends land in here too, which is why you will be back at this window.'),

    ('laptop-app', 'wisp', 1,
     'Wisp opens straight in; she never locked it. Six conversations -- Nikhil, Rahul, Priya, your brother, the college group, and you. The night she was taken is at the bottom of all six. Read them by their clock, not by whose name looks interesting.'),
    ('laptop-app', 'wisp', 2,
     'One message in there landed after 23:00 that night -- an hour and a half after she was already gone -- and she never opened it. Who sent it, and where he says he was when he sent it, is the half of your own night that you have still not put in front of me.'),

    ('laptop-app', 'loop', 1,
     'Loop is locked, and its help does not hint, it asks. Press the link that offers to help you log in and she puts a question to you instead of an answer: when did everything change. The box wants a date and it wants it as eight digits with nothing between them -- day, month, year, no slashes.'),
    ('laptop-app', 'loop', 2,
     'The day everything changed for her is the morning her father was found at the base of Sunset Rock, and the quickest place to read that date is here rather than hunting for it: the VICTIM chip at the top of this hearing, under IDENTITY, the Father line -- it carries the day he died. Read it there and type it as eight digits. Once you are in, the posts that matter to you are not her own: read the accounts around her, and read the night she was taken by its timestamps rather than by its faces.'),

    ('laptop-app', 'haven', 1,
     'Haven is her video diary, and it is the spine of this case: thirty-one recordings, dated, tagged and transcribed, including one the laptop never had a copy of. There is no password on it -- she deleted the saved one. Getting in is two steps instead: a code, and then four questions about her.'),
    ('laptop-app', 'haven', 2,
     'The code is emailed. Ask Haven for it and then go and read it in Quill: it is a real message arriving in her inbox, and it dies after ten minutes, so open the mail first and ask for the code second. Then four security questions, asked together, and each one carries a hint of her own writing behind a link beside it. Open all four hints and read them before you answer anything: they are about where she was born, the dog, the person she loved, and the password she has used since she was a child, that last one without the year on the end of it.'),
    ('laptop-app', 'haven', 3,
     'Four questions, four places, and every one of them is open to you already. Where she was born: the VICTIM chip at the top of this hearing, under IDENTITY, the Birthplace line. The dog: the same card, the Residence line, and one of her Notes is titled with his name. The person she loved: the same card again, the Husband line. The password she has kept since she was a child: Loop, her direct messages with Rahul -- he asks her whether she still uses it and she names it in her reply, as a word with the year after it. Haven wants the word without the year. Capitals and punctuation do not matter to it. Inside, work by date: what she tagged to her father''s case, and then the last thing she ever recorded -- the newest entry on the account, and the one this hearing is waiting for.'),

    ('laptop-app', 'pulsefit', 1,
     'Her band kept transmitting after she went out of that door. What it sent is under evidence seal until you have named the man she was afraid of, and I am the one who breaks that seal. If this screen is empty, that is the seal -- and what opens it is not on this laptop, it is in the hearing, in her last recording.'),
    ('laptop-app', 'pulsefit', 2,
     'Five alerts, 22:41 through 02:14, and then the band stops. They are not an answer, they are a route: take them to the city model in the order she sent them, one flight each, and read what the drones bring back from every one. The last fix is the only one that is not a building, and it is the loosest of the five by a long way.'),

    -- The rest of the laptop. A short honest step that clears the ground is
    -- worth its five points at an event run against a clock.
    ('laptop-app', 'photos', 1,
     'Her camera roll, her wedding, her screenshots, and a folder of pictures somebody sent her that she kept out of the way. There is nothing in here that a beat of this hearing asks for. The photographs that decide this case are on the feed, not on the disk.'),
    ('laptop-app', 'notepad', 1,
     'A text viewer. It shows you whatever File Explorer handed it and it holds nothing of its own. If you are reading her notes to herself, read them -- but the case is not in this window, it is in the window that opened it.'),
    ('laptop-app', 'movies', 1,
     'The laptop''s player. The only recording she kept a local copy of sits in the locked folder with her father''s case file; everything else she made lives in her diary, online, where he could not reach it.'),

    -- The map. Mine, not hers: nothing on it is evidence until the drones
    -- bring something back.
    ('map-idle', '', 1,
     'This model is mine, not hers. Nothing on it is evidence until my drones bring something back. You send them two ways: type a latitude and a longitude into the box on the right and launch, or right-click any building on the model. Four lift off the roof of Police HQ, thread between the buildings, and sweep sixty metres around the point.'),
    ('map-idle', '', 2,
     'Coordinates come from the case, not from the map: I will not mark her for you, and I will not stop you looking anywhere. A sweep that finds nothing costs you only the flight and it takes a place off the list. When there is finally a car worth following, the padlock on Vehicle tracking opens by itself.'),

    ('map-search', '', 1,
     'Let it finish. The drones fly the line the streets allow and the frames come back as they sweep; the report is written when they are home, and a second flight will not leave the roof until the first has reported. The speed control runs the city at three times if you are impatient -- the sweep itself ignores it.'),
    ('map-search', '', 2,
     'Every sweep is logged whatever it finds. If you are following a car, it waits at the kerb until your drones have cleared the stop it is standing at, and I do not name the next stop until this one is finished -- so nothing is lost by taking them one at a time, and nothing is gained by hurrying them.');
-- laptop-lock step 3 used to read out the four digits, which is the thing this
-- migration exists to stop. It is withdrawn from the chain, but a participant
-- who has already paid for it keeps a row nobody can sell them again -- so
-- those words are rewritten rather than left standing with the answer in them.
CREATE TEMP TABLE tmp_retired_hints (screen TEXT, detail TEXT, step INTEGER, body TEXT);
INSERT INTO tmp_retired_hints (screen, detail, step, body) VALUES
    ('laptop-lock', '', 3,
     'You have already been told where it is written: the VICTIM chip at the top of this hearing, under IDENTITY, second line, Date of birth. There is nothing past that on this screen. Go and read it, and type the part of it that her own password hint asked you for.');

DO $mig$ DECLARE sch TEXT; BEGIN
  FOR sch IN SELECT nspname FROM pg_namespace WHERE nspname IN ('public', 'template') OR nspname LIKE 'p\_%' LOOP
    EXECUTE format('SET LOCAL search_path TO %I', sch);
    -- only a schema that is actually one of ours
    CONTINUE WHEN to_regclass('case_state') IS NULL;
    -- a schema that never saw v3 gets the tables here rather than nothing
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
      INSERT INTO %I.context_hints (screen, detail, step, body)
      SELECT screen, detail, step, body FROM tmp_context_hints
      ON CONFLICT (screen, detail, step)
      DO UPDATE SET body = EXCLUDED.body, goto_tab = NULL, goto_focus = NULL$ins$, sch);
    -- a step withdrawn from db/init.sql goes out of the live schemas too,
    -- unless somebody has already paid for it: those words stay readable
    EXECUTE format($del$
      DELETE FROM %I.context_hints h
      WHERE NOT EXISTS (SELECT 1 FROM tmp_context_hints t
                        WHERE t.screen = h.screen AND t.detail = h.detail AND t.step = h.step)
        AND NOT EXISTS (SELECT 1 FROM %I.context_hints_taken k
                        WHERE k.screen = h.screen AND k.detail = h.detail AND k.step = h.step)$del$, sch, sch);
    -- and what survived that delete is a paid-for step with a secret in it
    EXECUTE format($ret$
      UPDATE %I.context_hints h SET body = r.body
      FROM tmp_retired_hints r
      WHERE h.screen = r.screen AND h.detail = r.detail AND h.step = r.step$ret$, sch);
    -- nothing navigates any more, on any row, including rows this file does
    -- not otherwise touch
    EXECUTE format($go$
      UPDATE %I.context_hints SET goto_tab = NULL, goto_focus = NULL
      WHERE goto_tab IS NOT NULL OR goto_focus IS NOT NULL$go$, sch);
  END LOOP;
END $mig$;

DROP TABLE tmp_context_hints;
DROP TABLE tmp_retired_hints;
