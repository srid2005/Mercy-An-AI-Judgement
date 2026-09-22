-- city-map -- the SOS trail and Nikhil's car. Hand-written; runs after the
-- generated 02_city.sql on a fresh volume and is NEVER regenerated.
--
-- Everything here is keyed (app_config.key, story_spots.slug, vehicles.slug,
-- vehicle_stops (vehicle, seq)) or guarded with WHERE NOT EXISTS, so the file
-- is safe to pipe into a live database a second time: nothing is duplicated
-- and, above all, truth_stop is drawn once and never redrawn.
--
-- Building ids are resolved by name lookup against 02_city.sql. Do not
-- regenerate 02_city.sql without re-checking every name below (and the
-- residential house at 12.952534, 77.506909 used by stop 4).
--
-- Prose is dollar-quoted ($story$ ... $story$) so apostrophes need no escaping.

-- ---------------------------------------------------------------------------
-- (1) app_config: the cave is a trace, not the truth.
-- 02_city.sql still writes truth_landmark = 'kettle-cave'; delete it here so
-- no code path can find her at the cave. found=true is only possible at
-- app_config.truth_stop (drawn at the bottom of this file).
-- ---------------------------------------------------------------------------
INSERT INTO app_config (key, value) VALUES ('trace_landmark', 'kettle-cave')
ON CONFLICT (key) DO NOTHING;

DELETE FROM app_config WHERE key = 'truth_landmark';

-- ---------------------------------------------------------------------------
-- (2) roads: the Kettle Hill hamlet grid is its own graph component (its
-- lanes start at r 5030 m; Southgate Road ends at the terminus, r 5000 m).
-- One 30 m spur joins the terminus [12.954781,77.5] to the 180-degree point
-- of the 5030 m lane arc [12.95451,77.5], so stop 4 is reachable by road.
-- ---------------------------------------------------------------------------
INSERT INTO roads (name, class, path)
SELECT 'Southgate Road (hamlet spur)', 'street', '[[12.954781,77.5],[12.95451,77.5]]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM roads WHERE name = 'Southgate Road (hamlet spur)');

-- ---------------------------------------------------------------------------
-- (3) story_spots: matched by priority, first circle that contains the
-- search point. The cave (priority 1) answers with kettle-cave-sealed until
-- sos-1..sos-4 have each been swept; kettle-north-face (320 m) sits under
-- everything on the hill and is checked last.
-- ---------------------------------------------------------------------------
INSERT INTO story_spots (slug, priority, lat, lng, radius_m, outcome, result, items, evidence_ids, requires_spots, sealed_slug) VALUES
('kettle-cave', 1, 12.951181, 77.501304, 60, 'trace',
 $story$Cave, Kettle Hill, north face. Two drones inside. No one. On the floor six metres past the light: her grey jacket -- folded, not dropped -- and her PulseFit band, strap cut, 3% battery. The band that sent SOS 5/5 at 02:14. It holds a voice memo, 02:15, two minutes and seven seconds, never uploaded. Playback recovered. Listen to it. Meera is not here, and whoever brought her here wanted this cave found.$story$,
 $story$[{"kind":"jacket","desc":"Meera's grey zip jacket, folded, flat keys in the pocket"},{"kind":"band","desc":"PulseFit Band 3, strap cut, 3% battery","recording":{"evidence_id":"SW-06","duration_s":127}}]$story$::jsonb,
 '{SW-06}', '{sos-1,sos-2,sos-3,sos-4}', 'kettle-cave-sealed'),

('kettle-cave-sealed', 2, 12.951181, 77.501304, 60, 'clear',
 $story$Cave mouth, north face of Kettle Hill. Thermal at the entrance: nothing. The interior is unlit and out of line of sight, and the drones do not enter a structure without cause. The band sent four alerts before this one. Sweep those places first; the trail is the cause.$story$,
 NULL, '{}', '{}', NULL),

('sos-1', 10, 12.981986, 77.510609, 130, 'clue',
 $story$St Aldric's churchyard. Tyre marks in the gravel of the lych-gate lane: one car, in and out. In the storm drain by the gate, a phone -- screen shattered, SIM tray empty. Hers; the case matches her Loop photos. The band's SOS 1/5 was sent from within 60 m of this gate at 22:41. No people. She was alive and in a car when it left, and the driver made sure the phone would not follow it.$story$,
 '["phone, screen shattered, SIM tray empty"]'::jsonb, '{}', '{}', NULL),

('sos-2', 11, 13.016345, 77.517879, 130, 'clue',
 $story$Auditorium service yard, south side. Fresh paint transfer on the entrance bollard, silver-grey: a car left here fast enough to clip it. By the fire door, a woman's sandal, strap torn. CCTV-16, Inner Ring Road at Kestrel Avenue, 23:31: a grey hatchback outbound, plate unreadable, two occupants. SOS 2/5 was sent from this yard at 23:27, heart rate 141 after a forty-second run. She ran here. She did not get far.$story$,
 '["sandal, strap torn","silver paint transfer"]'::jsonb, '{}', '{}', NULL),

