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
- No player-auth lock: it is MERCY's console, not a locked phone app.
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

The model does not tell the player where Meera is. Her smartwatch fired one
SOS to her laptop (`12.952185 N, 77.503411 E`, ±300 m -- that is the
smartwatch service's beat to surface); the player brings those coordinates
here. The fix lands in **Kettle Hill hamlet**, ninety-odd small buildings and
named structures (pump house, quarry office, ranger post, chapel, hostel,
transmitter hut, water tower, mast) at the foot of the southern hills, 254 m
from the cave. Anything nearby is a candidate.

The player searches by typing a latitude and longitude, or by right-clicking
any building on the model. Four drones lift off the pad on the Police HQ
roof, drop to gap height and thread between the buildings on the straightest
line the city allows: an A* search on a 10 m grid with every footprint and
mast blocked, pulled tight with line-of-sight checks, so the legs run
straight and bend only where something is in the way. The camera rides behind them the whole way (a ×4 button speeds the
trip). At the point they sweep the building four ways at once -- one rings the
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
GET /api/evidence, /api/evidence/:id (x-mercy-key; always empty)
GET /api/health
```
