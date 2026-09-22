# city-map (implemented)

MERCY's model of the city. Not one of Meera's apps: this is the AI's own
tool, the map it reasons over when evidence from the other services carries
a location. Everything on it is real WGS84 latitude/longitude (the city is
fictional, so the coordinates are too, centred on `13.0000 N, 77.5000 E`).

The city is **Meridian**: a small radial plan, 13 km across, with the
**City Police Headquarters** tower (280 m, red beacon) at the exact centre of
Central Plaza, with the City Library, the Grand Theatre, a temple, the
university, the stadium, the auditorium, three schools, two churches, the
market hall, the fire station and the veterinary hospital drawn with their
own shapes, plus the Eco-Park in Westhollow with its pond, walking loops,
turning wind turbines, solar field and lookout tower. Four ring roads, eight
avenues, ten districts (Downtown, Tech
Quarter, Old Town, Mill District, Garden Quarter, four suburbs and the civic
core), four lakes, parks and forests, and a ring of mountains on the border:
Northern Wall, Eastern Scarp, Southern Hills, Western Tors, with Sentinel
Peak, Ash Ridge, Kettle Hill and Grey Tor as the named summits.

One way of looking at it: a 3D **blueprint** (Three.js, served from the
npm package so it works offline). Dark blue ground grid, terrain as a
wireframe with 50 m contour rings, every building as cyan wire edges over a
translucent fill, roads as lines, the police tower outlined in white with
its beacon, monospace labels. Buildings are not bare boxes: small
residential ones are houses with a gabled roof, and every facade is drawn
by a shader -- floor slabs, a grid of windows lit at random (curtain-wall
for offices, sparse bays for industry, tall openings for civic buildings),
a door on the street side, hatched roofs. Trees are wire canopies on
thin trunks; lamps, cars, boats, cranes, the fountain and the shelters are
edge-drawn props, all under one "Trees & props" toggle. The streets are
live: 150 cars drive the junction graph, picking a turn at every junction
and keeping to the left, and six buses shuttle route 7 between Central
Station and the terminus, all with head and tail lights. Two camera presets: the city core and the
whole basin with the mountain ring.

The story beat: **the caves**. Three caves sit in the hills at the map's
edge; only one matters. The cave on the north face of Kettle Hill
(`12.951181 N, 77.501304 E`, ~1380 m) is reached by a footpath from the
Southgate terminus, the last stop of bus route 7 from Central Station. The
same coordinates are the geotag on the two childhood photos in
`social-media` (SOC-006, SOC-009). The other two, Quarry cave and Hermit's
cave, are decoys. Each cave is drawn as a survey would: an arched mouth cut
into the slope, the tunnel's ribs receding into the rock as dashed hidden
lines, a dark opening and rubble at the entrance.

- Port `4011`, evidence prefix `MAP-`, own DB container `city-map-db`.
- No player-auth lock: it is MERCY's console, not a locked phone app. It
  does need to know whose game it is, though -- the `mercy_sid` cookie, see
  *One schema per participant* below.
- Schema: `districts`, `roads`, `water`, `parks`, `mountains`, `landmarks`
  (the important places -- the only things that get a label), `buildings`,
  `towers` + `power_lines` (96 pylons, masts, water towers, relays and
  substations; a 132 kV ring main with a spur down to the hamlet),
  `cctv_cameras` (45 cameras with heading, field of view and range; the
  generator guarantees none within 900 m of the flat, and the map draws that
  gap around You), `trees` (~8,800: parks, forests, avenue rows, garden
  scatter, and thickets of conifers and bushes around all three caves,
  with the mouths and the footpath kept clear -- all placed by the generator
  clear of roads and buildings),
  `props` (~5,000: street lamps on every avenue and ring, parked cars along
  the block streets, boats, three cranes in the Mill District, the plaza
  fountain, bus shelters on route 7), `searches`, `app_config`. The model is
  MERCY's tool, not a source of evidence: `/api/evidence` honours the
  contract but is empty.

## The search, and the drones