('sos-3', 12, 13.01279, 77.486954, 130, 'clue',
 $story$Veterinary Hospital. The side door to the pharmacy store is forced; the frame is split at the latch. The drug register is open on the bench and the cabinet is short one bottle of xylazine, a large-animal sedative. CCTV-28, Inner Ring Road at Garden Avenue, 00:34: the same grey hatchback, westbound, one occupant visible. SOS 3/5 was sent from this door at 00:19. She is lying down after this. The band's heart rate agrees.$story$,
 '["pharmacy door forced","one bottle of xylazine missing"]'::jsonb, '{}', '{}', NULL),

('sos-4', 13, 13.01406, 77.464504, 130, 'clue',
 $story$Eco-Park, the loop road by the pond. Tyre marks on the verge at the gate. In the reeds at the water's edge, her tote bag, open: wallet, keys, a hair clip, pond water in everything. Her father's diary is not in it. Cigarette ends on the top rail of the lookout tower: the driver climbed it and stood there a while, looking at the city. SOS 4/5 was sent from under these trees at 01:12, heart rate 64 -- sedated, not resting. No people.$story$,
 '["tote bag: wallet, keys, hair clip; diary missing","cigarette ends, lookout tower"]'::jsonb, '{}', '{}', NULL),

('kettle-north-face', 20, 12.952185, 77.503411, 320, 'clear',
 $story$Scree and thorn on the north face of Kettle Hill. Searched 60 m around the fix: nothing. The fifth fix is ±300 m: the band was under rock when it sent. There is one cave on this face, and it is on the model.$story$,
 NULL, '{}', '{}', NULL)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- (4) vehicles: Nikhil Rao's grey hatchback, mode 'chase': once followed it
-- drives to its next unsearched stop and waits there until the drones have
-- searched it. lat/lng is where the car is first picked up -- on Harrow Road
-- south of the Exchange, its last ANPR read -- so the first leg to stop 1 is
-- a drive the participant watches. The plate ends in the 4471 of
-- no.reply.4471@protonmail.com. The other cars are in 04_vehicles.sql.
-- ---------------------------------------------------------------------------
INSERT INTO vehicles (slug, owner, plate, model, note, mode, lat, lng) VALUES
('nikhil', 'Nikhil Rao', 'KA 05 MN 4471', 'grey Hyundai i20',
 $story$Read by six ANPR cameras between 02:58 and 05:33 last night and still circulating; the last read was CCTV-36 on Harrow Road, minutes ago. The plate ends in the four digits of the address the threats came from.$story$,
 'chase', 12.9862, 77.5081)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- (5) vehicle_stops: the chase 1 -> 2 -> 3 -> 4 -> 5 -> 6, one stop at a time,
-- the car waiting at each until the drones have searched it. Every stop is
-- a named building in 02_city.sql (stop 4 is the unnamed residential house at
-- exactly 12.952534, 77.506909 on Kettle Hill path 171.5). result_clear is
-- the sweep text at a wrong stop, result_found at the true one; neither
-- ever reaches the browser before a search is made there.
-- ---------------------------------------------------------------------------
INSERT INTO vehicle_stops (vehicle, seq, name, note, lat, lng, building_id, dwell_s, logged_label, cctv_code, result_clear, result_found) VALUES
('nikhil', 1, 'Northwind Campus -- his office, car park under Block B',
 'ANPR read 02:58 at CCTV-33 (Northwind Campus gate)',
 13.018013, 77.515417, (SELECT id FROM buildings WHERE name = 'Northwind Campus'), 40, '02:58', 'CCTV-33',
 $story$Northwind Campus. His keycard: in at 03:02, basement level, out at 03:19. The basement print room is a dead zone for the campus cameras and its door locks from outside. Inside: nothing. A chair against the wall. He checked a place. He did not use it. KA 05 MN 4471 was read at the gate at 02:58 (stop 1/6). No trace of her.$story$,
 $story$Northwind Campus, basement print room. Thermal: one person, alive, on the floor by the far wall. Meera located. Under his own office, behind a door that only locks from outside. KA 05 MN 4471 was read at the gate at 02:58.$story$),

