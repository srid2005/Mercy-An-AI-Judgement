-- mercy-engine's own database.
--
-- This service owns none of the story's evidence -- every other service
-- does that. What it owns is the participant's side of the game: what
-- they've actually found (discovered_evidence), the argument itself
-- (transcript), the running verdict (case_state, which MERCY moves on every
-- turn), the running bill for the hints she has been argued against with,
-- and the story's beats
-- (checkpoints, which no longer move that verdict). evidence_cache is a local
-- copy of records fetched from the owning services (plus a handful this
-- service seeds itself, for evidence with no live API -- the case file's
-- photographs, and the band's SOS alerts), kept so the chat can re-render a
-- card without re-fetching.

-- Same time anchor as social-media / whatsapp / email / haven: story dates
-- are written as fixed 2024 calendar dates, remapped relative to now() at
-- seed time so all services' timelines stay mutually consistent. Verbatim
-- from services/haven/db/init.sql; used by the smartwatch rows below.
CREATE FUNCTION t(orig TIMESTAMPTZ) RETURNS TIMESTAMPTZ AS $$
  -- Pinned to 21:40 IST *yesterday* whatever the clock says at seed time, so
  -- "that night" is a night in every app and every derived time stays true.
  SELECT ((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') - interval '1 day' + interval '21 hours 40 minutes') AT TIME ZONE 'Asia/Kolkata')
         + (orig - TIMESTAMPTZ '2024-09-02 21:40:00+05:30');
$$ LANGUAGE SQL STABLE;

CREATE TABLE discovered_evidence (
    evidence_id    TEXT PRIMARY KEY,
    discovered_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE evidence_cache (
    evidence_id  TEXT PRIMARY KEY,
    service      TEXT NOT NULL,
    type         TEXT NOT NULL,
    timestamp    TIMESTAMPTZ,
    summary      TEXT NOT NULL,
    involves     TEXT[] NOT NULL DEFAULT '{}',
    content      JSONB NOT NULL DEFAULT '{}',
    cached_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Evidence MERCY judged to have actually carried the claim it was attached
-- to -- not merely attached, and not necessarily all of what was attached
-- that turn. The beats fire against this set, not the raw
-- discovered_evidence set, so the right piece beside no real argument
-- proves nothing.
CREATE TABLE accepted_evidence (
    evidence_id  TEXT PRIMARY KEY,
    accepted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per turn, in order. evidence_ids is what the participant attached
-- to that turn (empty for MERCY's own turns, and for text-only participant
-- turns that argued without evidence). verdict and delta are MERCY's judgement
-- of the turn, written on her own row: the standing moves every turn now, so
-- a reload has to be able to read back how each move was earned -- and the
-- hint engine reads the recent ones to see how the participant is doing.
-- A live database gets the two columns from
-- scripts/migrate_live_v2_ai_meter.sql.
CREATE TABLE transcript (
    id            SERIAL PRIMARY KEY,
    role          TEXT NOT NULL CHECK (role IN ('participant', 'mercy')),
    body          TEXT NOT NULL,
    evidence_ids  TEXT[] NOT NULL DEFAULT '{}',
    checkpoint_hit TEXT,                         -- code of the checkpoint this turn triggered, if any
    verdict       TEXT CHECK (verdict IN ('advanced', 'partial', 'rejected', 'contradicted')),
    delta         NUMERIC(4,1),                  -- the change this turn made to guilt_percent, signed, after the guards
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single-row table: the live verdict -- and, for the event, the clock. The
-- lobby's start writes started_at and deadline (GAME_MINUTES later); the
-- file then closes one way: 'solved' (the rescue, or the last checkpoint),
-- 'timeout' (the deadline, applied on the next read), 'left' (the
-- participant's own choice) -- NULL while it is open. reported_at is when
-- that outcome was told to the lobby, once. updated_at is written by every
-- way of concluding and by nothing after, so it is also when the file
-- closed. A live database gets the four columns from
-- scripts/migrate_live_clock.sql.
--
-- hint_cost is the hint bill: what POST /api/hint has charged so far, tier
-- by tier (5 / 10 / 20), with no ceiling -- a participant can always buy the
-- next step, and what it all came to ranks the leaderboard under 'solved',
-- lowest first, so a file argued unaided beats the same file bought a piece
-- at a time. hints_used is how many hints were actually charged for. points
-- is the budget that used to be spent down from a hundred and refuse the
-- next hint at zero; nothing reads or writes it any more, and it stays in
-- the table because a column is never dropped under a running event.
-- points and hints_used are from scripts/migrate_live_v2_hints.sql on a
-- live database, hint_cost from scripts/migrate_live_v5_hint_cost.sql.
CREATE TABLE case_state (
    id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    guilt_percent   NUMERIC(4,1) NOT NULL,
    concluded       BOOLEAN NOT NULL DEFAULT false,
    started_at      TIMESTAMPTZ,
    deadline        TIMESTAMPTZ,
    outcome         TEXT CHECK (outcome IN ('solved', 'timeout', 'left')),
    reported_at     TIMESTAMPTZ,
    points          INTEGER NOT NULL DEFAULT 100 CHECK (points >= 0),
    hints_used      INTEGER NOT NULL DEFAULT 0,
    hint_cost       INTEGER NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO case_state (id, guilt_percent) VALUES (1, 96.8);

-- The script. `required_ids` must ALL be in the participant's accumulated
-- accepted-evidence set (not necessarily attached in the same turn) for the
-- checkpoint to fire. Every un-hit beat is tested on every turn, so evidence
-- argued out of order still registers the moment the set covers a beat.
--
-- Checkpoints no longer move the verdict: MERCY sets guilt_percent herself,
-- every turn, on what that turn was worth (server.js:/api/argue). What a beat
-- still does is story -- open its gates, say its line, and, for 'located',
-- end the game. `guilt_after` is the old script's number, kept only so the
-- retuning history is readable; `guilt_at_hit` is what the standing actually
-- was when the beat fired, which is what /api/state reports.
--
-- `unlocks` names the gates a checkpoint opens when it fires; GET /api/state
-- reports each gate in the fixed list server.js:GATES as open/closed, and
-- the console pushes them to the laptop. The gate is the checkpoint row, not
-- a number, so retuning guilt_after never moves it silently. `reaction` is
-- MERCY's own line for the beat, appended (after a blank line) to the reply
-- of the turn that fires it.
CREATE TABLE checkpoints (
    code          TEXT PRIMARY KEY,
    sort_order    INTEGER NOT NULL,
    label         TEXT NOT NULL,
    required_ids  TEXT[] NOT NULL,
    guilt_after   NUMERIC(4,1) NOT NULL,
    unlocks       TEXT[] NOT NULL DEFAULT '{}',
    reaction      TEXT,
    hit           BOOLEAN NOT NULL DEFAULT false,
    hit_at        TIMESTAMPTZ,
    guilt_at_hit  NUMERIC(4,1)                   -- the standing when this beat fired; NULL until it does
);

INSERT INTO checkpoints (code, sort_order, label, required_ids, guilt_after, unlocks, reaction) VALUES
    -- The participant clears himself first: his brother's message to Meera
    -- and the post from their mother's house that night (WA-199, SOC-050).
    ('the_alibi', 1, 'The alibi',
     ARRAY['WA-199', 'SOC-050'], 90.0, '{}',
     'Your brother''s chai. His post at 23:40, and two messages she never opened. You were where you said you were. That is not the same as knowing where she is -- but it is where a file like this has to start.'),
    ('gate_timeline', 2, 'The gate timeline',
     ARRAY['CASE-GATE', 'HAV-021'], 82.0, '{}',
     'The register and her timeline agree. Two men on the rock, and a scooter that left fast. I am listening.'),
    ('the_object', 3, 'The carabiner',
     ARRAY['CASE-EFFECTS', 'SOC-025'], 70.0, '{}',
     'A carabiner that was not his, tagged to a club he never joined, in a photo the file never looked at. Go on.'),
    ('the_motive', 4, 'The motive',
     ARRAY['HAV-029'], 42.0, '{}',
     '"Stay away from her." A father, a warning, a fall. That is a motive, and it is not yours.'),
    -- Naming Rahul from the last Haven recording releases the band's five
    -- SOS alerts (SW-01..SW-05) to the laptop: the 'sos_released' gate.
    ('the_confession', 5, 'Named',
     ARRAY['HAV-031'], 22.0, ARRAY['sos_released'],
     'Rahul Nair. The clip, the 5:48 call, the register: six years old, and they hold. But a name is not a place, and her band did not stop at the door. Five alerts, held under evidence seal until you had earned them. They are on the laptop now. Sweep them in order; the drones will not enter the last one blind.'),
    -- SW-06 is the band's voice memo, recovered by the drone sweep of the
    -- cave on Kettle Hill (city-map's 'trace' outcome, found=false).
    ('the_cave', 6, 'Not Rahul',
     ARRAY['SW-06'], 8.0, '{}',
     'Her voice. Not Rahul''s car and not Rahul''s cave: Nikhil Rao -- the alibi that kept a killer free for six years, the sender of the emails, the jacket folded where you were meant to find it. Rahul came to her door to confess and watched her run into the wrong car. I have Nikhil''s plate. The map is following it now. He has stopped six times since 02:16. She is at one of them.'),
    -- 'MAP-FOUND' isn't a real evidence id -- server.js adds it to the
    -- accepted set once the participant has argued from a drone search
    -- whose result actually found her, since which search id that is can't
    -- be known ahead of time. MAP-FOUND now means an accepted search found
    -- her at one of Nikhil's stops; the cave returns found=false by design.
    ('located', 7, 'Located',
     ARRAY['SW-06', 'MAP-FOUND'], 3.0, '{}',
     'Alive, and where he left her. Units are moving. The file against you is closed.');

-- The hint engine. Three tiers per beat, each added to case_state.hint_cost:
-- tier 1 (5 points) says which app or which part of the city the answer is
-- in; tier 2 (10) says what to look for once they are there; tier 3 (20)
-- names the piece and its evidence id. Each tier is written to be genuinely
-- enough at its price and to give away nothing the tier above it is for --
-- a tier 1 that names a piece is a tier 3 sold cheap.
--
-- POST /api/hint picks the beat from where the participant is actually
-- stuck (the next un-hit checkpoint, minus what it has already accepted),
-- so these are keyed on the checkpoint, not on an evidence id. The nav
-- button's ladder starts past the advice they have already followed
-- (server.js:ladderStart): tier 1 is skipped once a piece the beat needs has
-- been discovered, once five drone searches have been made (the_cave), or
-- once the memo is accepted (located) -- so every tier 2 below is written to
-- be read first by someone who has done what tier 1 says.
CREATE TABLE hints (
    checkpoint_code  TEXT NOT NULL,
    tier             INTEGER NOT NULL CHECK (tier IN (1, 2, 3)),
    body             TEXT NOT NULL,
    PRIMARY KEY (checkpoint_code, tier)
);

-- What has been bought, and for how much. A second request for a hint
-- already taken returns the same words free -- the participant paid for the
-- knowledge, not for the click -- so this is also the charge ledger.
CREATE TABLE hints_taken (
    checkpoint_code  TEXT NOT NULL,
    tier             INTEGER NOT NULL,
    cost             INTEGER NOT NULL,
    taken_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (checkpoint_code, tier)
);

INSERT INTO hints (checkpoint_code, tier, body) VALUES
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

    -- The ladder starts at tier 2 for a participant with five drone searches
    -- behind them (server.js:ladderStart), so tier 2 has to stand on its own:
    -- it tells someone who has swept every fix, and the pin of the fifth,
    -- where the place actually is, and tier 1 carries the sweep-in-order
    -- instruction instead.
    ('the_cave', 1, 'A name is not a place, and her band did not stop when she went out of the door. Five alerts are on the laptop now, released to PulseFit, and the map takes coordinates. Sweep them in the order she sent them, one flight each: the drones will not enter the last one blind.'),
    ('the_cave', 2, 'The fifth fix is the only one that is not a building, and the band was under rock when it sent it: three hundred metres of error, so the pin is scree and thorn, and the pin is not the place. She told you the place herself, when she was a child. ''Our secret kingdom'' -- the cave in the two childhood photographs on her feed, tagged to Rahul, the one he asked her about the night before she was taken. Those photographs carry a geotag. Take it to the map, once the four fixes before it are swept. What the drones bring back from there is not her. It is what she left behind so that you would know it was her.'),
    ('the_cave', 3, 'SW-06: the two-minute voice memo on her band, recovered with her folded jacket from the cave on the north face of Kettle Hill -- the geotag on SOC-006, 12.951181, 77.501304, the one cave on that face of the model. Sweep it, play the memo, attach it. She names the man who took her in it, and the name is not the one you just gave me.'),

    ('located', 1, 'The memo gave you a plate. A plate is enough for the map to follow a car, and tracking is open to you now. She is not at the cave and she is not where the band stopped.'),
    ('located', 2, 'His car was read by six cameras between 02:58 and 05:33 and it has not stopped moving since. Follow it. It waits at each of its stops until your drones have been there, so nothing is lost by sweeping them one at a time -- and she is at one of them, alive, behind a door that locks from outside.'),
    ('located', 3, 'Nikhil Rao, KA 05 MN 4471, a grey hatchback. Follow it on the map and search every stop it makes: the campus basement under his own office, the stadium first-aid room, the market cold store, the rented house at the foot of Kettle Hill, Harrow Mills Unit 4, the chapel store behind the vestry. One of the six is thermal-positive. Search it and she is found.');

-- ---------------------------------------------------------------------------
-- The context chains. The hint desk's other question: not "which beat is this
-- participant stuck on" but "what is on their screen right now". The console
-- reports where they are standing (mercy:context, a fixed vocabulary of screen
-- keys) and sends it with every press of the hint button; POST /api/hint
-- serves the next step of the chain for that screen, so pressing again
-- escalates instead of repeating -- but only while that screen is a gate they
-- are provably still held at (server.js:heldAtGate): the lock screen, or
-- Quill / Loop / Haven / Notes / File Explorer with nothing yet discovered
-- from behind its password. Everywhere else the beat answers, because a
-- participant on the map who has swept every fix is stuck on the cave, not on
-- how the map works. The other chains below stay seeded: they are still the
-- right words for a gate that is added later, and a live schema never loses
-- rows.
--
-- `screen` is the key, `detail` narrows it -- the app inside 'laptop-app' --
-- and '' is the chain for the whole screen, used when a detail has no chain of
-- its own. Steps are priced exactly like the beat tiers (5 / 10 / 20), so what
-- a step is allowed to say is bounded the same way: these chains say what a
-- screen IS and how to work it, and they never name a piece of evidence or its
-- id. Naming the piece is what the beat chain is for, and it is priced for it.
-- A gate is bounded harder still. No step states a PIN, a folder password, a
-- date or a security answer: the deepest step names the place the answer is
-- written down, precisely enough to walk to, and the participant reads it
-- themselves. A gate somebody was told the answer to is a gate they did not
-- open, and the door is most of what this hour is.
--
-- `goto_tab` / `goto_focus` are dead and kept: a hint tells, it does not act.
-- Nothing writes them, /api/hint does not read them and the response no longer
-- carries a goto, so the words have to be enough on their own -- which is why
-- every step below names the screen, the panel and the line to read. The
-- columns stay in the table only because dropping them under a live event buys
-- nothing.
--
-- There is deliberately no chain for 'console-mercy'. A participant standing
-- at the hearing is not lost on a screen, they are stuck on a beat -- and the
-- beat chain is already the right answer for them, which is what the endpoint
-- falls through to when no chain matches.
CREATE TABLE context_hints (
    screen      TEXT NOT NULL,
    detail      TEXT NOT NULL DEFAULT '',
    step        INTEGER NOT NULL CHECK (step IN (1, 2, 3)),
    body        TEXT NOT NULL,
    goto_tab    TEXT CHECK (goto_tab IN ('mercy', 'laptop', 'map')),
    goto_focus  TEXT,
    PRIMARY KEY (screen, detail, step)
);

-- The second half of the charge ledger, keyed the way a context step is keyed.
-- A step and a beat tier are different knowledge bought against different
-- questions, so they are charged and remembered apart: owning 'laptop-lock'
-- step 2 has nothing to do with owning tier 2 of the beat they are on. Kept in
-- its own table rather than folded into hints_taken so that the live event's
-- ledger never has to have its primary key rebuilt under a running game.
-- Same rule as hints_taken: a step already paid for is free the second time.
CREATE TABLE context_hints_taken (
    screen      TEXT NOT NULL,
    detail      TEXT NOT NULL DEFAULT '',
    step        INTEGER NOT NULL,
    cost        INTEGER NOT NULL,
    taken_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (screen, detail, step)
);

INSERT INTO context_hints (screen, detail, step, body) VALUES
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

-- Evidence with no live service to fetch it from: the case file's own
-- photographs. Served by this container from public/case-photos/.
INSERT INTO evidence_cache (evidence_id, service, type, timestamp, summary, involves, content) VALUES
    ('CASE-PARTICULARS', 'case-files', 'document_page', '2018-10-14 08:55:00+05:30',
     'UDR 0412/2018, page 1: particulars of the deceased -- Ravi Sharma, retired engineer, Malleshwaram.',
     ARRAY['ravi_sharma'],
     '{"page":1,"image_url":"/case-photos/ravi sharma.jpg","caption":"Ravi Sharma, 61. Photo supplied by the family for the first information report."}'),
    ('CASE-ROCK', 'case-files', 'document_page', '2018-10-14 09:40:00+05:30',
     'UDR 0412/2018, page 2, exhibit 1: Sunset Rock from the trail below.',
     ARRAY['ravi_sharma'],
     '{"page":2,"exhibit":1,"image_url":"/case-photos/photo-1-rock.png","caption":"Sunset Rock from the trail below. The ledge at top right; the deceased was found at the base, left of centre."}'),
    ('CASE-LEDGE', 'case-files', 'document_page', '2018-10-14 09:40:00+05:30',
     'UDR 0412/2018, page 2, exhibit 2: the ledge, moss scuffed at the lip.',
     ARRAY['ravi_sharma'],
     '{"page":2,"exhibit":2,"image_url":"/case-photos/photo-2-ledge.png","caption":"The ledge on top of the rock. Moss scuffed at the lip. Water bottle of the deceased standing near the scramble."}'),
    ('CASE-BASE', 'case-files', 'document_page', '2018-10-14 09:40:00+05:30',
     'UDR 0412/2018, page 2, exhibit 3: base of the rock, taped off.',
     ARRAY['ravi_sharma'],
     '{"page":2,"exhibit":3,"image_url":"/case-photos/photo-3-base.png","caption":"Base of the rock, trail side, taped off. Position of the body marked."}'),
    ('CASE-EFFECTS', 'case-files', 'document_page', '2018-10-14 09:40:00+05:30',
     'UDR 0412/2018, page 2, exhibit 4: effects, including a blue carabiner with tag "TD 2018" that was not his.',
     ARRAY['ravi_sharma'],
     '{"page":2,"exhibit":4,"image_url":"/case-photos/photo-4-effects.png","caption":"Effects as recovered: wallet, phone, keys, water bottle, and the carabiner clip with tag ''TD 2018''."}'),
    ('CASE-GATE', 'case-files', 'document_page', '2018-10-14 12:10:00+05:30',
     'UDR 0412/2018, page 3, exhibit 5: the forest gate, and the register entry for the scooter that came in at 06:05 and left at 07:35, "fast".',
     ARRAY['ravi_sharma'],
     '{"page":3,"exhibit":5,"image_url":"/case-photos/photo-5-gate.png","caption":"Kanakapura Road gate and guard hut. The register is kept on the desk inside. A scooter is logged in at 06:05, out at 07:35, ''fast''."}');

-- Evidence with no live service either: ten photos that exist only on the
-- laptop's own filesystem (seven hidden in AppData, three in the Recycle
-- Bin) -- nothing sent or received through Wisp, Loop, Quill or Haven's own
-- databases, so none of those services can serve them. Served here by
-- reference to the laptop's own static files (desktop-shell, port 3000).
INSERT INTO evidence_cache (evidence_id, service, type, timestamp, summary, involves, content) VALUES
    ('LAP-PHOTO-01', 'desktop-shell', 'photo', '2024-06-14 00:00:00+05:30',
     'A photo saved to a hidden folder, 14 June 2024. Never posted, never sent from this device.',
     ARRAY['meera'], '{"image_url":"http://localhost:3000/files/photos/hidden/IMG-20240614-WA0007.jpg","caption":"Found in a hidden folder on the laptop, not in any album."}'),
    ('LAP-PHOTO-02', 'desktop-shell', 'photo', '2024-06-14 00:05:00+05:30',
     'A second photo from the same day, 14 June 2024, same hidden folder.',
     ARRAY['meera'], '{"image_url":"http://localhost:3000/files/photos/hidden/IMG-20240614-WA0009.jpg","caption":"Same folder, same day."}'),
    ('LAP-PHOTO-03', 'desktop-shell', 'photo', '2024-07-02 00:00:00+05:30',
     'A photo saved to the hidden folder, 2 July 2024.',
     ARRAY['meera'], '{"image_url":"http://localhost:3000/files/photos/hidden/IMG-20240702-WA0003.jpg","caption":"Hidden folder, 2 July."}'),
    ('LAP-PHOTO-04', 'desktop-shell', 'photo', '2024-07-02 00:05:00+05:30',
     'A second photo from 2 July 2024, same hidden folder.',
     ARRAY['meera'], '{"image_url":"http://localhost:3000/files/photos/hidden/IMG-20240702-WA0004.jpg","caption":"Same folder, same day."}'),
    ('LAP-PHOTO-05', 'desktop-shell', 'photo', '2024-07-19 00:00:00+05:30',
     'A photo saved to the hidden folder, 19 July 2024.',
     ARRAY['meera'], '{"image_url":"http://localhost:3000/files/photos/hidden/IMG-20240719-WA0011.jpg","caption":"Hidden folder, 19 July."}'),
    ('LAP-PHOTO-06', 'desktop-shell', 'photo', '2024-07-19 00:05:00+05:30',
     'A second photo from 19 July 2024, same hidden folder.',
     ARRAY['meera'], '{"image_url":"http://localhost:3000/files/photos/hidden/IMG-20240719-WA0012.jpg","caption":"Same folder, same day."}'),
    ('LAP-PHOTO-07', 'desktop-shell', 'photo', '2024-08-11 00:00:00+05:30',
     'A photo saved to the hidden folder, 11 August 2024 -- the same week as the emails about N.',
     ARRAY['meera'], '{"image_url":"http://localhost:3000/files/photos/hidden/IMG-20240811-WA0002.jpg","caption":"Hidden folder, 11 August."}'),
    ('LAP-PHOTO-08', 'desktop-shell', 'photo', '2024-08-11 00:05:00+05:30',
     'A photo from the same day, 11 August 2024 -- this one deleted rather than hidden.',
     ARRAY['meera'], '{"image_url":"http://localhost:3000/files/photos/bin/IMG-20240811-WA0005.jpg","caption":"Recovered from the Recycle Bin, not the hidden folder -- 11 August."}'),
    ('LAP-PHOTO-09', 'desktop-shell', 'photo', '2024-08-24 00:00:00+05:30',
     'A photo deleted rather than hidden, 24 August 2024.',
     ARRAY['meera'], '{"image_url":"http://localhost:3000/files/photos/bin/IMG-20240824-WA0001.jpg","caption":"Recovered from the Recycle Bin, 24 August."}'),
    ('LAP-PHOTO-10', 'desktop-shell', 'photo', '2024-08-24 00:05:00+05:30',
     'A second deleted photo from the same day, 24 August 2024 -- the day before HAV-027, "Watched".',
     ARRAY['meera'], '{"image_url":"http://localhost:3000/files/photos/bin/IMG-20240824-WA0006.jpg","caption":"Recovered from the Recycle Bin, same day."}');

-- Meera's PulseFit band. There is no smartwatch container: the band synced
-- to the paired laptop, and the laptop's PulseFit app is the only UI, so
-- like CASE- and LAP- these rows are seeded here. SW-01..SW-05 are the five
-- SOS alerts the band sent through the night (held on the laptop under
-- evidence seal until the 'the_confession' checkpoint opens the
-- sos_released gate; PulseFit reports them when it is on screen). SW-06 is
-- the voice memo on the band itself, recovered with her folded jacket by
-- the drone sweep of the cave on Kettle Hill -- city-map's 'trace' response
-- names it in evidence_ids and the map reports it, so it must already be
-- here to resolve. Timestamps go through t() like every other service's.
-- This block MUST stay above the '-- laptop-files' marker below: the
-- generated block is replaced by regex from that marker to the next ';'.
INSERT INTO evidence_cache (evidence_id, service, type, timestamp, summary, involves, content) VALUES
    ('SW-01', 'smartwatch', 'sos_alert', t('2024-09-02 22:41:00+05:30'),
     'PulseFit band SOS 1 of 5, 22:41: long-press SOS from Meera''s band near St Aldric''s Church, Old Town. Delivered to the paired laptop.',
     ARRAY['meera'],
     '{"seq":1,"of":5,"time_label":"22:41","next_day":false,"place":"St Aldric''s Church","district":"Old Town","landmark_slug":"st-aldrics","lat":12.981491,"lng":77.510465,"accuracy_m":25,"hr":121,"battery":58,"device":"PulseFit Band 3","delivered_to":"paired laptop"}'),
    ('SW-02', 'smartwatch', 'sos_alert', t('2024-09-02 23:27:00+05:30'),
     'PulseFit band SOS 2 of 5, 23:27: from the Auditorium service yard, Tech Quarter, next to the university. Heart rate 141 after a forty-second run.',
     ARRAY['meera'],
     '{"seq":2,"of":5,"time_label":"23:27","next_day":false,"place":"Auditorium","district":"Tech Quarter","landmark_slug":"auditorium","lat":13.016808,"lng":77.517941,"accuracy_m":40,"hr":141,"battery":54,"prior":"23:25 running 40 s, HR 146","device":"PulseFit Band 3","delivered_to":"paired laptop"}'),
    ('SW-03', 'smartwatch', 'sos_alert', t('2024-09-03 00:19:00+05:30'),
     'PulseFit band SOS 3 of 5, 00:19: from the Veterinary Hospital, Garden Quarter, on the Inner Ring. The last alert with a normal heart rate.',
     ARRAY['meera'],
     '{"seq":3,"of":5,"time_label":"00:19","next_day":true,"place":"Veterinary Hospital","district":"Garden Quarter","landmark_slug":"vet-hospital","lat":13.012707,"lng":77.486484,"accuracy_m":30,"hr":126,"battery":49,"device":"PulseFit Band 3","delivered_to":"paired laptop"}'),
    ('SW-04', 'smartwatch', 'sos_alert', t('2024-09-03 01:12:00+05:30'),
     'PulseFit band SOS 4 of 5, 01:12: from Eco-Park, Westhollow, under the trees by the pond. Heart rate 64 -- sedated, not resting.',
     ARRAY['meera'],
     '{"seq":4,"of":5,"time_label":"01:12","next_day":true,"place":"Eco-Park","district":"Westhollow","landmark_slug":"eco-park","lat":13.013302,"lng":77.463708,"accuracy_m":80,"hr":64,"battery":45,"prior":"00:36 in vehicle, HR 88 falling","device":"PulseFit Band 3","delivered_to":"paired laptop"}'),
    -- The fifth fix is 254 m from the cave, on purpose: pasting it into the
    -- map still misses, and the participant has to read the model.
    ('SW-05', 'smartwatch', 'sos_alert', t('2024-09-03 02:14:00+05:30'),
     'PulseFit band SOS 5 of 5, 02:14: a degraded fix (±300 m) on the north face of Kettle Hill. A two-minute voice memo was recorded at 02:15 and never uploaded; the band stopped reporting at 02:16.',
     ARRAY['meera'],
     '{"seq":5,"of":5,"time_label":"02:14","lost_label":"02:16","memo_label":"02:15","memo_seconds":127,"next_day":true,"place":"Kettle Hill, north face","district":"Kettle Hill hamlet","landmark_slug":"kettle-cave","lat":12.952185,"lng":77.503411,"accuracy_m":300,"hr":58,"battery":41,"last":true,"device":"PulseFit Band 3","delivered_to":"paired laptop"}'),
    -- The recording is served by city-map, not the laptop: the band is
    -- recovered on the map and the map is where MERCY plays it first, so
    -- the file lives in city-map's public/audio/SW-06-band-memo.{m4a,mp3,wav}
    -- behind GET /audio/SW-06-band-memo (the route picks whichever exists; a
    -- synthesised placeholder ships until the real take is dropped in). The
    -- URL is absolute here on purpose -- absolutizeUrls rewrites only image /
    -- video / poster urls and PUBLIC_BASE has no SW entry -- and the console
    -- card puts a player above the transcript when it is set. A live
    -- database gets the key from scripts/migrate_live_sw06_audio.sql.
    ('SW-06', 'smartwatch', 'voice_recording', t('2024-09-03 02:15:00+05:30'),
     'Voice memo on Meera''s band, 02:15, recovered with her folded jacket from the cave on Kettle Hill: it was not Rahul who took her. It was Nikhil. Nikhil Rao -- Rahul''s alibi in 2018, and the sender of the emails.',
     ARRAY['meera', 'nikhil', 'rahul'],
     '{"found_at":"kettle-cave","found_by":"drone search","items":["Meera''s grey zip jacket, folded, flat keys in the pocket","PulseFit Band 3, strap cut, 3% battery"],"time_label":"02:15","duration_seconds":127,"audio_url":"http://localhost:4011/audio/SW-06-band-memo","transcript":"[whisper] It''s Meera. Meera Sharma. I don''t know what time it is -- two, maybe. If anyone gets this -- Arjun, if you get this -- it wasn''t Rahul. Rahul came to the door to tell me. About Dad. About who lied for him that morning. And I ran from him. I ran to Nikhil''s car. [breath] It''s Nikhil. Nikhil Rao. He was Rahul''s alibi in 2018. The emails were him. The church, the auditorium, the vet''s, the park -- I kept pressing the band. He gave me something at the vet''s. I can''t stay awake. [gravel] We''re in the cave from the photos. He''s turning the car round. He said he''s moving me somewhere nobody will look. I''m leaving the band. I''m leaving my jacket so you know it was me. It''s Nikhil. Not Rahul. Nikh-- [recording ends 0:41]","caption":"Recovered from the cave floor, north face of Kettle Hill, six metres inside the mouth, beside her jacket."}')
ON CONFLICT (evidence_id) DO UPDATE SET summary = EXCLUDED.summary, content = EXCLUDED.content, timestamp = EXCLUDED.timestamp;

-- laptop-files (generated by scripts/seed_laptop_files.py)
INSERT INTO evidence_cache (evidence_id, service, type, timestamp, summary, involves, content) VALUES
    ('LAP-PHOTO-11', 'desktop-shell', 'photo', '2018-10-07 07:30:00+05:30',
     'Breakfast with Dad at the Malleshwaram house, 7 October 2018 -- a week before he died. Dosas, the newspaper, his tea.',
     ARRAY['meera', 'ravi_sharma'], '{"caption": "Dad at breakfast, Malleshwaram, 7 October 2018. The last photo of him on this laptop.", "image_url": "http://localhost:3000/files/photos/camera/IMG_20181007_073012.jpg"}'),
    ('LAP-PHOTO-12', 'desktop-shell', 'photo', '2024-03-16 19:04:00+05:30',
     'College final-year project night, re-saved 16 March 2024: Nikhil, Rahul, Meera and Priya around one laptop.',
     ARRAY['meera', 'rahul', 'nikhil', 'priya'], '{"caption": "Final-year project night, college. Nikhil, Rahul standing, Meera, Priya.", "image_url": "http://localhost:3000/files/photos/camera/IMG_20240316_190455.jpg"}'),
    ('LAP-PHOTO-13', 'desktop-shell', 'photo', '2024-05-05 10:12:00+05:30',
     'Meera and Bruno in the garden, 5 May 2024.',
     ARRAY['meera'], '{"caption": "Meera and Bruno in the garden, 5 May 2024.", "image_url": "http://localhost:3000/files/photos/camera/IMG_20240505_101233.jpg"}'),
    ('LAP-PHOTO-14', 'desktop-shell', 'photo', '2024-05-05 10:14:00+05:30',
     'Bruno''s fourth birthday, 5 May 2024 -- balloons, a chicken cake, the banner.',
     ARRAY['meera'], '{"caption": "Bruno''s fourth birthday, 5 May 2024. The chicken cake did not survive the afternoon.", "image_url": "http://localhost:3000/files/photos/camera/IMG_20240505_101410.jpg"}'),
    ('LAP-PHOTO-15', 'desktop-shell', 'photo', '2024-06-22 12:33:00+05:30',
     'Sunday brunch at the cafe, 22 June 2024. Alone at the table; avocado toast and a flat white.',
     ARRAY['meera'], '{"caption": "Sunday brunch, 22 June 2024. Alone at the table.", "image_url": "http://localhost:3000/files/photos/camera/IMG_20240622_123301.jpg"}'),
    ('LAP-PHOTO-16', 'desktop-shell', 'photo', '2024-08-17 20:33:00+05:30',
     'Dinner with Arjun, 17 August 2024 -- Dad''s birthday. Candles; the chalkboard reads ''same people, brighter nights''.',
     ARRAY['meera', 'arjun'], '{"caption": "Dinner with Arjun on Dad''s birthday, 17 August 2024.", "image_url": "http://localhost:3000/files/photos/camera/IMG_20240817_203344.jpg"}'),
    ('LAP-PHOTO-17', 'desktop-shell', 'photo', '2021-02-14 09:12:00+05:30',
     'Their wedding, 14 February 2021: Meera and Arjun seated at the ceremony, her head on his shoulder, the lamps lit in front of them.',
     ARRAY['meera', 'arjun'], '{"caption": "The ceremony, 14 February 2021.", "image_url": "http://localhost:3000/files/photos/wedding/IMG_20210214_091204.jpg"}'),
    ('LAP-PHOTO-18', 'desktop-shell', 'photo', '2021-02-14 09:48:00+05:30',
     'Their wedding, 14 February 2021: Arjun tying the thaali, her head bowed, elders behind them.',
     ARRAY['meera', 'arjun'], '{"caption": "The thaali, 14 February 2021.", "image_url": "http://localhost:3000/files/photos/wedding/IMG_20210214_094811.jpg"}'),
    ('LAP-PHOTO-19', 'desktop-shell', 'photo', '2021-02-14 10:05:00+05:30',
     'Their wedding, 14 February 2021: the two of them walking away from the mandap, seen from behind, her plait to her waist.',
     ARRAY['meera', 'arjun'], '{"caption": "Walking away from the mandap, 14 February 2021.", "image_url": "http://localhost:3000/files/photos/wedding/IMG_20210214_100539.jpg"}'),
    ('LAP-PHOTO-20', 'desktop-shell', 'photo', '2021-02-14 10:32:00+05:30',
     'Their wedding, 14 February 2021: Meera laughing behind her hand at something Arjun has said.',
     ARRAY['meera', 'arjun'], '{"caption": "Laughing at something he said, 14 February 2021.", "image_url": "http://localhost:3000/files/photos/wedding/IMG_20210214_103217.jpg"}'),
    ('LAP-PHOTO-21', 'desktop-shell', 'photo', '2021-02-14 10:47:00+05:30',
     'Their wedding, 14 February 2021: garlanded, rice being thrown over them by the guests.',
     ARRAY['meera', 'arjun'], '{"caption": "Garlanded, 14 February 2021.", "image_url": "http://localhost:3000/files/photos/wedding/IMG_20210214_104755.jpg"}'),
    ('LAP-PHOTO-22', 'desktop-shell', 'photo', '2021-02-14 11:20:00+05:30',
     'Their wedding, 14 February 2021: signing the register together -- the same register entry the certificate in Documents is taken from.',
     ARRAY['meera', 'arjun'], '{"caption": "Signing the register, 14 February 2021.", "image_url": "http://localhost:3000/files/photos/wedding/IMG_20210214_112033.jpg"}'),
    ('LAP-PHOTO-23', 'desktop-shell', 'photo', '2022-12-24 15:45:00+05:30',
     'On a train with Arjun, 24 December 2022, bags at their feet -- the start of a Christmas trip.',
     ARRAY['meera', 'arjun'], '{"caption": "On the train, 24 December 2022.", "image_url": "http://localhost:3000/files/photos/camera/IMG_20221224_154512.jpg"}'),
    ('LAP-PHOTO-24', 'desktop-shell', 'photo', '2022-12-24 16:18:00+05:30',
     'The same train journey, 24 December 2022: Meera at the window, Arjun looking at her.',
     ARRAY['meera', 'arjun'], '{"caption": "At the window, 24 December 2022.", "image_url": "http://localhost:3000/files/photos/camera/IMG_20221224_161830.jpg"}'),
    ('LAP-PHOTO-25', 'desktop-shell', 'photo', '2022-12-25 08:34:00+05:30',
     'A viewpoint over the hills and the lake, 25 December 2022: the two of them at the railing, his backpack on.',
     ARRAY['meera', 'arjun'], '{"caption": "The viewpoint, 25 December 2022.", "image_url": "http://localhost:3000/files/photos/camera/IMG_20221225_083447.jpg"}'),
    ('LAP-PHOTO-26', 'desktop-shell', 'photo', '2023-11-12 18:30:00+05:30',
     'Diwali at the flat, 12 November 2023: Arjun on a stool hanging the marigold garlands, Meera passing them up.',
     ARRAY['meera', 'arjun'], '{"caption": "Diwali at the flat, 12 November 2023.", "image_url": "http://localhost:3000/files/photos/camera/IMG_20231112_183002.jpg"}'),
    ('LAP-PHOTO-27', 'desktop-shell', 'photo', '2024-02-04 13:39:00+05:30',
     'Cooking together in their kitchen, 4 February 2024; he is stealing a taste out of the pan.',
     ARRAY['meera', 'arjun'], '{"caption": "Sunday lunch, 4 February 2024.", "image_url": "http://localhost:3000/files/photos/camera/IMG_20240204_133928.jpg"}'),
    ('LAP-PHOTO-28', 'desktop-shell', 'photo', '2024-03-12 21:07:00+05:30',
     'Meera''s twenty-sixth birthday at home, 12 March 2024: the banner, the candles, the cake with her name on it, Arjun beside her.',
     ARRAY['meera', 'arjun'], '{"caption": "Her birthday, 12 March 2024. Ten days before the diary entry that starts with \"I did something stupid\".", "image_url": "http://localhost:3000/files/photos/camera/IMG_20240312_210715.jpg"}'),
    ('LAP-PHOTO-29', 'desktop-shell', 'photo', '2024-05-19 22:21:00+05:30',
     'A Sunday night on the sofa, 19 May 2024: Arjun asleep under the blanket with the television on, Meera laughing at him.',
     ARRAY['meera', 'arjun'], '{"caption": "Sunday night, 19 May 2024.", "image_url": "http://localhost:3000/files/photos/camera/IMG_20240519_222104.jpg"}'),
    ('LAP-PHOTO-30', 'desktop-shell', 'photo', '2024-06-08 11:26:00+05:30',
     'A selfie of the two of them at home, 8 June 2024 -- two weeks before the first mail from N.',
     ARRAY['meera', 'arjun'], '{"caption": "At home, 8 June 2024.", "image_url": "http://localhost:3000/files/photos/camera/IMG_20240608_112640.jpg"}'),
    ('LAP-PHOTO-31', 'desktop-shell', 'photo', '2026-09-14 22:14:00+05:30',
     'Screenshot of a Vayo ride receipt: Srinivasa Residency, Koramangala to Phoenix Marketcity, 21:12 to 21:47, Rs 486 paid by UPI, booking VY02609141237.',
     ARRAY['meera'], '{"caption": "Vayo ride receipt, Koramangala to Phoenix Marketcity.", "image_url": "http://localhost:3000/files/photos/screenshots/Screenshot_20260914_221408.png"}'),
    ('LAP-PHOTO-32', 'desktop-shell', 'photo', '2026-09-15 16:41:00+05:30',
     'Screenshot of a Shopara order, delivered: a brown leather laptop bag, Rs 3,299, marked as a gift for Arjun -- "For all your big plans and bigger dreams".',
     ARRAY['meera', 'arjun'], '{"caption": "A gift ordered for Arjun, delivered 15 September.", "image_url": "http://localhost:3000/files/photos/screenshots/Screenshot_20260915_164102.png"}'),
    ('LAP-PHOTO-33', 'desktop-shell', 'photo', '2026-09-21 21:14:00+05:30',
     'Screenshot of a UPI payment: Rs 2,450 to The Spice Room, Bengaluru, 20:42, note "Dinner with Arjun".',
     ARRAY['meera', 'arjun'], '{"caption": "Dinner with Arjun, paid at 20:42 the evening before last.", "image_url": "http://localhost:3000/files/photos/screenshots/Screenshot_20260921_211432.png"}'),
    ('LAP-PHOTO-34', 'desktop-shell', 'photo', '2026-09-22 10:28:00+05:30',
     'Screenshot of a hotel booking: The Lakeside Retreat, Ooty, two adults, Arjun Kapoor and Meera Kapoor, Rs 12,480, reference HTL7264913.',
     ARRAY['meera', 'arjun'], '{"caption": "A booking for the two of them at Ooty.", "image_url": "http://localhost:3000/files/photos/screenshots/Screenshot_20260922_102843.png"}'),
    ('LAP-PHOTO-35', 'desktop-shell', 'photo', '2026-09-22 18:27:00+05:30',
     'Screenshot of a restaurant reservation: The Olive & Oak, Lavelle Road, Saturday 19:30, two guests, Meera Kapoor and Arjun Kapoor, window seat requested.',
     ARRAY['meera', 'arjun'], '{"caption": "A table booked for Saturday -- made hours before she disappeared.", "image_url": "http://localhost:3000/files/photos/screenshots/Screenshot_20260922_182715.png"}'),
    ('LAP-DOC-01', 'desktop-shell', 'document', '2024-08-28 09:00:00+05:30',
     'todo.txt on the desktop: water bill, call Priya re Sunday, Bruno vet Saturday, return the dish, ask Arjun about Coorg dates, cancel the gym before the 30th.',
     ARRAY['meera'], '{"caption": "todo.txt, on the desktop.", "body": "- water bill (due 5th)\n- call Priya re: Sunday\n- Bruno vet, 11am Sat\n- return Priya''s dish\n- ask Arjun about Coorg dates\n- CANCEL gym before 30th!!"}'),
    ('LAP-DOC-02', 'desktop-shell', 'document', '2024-08-20 21:00:00+05:30',
     'notes.txt in Documents: recipes to try (bisi bele bath, Dad''s proportions from the diary), books, and a birthday gift idea for Arjun.',
     ARRAY['meera'], '{"caption": "notes.txt, in Documents.", "body": "recipes to try\n- bisi bele bath (Dad''s proportions, from the diary!)\n- that lemon cake Priya made\n- Coorg pandi curry -- ask the homestay aunty\n\nbooks\n- the Shashi Deshpande one Priya keeps mentioning\n- re-read Malgudi Days (Dad''s copy is in the box)\n\ngifts\n- Arjun bday: the watch strap, NOT another book"}'),
    ('LAP-DOC-03', 'desktop-shell', 'document', '2019-03-19 00:00:00+05:30',
     'LIC Jeevan Anand policy schedule, commenced 19 March 2019: life assured Meera Sharma, born 12 March 1998, sum assured Rs 10 lakh, nominee Lakshmi Sharma (mother).',
     ARRAY['meera'], '{"caption": "LIC policy schedule, 2019. Nominee: her mother.", "url": "http://localhost:3000/files/docs/LIC_policy_2019.pdf"}'),
    ('LAP-DOC-04', 'desktop-shell', 'document', '2024-07-08 18:30:00+05:30',
     'Q2 review talking points from work: accounts, renewals, the onboarding flow.',
     ARRAY['meera'], '{"caption": "Q2_review_notes.txt, in Documents/Office.", "body": "Q2 review -- talking points\n- GreenLeaf account: renewal moved to Aug\n- Kartly onboarding delayed (their side)\n- ask about WFH Fridays\n- appraisal: mention the Stillwell pitch"}'),
    ('LAP-DOC-05', 'desktop-shell', 'document', '2024-08-31 00:00:00+05:30',
     'PulseFit export for August 2024: daily steps, resting heart rate and sleep hours from Meera''s band.',
     ARRAY['meera'], '{"caption": "PulseFit-export-Aug.csv, in Downloads.", "body": "date,steps,resting_hr,sleep_hrs\n2024-08-01,8120,61,6.9\n2024-08-02,6540,62,7.4\n2024-08-03,11230,60,6.1\n2024-08-04,4020,63,5.2\n2024-08-05,7710,61,6.8"}'),
    ('LAP-DOC-06', 'desktop-shell', 'document', '2024-08-12 00:00:00+05:30',
     'Wanderly booking confirmation WDL-8H3K2Q: Misty Ridge Homestay, Madikeri, Coorg, 30 August to 1 September 2024, 2 adults, pet-friendly. Free cancellation until 23 August.',
     ARRAY['meera', 'arjun'], '{"caption": "Coorg homestay booking for 30 Aug - 1 Sep 2024, in Downloads.", "url": "http://localhost:3000/files/docs/Coorg%20homestay%20-%20Wanderly.pdf"}'),
    ('LAP-DOC-07', 'desktop-shell', 'document', '2024-08-14 11:20:00+05:30',
     'Meera''s CV, updated August 2024: lead product designer at Anaia Design Studio since January 2022, previously product designer there from 2019; B.Des 2014-2018.',
     ARRAY['meera'], '{"caption": "Resume_Meera.pdf, in Documents. Updated three weeks before she disappeared.", "url": "http://localhost:3000/files/docs/Resume_Meera.pdf"}'),
    ('LAP-DOC-08', 'desktop-shell', 'document', '2023-04-11 00:00:00+05:30',
     'Scanned Aadhaar card: Meera Kapoor, born 12/03/1998, W/o Arjun Kapoor, Flat 402, Brigade Sanctuary, HSR Layout Sector 2, Bengaluru 560102.',
     ARRAY['meera', 'arjun'], '{"caption": "Aadhaar_Copy.pdf, in Documents. Her address and date of birth.", "url": "http://localhost:3000/files/docs/Aadhaar_Copy.pdf"}'),
    ('LAP-DOC-09', 'desktop-shell', 'document', '2022-05-18 00:00:00+05:30',
     'Scan of her passport, P8472913, issued Bengaluru 15/05/2022: Meera Kapoor, born 12/03/1998 at Bengaluru; father Ravi Sharma, mother Lakshmi Sharma, spouse Arjun Kapoor.',
     ARRAY['meera', 'arjun', 'ravi_sharma'], '{"caption": "Passport.pdf, in Documents. Pages 2 and 3, scanned.", "url": "http://localhost:3000/files/docs/Passport.pdf"}'),
    ('LAP-DOC-10', 'desktop-shell', 'document', '2024-04-12 00:00:00+05:30',
     'Sanjeevani health policy SHI/BLR/2024/0448271, 12 April 2024 to 11 April 2025: family floater of Rs 5,00,000, proposer Arjun Kapoor, spouse Meera Kapoor, no pre-existing conditions declared.',
     ARRAY['meera', 'arjun'], '{"caption": "Insurance.pdf, in Documents. The health cover, in his name, both of them on it.", "url": "http://localhost:3000/files/docs/Insurance.pdf"}'),
    ('LAP-DOC-11', 'desktop-shell', 'document', '2021-02-22 00:00:00+05:30',
     'Certificate of marriage JYN/MR/2021/00418: Arjun Kapoor and Meera Sharma, married 14 February 2021 at Jayanagar, registered 22 February 2021; witnesses Rahul Nair and Priya Menon.',
     ARRAY['meera', 'arjun', 'rahul', 'priya'], '{"caption": "Marriage_Certificate.pdf, in Documents. Rahul Nair signed as a witness.", "url": "http://localhost:3000/files/docs/Marriage_Certificate.pdf"}'),
    ('LAP-DOC-12', 'desktop-shell', 'document', '2024-06-30 19:40:00+05:30',
     'Her contacts list: Arjun, her mother, Priya, Rahul, Nikhil Rao (noted as Northwind, work), her manager, the vet, the society office, the insurers and the policy numbers.',
     ARRAY['meera', 'arjun', 'rahul', 'nikhil', 'priya'], '{"caption": "Important_Contacts.docx, in Documents.", "body": "Important contacts\n\nArjun (husband)                 +91 98450 77890\nAmma -- Lakshmi Sharma          +91 98451 60214\nPriya Menon                     +91 98450 33456\nRahul Nair                      +91 98450 55678\nNikhil Rao (Northwind, work)    +91 98450 99012\nDivya Reddy (manager)           +91 99001 22845\nAnaia Studio -- reception       080 4128 6600\nDr. Anitha, City Paws (Bruno)   +91 98860 71140\nDr. S. Rangan -- family doctor  +91 98455 30902\nSociety office / security       080 2572 4411\nRamesh -- plumber               +91 99640 21187\nSanjeevani Health -- claims     1800 200 4141\nBank -- Prime Bank card block   1800 209 4747\nOla / Uber lost & found         080 6789 0000\n\nPolicy numbers: LIC 733 44 21 906 / Sanjeevani SHI/BLR/2024/0448271\nPassport P8472913 (mine), expires 14/05/2032. Aadhaar ends 9017.\nWifi: the sticker under the router. Gas booking: 1800 2333 555, consumer no. 4410 8832."}')
ON CONFLICT (evidence_id) DO UPDATE SET summary = EXCLUDED.summary, content = EXCLUDED.content, timestamp = EXCLUDED.timestamp;