The model does not tell the player where Meera is. Her band fired **five**
SOS alerts through the night (22:41 St Aldric's Church, 23:27 the
Auditorium, 00:19 the Veterinary Hospital, 01:12 Eco-Park, 02:14 the north
face of Kettle Hill, ±300 m); the laptop's PulseFit app surfaces them once
MERCY has released the trail (the `the_confession` checkpoint). Each place is
a **story spot** (`story_spots`): sweeping it returns a clue text, and the
cave on Kettle Hill's north face stays *sealed* until the four earlier spots
have been swept. Sweeping the cave then returns a **trace** (`found=false`):
her folded jacket, her band, and a 41-second voice memo (`SW-06`) in which
she names Nikhil Rao -- not Rahul. After the drone frames MERCY comes into
action: an overlay on the map extracts the memo from the band and offers it
to the player to play -- the audio from `GET /audio/SW-06-band-memo` (the
first of `public/audio/SW-06-band-memo.{m4a,mp3,wav,ogg}` that exists; a
synthesised stand-in ships with the repo, see `public/audio/README.md`) with
the transcript lines from `/audio/SW-06.json` shown in time with it. The
memo has to be played before tracking opens. The unlock is in two halves:
the server unlocks **vehicle tracking** on the first trace row (`unlocked()`
in `server.js`, no engine call), and the client only once the memo has been
heard (localStorage `mercy-sw06-played`); with both true the **Vehicle
tracking** button beside *Whole basin* stops being a padlock, and its panel
takes a person's name or a plate. The map never names anyone: the
player has heard "Nikhil" on the memo and types it; the panel resolves his
car (`vehicles`, plate KA 05 MN 4471): a solid car on the model, picked up on
Harrow Road, that the camera follows from above. It is a **chase**
(`vehicles.mode`): the car drives to its next stop, pulls up at the kerb and
waits there -- for as long as it takes -- until the drones have searched the
place; only then does the server name the next stop and the car move on.
Nothing is listed before the car has stopped at it: `GET /api/vehicles/:slug`
sends the searched stops and the current one, never the rest (`vehicleState`
in `server.js`, progress read back from `searches.spot_slug`). The other
names on the ANPR log (`db/04_vehicles.sql`: Rahul, Priya, Vikram, Ravi
Sharma, a clerk with a plate one digit off, a cab, a neighbour, and Arjun's
own impounded car) can be followed too; they loop their own stops, every one
of which the drones clear. The five SOS fixes are never listed on the map --
they come only from the band, through the laptop's PulseFit app. A running
game gets the cars with `scripts/migrate_live_vehicles.sql`. One stop, drawn at random into `app_config.truth_stop`
when the volume is seeded (`db/03_story.sql`) and never sent to the browser,
is where she is: a drone search there is the only way to `found=true` and the
engine's `located` checkpoint. `docker compose down -v` redraws it. A running
game is brought up to this schema with `scripts/migrate_live_sos.sql`.