('nikhil', 2, 'Meridian Stadium -- east service gate',
 'ANPR read 03:21 at CCTV-19 (Outer Ring Road at East Avenue)',
 13.018087, 77.531957, (SELECT id FROM buildings WHERE name = 'Meridian Stadium'), 40, '03:21', 'CCTV-19',
 $story$Meridian Stadium, east service gate. The padlock has been cut and hung back on the hasp. Under the east stand: kit stores, a groundsman's office, a first-aid room with the cot stripped. No one. KA 05 MN 4471 passed CCTV-19 at 03:21 (stop 2/6). No trace of her.$story$,
 $story$Meridian Stadium, first-aid room under the east stand. Thermal: one person on the cot, alive. Meera located. A room with a bed and a lock, empty until the season starts. KA 05 MN 4471 passed CCTV-19 at 03:21.$story$),

('nikhil', 3, 'Old Town Market Hall -- loading yard',
 'ANPR read 03:52 at CCTV-35 (Old Town Green)',
 12.990504, 77.516777, (SELECT id FROM buildings WHERE name = 'Old Town Market Hall'), 40, '03:52', 'CCTV-35',
 $story$Old Town Market Hall, loading yard. The cold store at the back has been opened tonight: the seal is broken, the compressor is running. Inside: crates, ice, a torch left on the floor, still on. No one. KA 05 MN 4471 was read on Old Town Green at 03:52 (stop 3/6). No trace of her.$story$,
 $story$Old Town Market Hall, the cold store behind the loading yard. Thermal, faint: one person, alive, cold. Meera located. The compressor is running; units are moving. KA 05 MN 4471 was read on Old Town Green at 03:52.$story$),

('nikhil', 4, 'A rented house at the foot of Kettle Hill (lane 171.5)',
 'ANPR read 04:30 at CCTV-45 (Southgate terminus)',
 12.952534, 77.506909, (SELECT id FROM buildings WHERE lat = 12.952534 AND lng = 77.506909), 40, '04:30', 'CCTV-45',
 $story$A house at the foot of Kettle Hill, on lane 171.5, six hundred metres from the cave. Rented by the week; the letting has been in Nikhil Rao's name since 30 August. Curtains pinned shut, an air mattress, six bottles of water, a roll of tape. Prepared. Not used. No one. KA 05 MN 4471 was read at the Southgate terminus at 04:30 (stop 4/6). No trace of her.$story$,
 $story$A house at the foot of Kettle Hill, lane 171.5. Thermal in the back room: one person on a mattress, alive. Meera located -- six hundred metres from where he left her jacket, in a house he rented the day she wrote that she was close. KA 05 MN 4471 was read at the terminus at 04:30.$story$),

('nikhil', 5, 'Harrow Mills -- Unit 4, disused mill sheds',
 'ANPR read 05:07 at CCTV-37 (Harrow Mills gate)',
 12.990063, 77.478262, (SELECT id FROM buildings WHERE name = 'Harrow Mills'), 40, '05:07', 'CCTV-37',
 $story$Harrow Mills, Unit 4: the Rao family's old lease, dark since the mill closed. CCTV-37 on the gate has a forty-minute gap from 05:05; the circuit was cut at the box. Inside: dust, a chair moved to the middle of the floor, a bottle of water. Someone sat here and thought. No one now (stop 5/6). No trace of her.$story$,
 $story$Harrow Mills, Unit 4. Thermal in the office behind the loading bay: one person on the floor, alive. Meera located. He cut the gate camera at 05:05 and left her in his father's mill.$story$),

('nikhil', 6, 'Westhollow Chapel -- store behind the vestry',
 'ANPR read 05:33 at CCTV-43 (Westhollow high street)',
 12.987009, 77.463591, (SELECT id FROM buildings WHERE name = 'Westhollow Chapel'), 40, '05:33', 'CCTV-43',
 $story$Westhollow Chapel, the store behind the vestry. The vestry key is under the mat and it has been used tonight: dust on the step, one set of prints. Inside: hymn books, a boiler, a folded blanket that is not the chapel's. No one. KA 05 MN 4471 was read on Westhollow high street at 05:33 (stop 6/6). No trace of her.$story$,
 $story$Westhollow Chapel, the store behind the vestry. Thermal: one person, alive, under a blanket by the boiler. Meera located. A chapel that opens twice a week, on the far side of the city from anyone who would look. KA 05 MN 4471 was read on the high street at 05:33.$story$)
ON CONFLICT (vehicle, seq) DO NOTHING;

-- ---------------------------------------------------------------------------
-- (6) The draw. Where Meera is: one of Nikhil's six stops, chosen once per
-- database volume and never redrawn (the NOT EXISTS keeps a re-run of this
-- file from moving her mid-game). Reset with `docker compose down -v`.
-- The value is read only inside POST /api/search via rawConfig() and is
-- never serialised to the browser.
-- ---------------------------------------------------------------------------
INSERT INTO app_config (key, value)
SELECT 'truth_stop', id::text
FROM vehicle_stops
WHERE vehicle = 'nikhil'
  AND NOT EXISTS (SELECT 1 FROM app_config WHERE key = 'truth_stop')
ORDER BY random()
LIMIT 1;
