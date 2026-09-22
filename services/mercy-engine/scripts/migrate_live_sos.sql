-- Live migration for a RUNNING mercy-engine database: the SOS trail feature
-- (checkpoints.unlocks / reaction, the six-beat checkpoint script, the
-- band's SW-01..SW-06 rows). init.sql only runs on a fresh volume, so a game
-- that is already up needs this piped in instead:
--
--     docker compose exec -T mercy-engine-db psql -U mercy -d mercy_engine -v ON_ERROR_STOP=1 < services/mercy-engine/db/migrate_live_sos.sql
--
-- Idempotent and safe to re-run. It never touches discovered_evidence,
-- accepted_evidence, transcript or case_state, and it carries a checkpoint's
-- hit / hit_at across the row replacement, so re-running it mid-game does
-- not reset progress. The SW timestamps are computed by t() at the moment
-- this runs ("yesterday 21:40 IST" + offset), the same rule every other
-- service used at its own seed time -- so they line up with the rest of the
-- story only if the stack was seeded today; `docker compose down -v` is the
-- clean alternative.

SET client_encoding = 'UTF8';

-- 1. t(): the shared time anchor (verbatim from services/haven/db/init.sql).
CREATE OR REPLACE FUNCTION t(orig TIMESTAMPTZ) RETURNS TIMESTAMPTZ AS $$
  -- Pinned to 21:40 IST *yesterday* whatever the clock says at seed time, so
  -- "that night" is a night in every app and every derived time stays true.
  SELECT ((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') - interval '1 day' + interval '21 hours 40 minutes') AT TIME ZONE 'Asia/Kolkata')
         + (orig - TIMESTAMPTZ '2024-09-02 21:40:00+05:30');
$$ LANGUAGE SQL STABLE;

-- 2. checkpoints: the two new columns.
ALTER TABLE checkpoints ADD COLUMN IF NOT EXISTS unlocks TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE checkpoints ADD COLUMN IF NOT EXISTS reaction TEXT;

-- 3. checkpoints: replace the five-beat script with the six-beat one. A
--    checkpoint that was already hit keeps hit / hit_at if its code survives
--    (the live game has hit = false on all of them, so normally a no-op).
BEGIN;

CREATE TEMP TABLE _cp_hit ON COMMIT DROP AS
    SELECT code, hit, hit_at FROM checkpoints WHERE hit = true;

DELETE FROM checkpoints;

INSERT INTO checkpoints (code, sort_order, label, required_ids, guilt_after, unlocks, reaction) VALUES
    ('gate_timeline', 1, 'The gate timeline',
     ARRAY['CASE-GATE', 'HAV-021'], 91.0, '{}',
     'The register and her timeline agree. Two men on the rock, and a scooter that left fast. I am listening.'),
    ('the_object', 2, 'The carabiner',
     ARRAY['CASE-EFFECTS', 'SOC-025'], 78.0, '{}',
     'A carabiner that was not his, tagged to a club he never joined, in a photo the file never looked at. Go on.'),
    ('the_motive', 3, 'The motive',
     ARRAY['HAV-029'], 42.0, '{}',
     '"Stay away from her." A father, a warning, a fall. That is a motive, and it is not yours.'),
    ('the_confession', 4, 'Named',
     ARRAY['HAV-031'], 22.0, ARRAY['sos_released'],
     'Rahul Nair. The clip, the 5:48 call, the register: six years old, and they hold. But a name is not a place, and her band did not stop at the door. Five alerts, held under evidence seal until you had earned them. They are on the laptop now. Sweep them in order; the drones will not enter the last one blind.'),
    ('the_cave', 5, 'Not Rahul',
     ARRAY['SW-06'], 8.0, '{}',
     'Her voice. Not Rahul''s car and not Rahul''s cave: Nikhil Rao -- the alibi that kept a killer free for six years, the sender of the emails, the jacket folded where you were meant to find it. Rahul came to her door to confess and watched her run into the wrong car. I have Nikhil''s plate. The map is following it now. He has stopped six times since 02:16. She is at one of them.'),
    ('located', 6, 'Located',
     ARRAY['SW-06', 'MAP-FOUND'], 3.0, '{}',
     'Alive, and where he left her. Units are moving. The file against you is closed.');

UPDATE checkpoints c
   SET hit = h.hit, hit_at = h.hit_at
  FROM _cp_hit h
 WHERE h.code = c.code;

COMMIT;

-- 4. evidence_cache: the band. Same rows as init.sql (keep the two in step).
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
    ('SW-05', 'smartwatch', 'sos_alert', t('2024-09-03 02:14:00+05:30'),
     'PulseFit band SOS 5 of 5, 02:14: a degraded fix (±300 m) on the north face of Kettle Hill. A 41-second voice memo was recorded at 02:15 and never uploaded; the band stopped reporting at 02:16.',
     ARRAY['meera'],
     '{"seq":5,"of":5,"time_label":"02:14","lost_label":"02:16","memo_label":"02:15","memo_seconds":41,"next_day":true,"place":"Kettle Hill, north face","district":"Kettle Hill hamlet","landmark_slug":"kettle-cave","lat":12.952185,"lng":77.503411,"accuracy_m":300,"hr":58,"battery":41,"last":true,"device":"PulseFit Band 3","delivered_to":"paired laptop"}'),
    -- audio_url / image_url deliberately absent until the assets exist
    -- (see the note in init.sql); the console card shows the transcript.
    ('SW-06', 'smartwatch', 'voice_recording', t('2024-09-03 02:15:00+05:30'),
     'Voice memo on Meera''s band, 02:15, recovered with her folded jacket from the cave on Kettle Hill: it was not Rahul who took her. It was Nikhil. Nikhil Rao -- Rahul''s alibi in 2018, and the sender of the emails.',
     ARRAY['meera', 'nikhil', 'rahul'],
     '{"found_at":"kettle-cave","found_by":"drone search","items":["Meera''s grey zip jacket, folded, flat keys in the pocket","PulseFit Band 3, strap cut, 3% battery"],"time_label":"02:15","duration_seconds":41,"transcript":"[whisper] It''s Meera. Meera Sharma. I don''t know what time it is -- two, maybe. If anyone gets this -- Arjun, if you get this -- it wasn''t Rahul. Rahul came to the door to tell me. About Dad. About who lied for him that morning. And I ran from him. I ran to Nikhil''s car. [breath] It''s Nikhil. Nikhil Rao. He was Rahul''s alibi in 2018. The emails were him. The church, the auditorium, the vet''s, the park -- I kept pressing the band. He gave me something at the vet''s. I can''t stay awake. [gravel] We''re in the cave from the photos. He''s turning the car round. He said he''s moving me somewhere nobody will look. I''m leaving the band. I''m leaving my jacket so you know it was me. It''s Nikhil. Not Rahul. Nikh-- [recording ends 0:41]","caption":"Recovered from the cave floor, north face of Kettle Hill, six metres inside the mouth, beside her jacket."}')
ON CONFLICT (evidence_id) DO UPDATE SET
    service   = EXCLUDED.service,
    type      = EXCLUDED.type,
    timestamp = EXCLUDED.timestamp,
    summary   = EXCLUDED.summary,
    involves  = EXCLUDED.involves,
    content   = EXCLUDED.content;