The found search is the end of the chase and of the game. Its frames are
followed by the rescue: MERCY comes into play, and the map plays the rescue
footage from `GET /video/rescue` -- `public/video/rescue.{mp4,webm,mov,ogv}`,
whichever exists, shot to the list in `RESCUE_VIDEO.md`; with no file there
the route answers 404 and a generated canvas sequence stands in, a thermal
approach and the entry drawn in the model's own palette -- and then a
**CASE SOLVED** card. The card is when the map posts
`{ type: 'mercy:case-solved', evidence_id: 'MAP-<search id>', stop }` to
`window.top` (the same way it posts `mercy:evidence-seen` for each search),
and the console answers by calling mercy-engine's `POST /api/rescue
{ evidence_id }`: the meter goes to 0, the case is concluded with MERCY's
closing line, and the console shows its ending screen with the composer
disabled. The map remembers the rescue it has shown in localStorage
`mercy-rescued` (the found search id), so a reload does not replay it.

The player searches by typing a latitude and longitude, or by right-clicking
any building on the model. Four drones lift off the pad on the Police HQ
roof, drop to gap height and thread between the buildings on the straightest
line the city allows: an A* search on a 10 m grid with every footprint and
mast blocked, pulled tight with line-of-sight checks, so the legs run
straight and bend only where something is in the way. The camera rides behind them the whole way. The world runs at
×3 by default -- the drones' flight, the tracked car, the traffic -- and drops
to ×1 while the drones are actually sweeping a building (mission phase
`scan`), then back up to ×3 for the return; the ▶ chip toggles between ×3
and ×1 by hand. At the point they sweep the building four ways at once -- one rings the
base, one rings the roof, one spirals down, one spirals up -- while the
camera orbits, then report. At a cave the split is different: two drones
work the entrance from outside while two fly the tunnel in and out,
drawn through the rock so they stay visible.
`POST /api/search {lat, lng, source, building_id?}` decides the outcome
server-side: a find only within `search_radius_m` (60 m) of the
`truth_landmark` in `app_config`, which is never sent to the browser. Every
search is logged in `searches` and drawn on the model (orange "searched, no
trace" rings; a green "found" ring). The three caves are drawn identically.

Moving around: WASD or the arrow keys move, Q/E turn, R/F zoom, Shift is
faster; left-drag orbits, right-drag slides along the ground, scroll zooms,
double-click jumps to a point.

## One schema per participant

The event build (`/MULTIPLAYER.md`) runs fifty games in this one database.
The mechanics are `tenant.js` (identical in every stateful service); what
is city-map's own is the list of what stays shared and the hook that runs
after a participant's schema is built.

- **Static, read from `template` by everyone**: `districts`, `roads`,
  `water`, `parks`, `mountains`, `landmarks`, `buildings`, `towers`,
  `power_lines`, `cctv_cameras`, `trees`, `props`, `story_spots`,
  `vehicles`, `vehicle_stops` -- the city, the SOS trail, the cars and their
  stops. Nobody writes to them, so there is one copy.
- **Copied into `p_<zinnia id>` at login**: `searches` and `app_config`.
  `searches.id` keeps its default on template's sequence, so MAP-<id>
  stays unique across participants.
- **The redraw**: the copied `app_config` carries template's `truth_stop`,
  which would put every participant's Meera at the same stop.
  `afterProvision` in `server.js` runs on the new schema and redraws it
  from Nikhil's stops (`UPDATE app_config ... ORDER BY random() LIMIT 1`;
  an `INSERT` if the key is missing), so each game has its own answer.
  Restarting a participant (drop + provision) draws again.
- **The bundle names the participant**: `config.player` in
  `GET /api/map/bundle` (null in single-player mode). `app.js` suffixes its
  localStorage/sessionStorage keys with it (`mercy-sw06-played:ZIN26-0158`,
  `mercy-rescued:...`, `track-slug:...`), and `/reset.html` clears this
  origin's storage outright when the lobby loads it at login.
- **Internal endpoints** (all behind `x-internal-key`, driven by the lobby):
  `POST /api/internal/players {id}` (provision, idempotent),
  `DELETE /api/internal/players/:id`, `GET /api/internal/players`,
  `GET /api/internal/players/:id/summary` -- `{ searches, sos_swept, trace,
  stops_searched, found, tracking_unlocked }` for the admin panel --
  `POST /api/internal/template`, `POST /api/internal/reset` (every
  participant schema and the template: the seeds replay on the next
  provision), `GET /api/internal/stats`.
- **`MERCY_SINGLE_PLAYER=1`** is the old behaviour: no cookie needed, every
  query on `public`, the volume's own `truth_stop`. Without it an `/api/*`
  call with no participant (the cookie, or `x-mercy-player` next to a valid
  `x-mercy-key` / `x-internal-key`) answers 401; static files, `/api/health`
  and `/api/internal/*` never need one.

## API

```
GET /api/map/config                  bounds, centre, base elevation
GET /api/map/bundle                  every layer in one call (what the UI loads)
GET /api/map/{districts,roads,water,parks,mountains,landmarks,buildings,towers,power_lines,cctv,trees,props,searches}
GET /api/map/cctv/near?lat=&lng=&radius_m=   is this point watched? nearest camera, cameras in range
POST /api/search {lat,lng,source,building_id?}   send the drones; found only within 60 m of the truth
GET /api/searches                    every search so far
GET /api/map/buildings/:id
GET /api/map/elevation?lat=&lng=
GET /api/map/search?q=
GET /audio/SW-06-band-memo          the band memo: first of public/audio/SW-06-band-memo.{m4a,mp3,wav,ogg}
GET /audio/SW-06.json               its transcript cues {evidence_id,title,recorded_label,duration_s,cues:[{t,text}],placeholder}
GET /video/rescue                    the rescue footage: first of public/video/rescue.{mp4,webm,mov,ogv}; 404 JSON when none
GET /api/evidence, /api/evidence/:id (x-mercy-key; always empty)
GET /api/health
GET /reset.html                      clears this origin's localStorage/sessionStorage, posts mercy:reset-done to its parent
POST /api/internal/players {id}, DELETE /api/internal/players/:id, GET /api/internal/players,
GET /api/internal/players/:id/summary, POST /api/internal/template, POST /api/internal/reset,
GET /api/internal/stats             (x-internal-key; see "One schema per participant")
```
