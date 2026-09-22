-- mercy-engine: replace the checkpoint script with the alibi-first version (7 beats).
-- Safe only while no checkpoint is hit (the live game is at 96.8); otherwise re-seed.
BEGIN;
DELETE FROM checkpoints;
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
COMMIT;
