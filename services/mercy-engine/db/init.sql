-- mercy-engine's own database.
--
-- This service owns none of the story's evidence -- every other service
-- does that. What it owns is the participant's side of the game: what
-- they've actually found (discovered_evidence), the argument itself
-- (transcript), the running verdict (case_state), and the script of when
-- that verdict is allowed to move (checkpoints). evidence_cache is a local
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

-- Evidence that has actually been used in an argument MERCY judged
-- coherent -- not just attached. Checkpoints fire against this set, not the
-- raw discovered_evidence set, so attaching the right piece with no real
-- argument doesn't move the score.
CREATE TABLE accepted_evidence (
    evidence_id  TEXT PRIMARY KEY,
    accepted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per turn, in order. evidence_ids is what the participant attached
-- to that turn (empty for MERCY's own turns, and for text-only participant
-- turns that argued without evidence).
CREATE TABLE transcript (
    id            SERIAL PRIMARY KEY,
    role          TEXT NOT NULL CHECK (role IN ('participant', 'mercy')),
    body          TEXT NOT NULL,
    evidence_ids  TEXT[] NOT NULL DEFAULT '{}',
    checkpoint_hit TEXT,                         -- code of the checkpoint this turn triggered, if any
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
CREATE TABLE case_state (
    id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    guilt_percent   NUMERIC(4,1) NOT NULL,
    concluded       BOOLEAN NOT NULL DEFAULT false,
    started_at      TIMESTAMPTZ,
    deadline        TIMESTAMPTZ,
    outcome         TEXT CHECK (outcome IN ('solved', 'timeout', 'left')),
    reported_at     TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO case_state (id, guilt_percent) VALUES (1, 96.8);

-- The script. `required_ids` must ALL be in the participant's accumulated
-- accepted-evidence set (not necessarily attached in the same turn) for the
-- checkpoint to fire; checkpoints fire in `sort_order`, so a later one can't
-- fire before an earlier one even if its evidence arrives out of order.
-- Draft numbers -- easy to retune without touching any code.
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
    hit_at        TIMESTAMPTZ
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
