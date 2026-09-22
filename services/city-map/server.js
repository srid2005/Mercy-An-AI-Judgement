const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { pool, rawPool } = require('./db');
const tenant = require('./tenant');

const PORT = process.env.PORT || 4011;
const MERCY_API_KEY = process.env.MERCY_API_KEY || 'dev-mercy-key';
const M_LAT = 110574, M_LNG = 108400;
// A drone search counts as "at" one of Nikhil's stops within this distance
// of the stop (the car dwells 56-76 m from the building centre, outside the
// 60 m search circle) or when it was launched on the stop's building.
const STOP_MATCH_M = 100;
// how a search at a stop is logged: Nikhil's keep the short form the photo sets use
const stopSlug = (vehicle, seq) => (vehicle === 'nikhil' ? `stop-${seq}` : `stop-${vehicle}-${seq}`);
// A generic search (no story spot, no stop) this close to a cave landmark
// (the decoys: Quarry cave, Hermit's cave) shows cave-mouth frames instead of
// the open-ground ones.
const CAVE_MATCH_M = 120;

const app = express();
app.set('x-service', 'city-map');
// The console and the laptop call this origin from theirs, with the
// participant's cookie: reflect the caller's origin and allow credentials.
app.use(cors({ origin: true, credentials: true }));
// Every route registered below is wrapped so a rejected handler answers 500
// for that one participant instead of taking the process down for all of them.
tenant.guardApp(app);
app.use(express.json());
// Who the request is for: the mercy_sid cookie, or x-mercy-player on a keyed
// service-to-service call. From here down every pool.query runs on that
// participant's schema; /api/* without one is a 401 (MERCY_SINGLE_PLAYER=1
// keeps the old behaviour on public). Static files are served regardless.
app.use(tenant.middleware);
// The band's memo and the rescue footage are whatever the author has dropped
// in, by extension: the first file that exists answers, at a fixed URL the
// map can point an <audio>/<video> at without knowing the format. sendFile
// sets the content type and honours Range requests, so seeking works.
// 404 (JSON) until a file is there -- the map falls back to a placeholder.
function firstMedia(dir, base, exts) {
  for (const ext of exts) {
    const file = path.join(__dirname, 'public', dir, `${base}.${ext}`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}
app.get('/audio/SW-06-band-memo', (req, res) => {
  const file = firstMedia('audio', 'SW-06-band-memo', ['m4a', 'mp3', 'wav', 'ogg']);
  if (!file) return res.status(404).json({ error: 'no recording: place SW-06-band-memo.(m4a|mp3|wav|ogg) under public/audio/' });
  res.sendFile(file);
});
app.get('/video/rescue', (req, res) => {
  const file = firstMedia('video', 'rescue', ['mp4', 'webm', 'mov', 'ogv']);
  if (!file) return res.status(404).json({ error: 'no footage: place rescue.(mp4|webm|mov|ogv) under public/video/' });
  res.sendFile(file);
});
app.use(express.static(path.join(__dirname, 'public')));
// Three.js is served from the installed package so the model works offline.
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three')));

function requireMercyKey(req, res, next) {
  if (req.headers['x-mercy-key'] !== MERCY_API_KEY) {
    return res.status(403).json({ error: 'missing or invalid x-mercy-key header' });
  }
  next();
}

async function rawConfig() {
  const { rows } = await pool.query('SELECT key, value FROM app_config');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ---------------------------------------------------------------------------
// Story state, derived from rows the map already owns -- no engine call.
// ---------------------------------------------------------------------------
// Vehicle tracking unlocks the first time a drone search comes back 'trace'
// (the cave: jacket + band + recording). Once true, true forever.
async function unlocked() {
  const { rows } = await pool.query("SELECT EXISTS (SELECT 1 FROM searches WHERE outcome = 'trace') AS ok");
  return rows[0].ok === true;
}
// Which SOS places (story spots sos-1..sos-4) have been swept so far.
async function trailSwept() {
  const { rows } = await pool.query("SELECT DISTINCT spot_slug FROM searches WHERE spot_slug LIKE 'sos-%' ORDER BY spot_slug");
  return rows.map((r) => r.spot_slug);
}
async function story() {
  const [vehicle_tracking, trail_swept] = await Promise.all([unlocked(), trailSwept()]);
  return { vehicle_tracking, trail_swept };
}

// What the browser is allowed to know. The truth stays server-side.
async function config() {
  const cfg = await rawConfig();
  return {
    city: cfg.city,
    base_elevation_m: Number(cfg.base_elevation_m),
    center: { lat: Number(cfg.center_lat), lng: Number(cfg.center_lng) },
    bounds: {
      south: Number(cfg.bounds_south), north: Number(cfg.bounds_north),
      west: Number(cfg.bounds_west), east: Number(cfg.bounds_east),
    },
    player_building: cfg.player_building,
    search_radius_m: Number(cfg.search_radius_m || 60),
    // whose game this is (null in single-player mode): app.js namespaces the
    // browser's memory of the story by it, so a shared machine starts clean
    player: tenant.currentId(),
    ...(await story()),
  };
}
const dist = (aLat, aLng, bLat, bLng) => Math.hypot((bLng - aLng) * M_LNG, (bLat - aLat) * M_LAT);

// ---------------------------------------------------------------------------
// Drone photos. After every search the map shows a few frames of what the
// drones saw. photos.json (next to this file, NOT under public/) is the one
// source of truth: for each set, every frame's file, kind and caption, plus
// the author's AI prompt or stock description. Only url/kind/caption ever
// reach the browser; the prompts stay on the server. The image files live at
// public/images/drone/<file> and are served by the express.static above.
// Loaded once at startup; a missing or malformed manifest stops the service.
// ---------------------------------------------------------------------------
const PHOTOS_PATH = path.join(__dirname, 'photos.json');
const PHOTOS_DIR = path.join(__dirname, 'public', 'images', 'drone');
const PHOTOS_URL = '/images/drone/';

function loadPhotoSets() {
  let text;
  try {
    text = fs.readFileSync(PHOTOS_PATH, 'utf8');
  } catch (err) {
    throw new Error(`[city-map] cannot read the drone-photo manifest ${PHOTOS_PATH}: ${err.message}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (err) {
    throw new Error(`[city-map] ${PHOTOS_PATH} is not valid JSON: ${err.message}`);
  }
  if (!manifest || typeof manifest.sets !== 'object' || manifest.sets === null || Array.isArray(manifest.sets)) {
    throw new Error(`[city-map] ${PHOTOS_PATH} has no "sets" object`);
  }
  const sets = {};
  const missing = [];
  for (const [key, frames] of Object.entries(manifest.sets)) {
    if (!Array.isArray(frames)) throw new Error(`[city-map] ${PHOTOS_PATH}: set "${key}" is not an array`);
    sets[key] = frames.map((f, i) => {
      for (const field of ['file', 'kind', 'caption']) {
        if (!f || typeof f[field] !== 'string' || !f[field]) throw new Error(`[city-map] ${PHOTOS_PATH}: set "${key}" frame ${i} has no "${field}"`);
      }
      if (!fs.existsSync(path.join(PHOTOS_DIR, f.file))) missing.push(f.file);
      // What the browser gets -- and nothing else (no prompt, stock, source).
      return { url: PHOTOS_URL + f.file.split('/').map(encodeURIComponent).join('/'), kind: f.kind, caption: f.caption };
    });
  }
  const total = Object.values(sets).reduce((n, s) => n + s.length, 0);
  console.log(`[city-map] drone photos: ${Object.keys(sets).length} sets, ${total} frames (${PHOTOS_PATH})`);
  if (missing.length) {
    console.warn(`[city-map] drone photos: ${missing.length} of ${total} files are missing under ${PHOTOS_DIR}; those frames will 404: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}`);
  }
  return sets;
}
const PHOTO_SETS = loadPhotoSets();

// Cave landmarks (kind = 'cave'): the real cave and the two decoys. They are
// seed data, but fetched per request rather than cached so a re-seed is seen.
async function caveLandmarks() {
  const { rows } = await pool.query("SELECT name, lat, lng FROM landmarks WHERE kind = 'cave'");
  return rows;
}

// The frames for one search, in the order the manifest contract fixes:
//   1. the exact story spot (sos-1..sos-4, kettle-north-face,
//      kettle-cave-sealed, kettle-cave);
//   2. a vehicle stop: its place frames (stop-N, shared by both outcomes)
//      followed by its outcome frames (stop-N:clear or stop-N:found);
//   3. otherwise a generic sweep: generic:cave within CAVE_MATCH_M of a cave
//      landmark, generic:building for a building search, generic:coords for
//      a typed point or an SOS fix.
// Takes a searches row (or the POST /api/search fields) and the
// caveLandmarks() rows, which the caller fetches once so a list of searches
// costs one query rather than one per row. Returns [{ url, kind, caption }].
function photosFor({ spot_slug, outcome, source, lat, lng }, caves = []) {
  const frames = [];
  if (spot_slug) {
    frames.push(...(PHOTO_SETS[spot_slug] || []));
    if (/^stop-\d+$/.test(spot_slug)) frames.push(...(PHOTO_SETS[`${spot_slug}:${outcome}`] || []));
  }
  if (!frames.length) {
    const nearCave = Number.isFinite(lat) && Number.isFinite(lng) && caves.some((c) => dist(lat, lng, c.lat, c.lng) <= CAVE_MATCH_M);
    const key = nearCave ? 'generic:cave' : source === 'building' ? 'generic:building' : 'generic:coords';
    frames.push(...(PHOTO_SETS[key] || []));
  }
  return frames.map((f) => ({ ...f }));
}
const withPhotos = (rows, caves) => rows.map((r) => ({ ...r, photos: photosFor(r, caves) }));

const LAYERS = {
  districts: 'SELECT id, slug, name, kind, center_lat, center_lng, polygon FROM districts ORDER BY id',
  roads: 'SELECT id, name, class, path FROM roads ORDER BY id',
  water: 'SELECT id, name, kind, polygon FROM water ORDER BY id',
  parks: 'SELECT id, name, kind, polygon FROM parks ORDER BY id',
  mountains: 'SELECT id, range_name, peak_name, lat, lng, height_m, radius_m FROM mountains ORDER BY id',
  landmarks: 'SELECT id, slug, name, kind, lat, lng, elevation_m, description FROM landmarks ORDER BY id',
  buildings: `SELECT b.id, b.name, b.kind, b.lat, b.lng, b.rotation_deg, b.width_m, b.depth_m, b.height_m, b.floors, d.slug AS district
              FROM buildings b LEFT JOIN districts d ON d.id = b.district_id ORDER BY b.id`,
  towers: 'SELECT id, kind, name, lat, lng, height_m FROM towers ORDER BY id',
  power_lines: 'SELECT id, name, path FROM power_lines ORDER BY id',
  cctv: 'SELECT id, code, name, lat, lng, heading_deg, fov_deg, range_m, status FROM cctv_cameras ORDER BY id',
  trees: 'SELECT kind, lat, lng, height_m FROM trees ORDER BY id',
  props: 'SELECT kind, lat, lng, rotation_deg FROM props ORDER BY id',
  searches: `SELECT s.id, s.lat, s.lng, s.source, s.building_id, b.name AS building_name, s.found, s.outcome, s.spot_slug, s.evidence_ids, s.items, s.result, s.searched_at
             FROM searches s LEFT JOIN buildings b ON b.id = s.building_id ORDER BY s.id`,
};

// ---------------------------------------------------------------------------
// Map data -- everything is lat/lng.
// ---------------------------------------------------------------------------
app.get('/api/map/config', async (req, res) => res.json(await config()));

for (const layer of Object.keys(LAYERS)) {
  app.get(`/api/map/${layer}`, async (req, res) => {
    const { rows } = await pool.query(LAYERS[layer]);
    // The searches layer carries its drone photos wherever it is served.
    res.json({ count: rows.length, [layer]: layer === 'searches' ? withPhotos(rows, await caveLandmarks()) : rows });
  });
}

app.get('/api/map/buildings/:id', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT b.*, d.name AS district_name FROM buildings b LEFT JOIN districts d ON d.id = b.district_id WHERE b.id = $1',
    [Number(req.params.id)]
  );
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

// One round-trip for the client: every layer at once.
app.get('/api/map/bundle', async (req, res) => {
  const names = Object.keys(LAYERS);
  const results = await Promise.all(names.map((n) => pool.query(LAYERS[n])));
  const bundle = { config: await config() };
  names.forEach((n, i) => { bundle[n] = results[i].rows; });
  // Each past search carries its photos; the landmarks layer is already here,
  // so its caves decide the generic frames without another query.
  bundle.searches = withPhotos(bundle.searches, bundle.landmarks.filter((l) => l.kind === 'cave'));
  res.json(bundle);
});

// Elevation at a point, from the same Gaussian-peak model the client uses.
app.get('/api/map/elevation', async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat and lng are required' });
  const cfg = await config();
  const { rows } = await pool.query('SELECT lat, lng, height_m, radius_m FROM mountains');
  let h = cfg.base_elevation_m;
  for (const m of rows) {
    const d = dist(lat, lng, m.lat, m.lng);
    h += m.height_m * Math.exp(-(d * d) / (m.radius_m * m.radius_m));
  }
  res.json({ lat, lng, elevation_m: Math.round(h) });
});

// CCTV cameras within a radius of a point -- what MERCY asks when it wants
// to know whether a place is watched. ?lat=&lng=&radius_m=
app.get('/api/map/cctv/near', async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng), radius = Number(req.query.radius_m || 500);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat and lng are required' });
  const { rows } = await pool.query(LAYERS.cctv);
  const near = rows.map((c) => ({ ...c, distance_m: Math.round(dist(lat, lng, c.lat, c.lng)) })).filter((c) => c.distance_m <= radius).sort((a, b) => a.distance_m - b.distance_m);
  const nearest = Math.min(...rows.map((c) => dist(lat, lng, c.lat, c.lng)));
  res.json({ lat, lng, radius_m: radius, count: near.length, covered: near.length > 0, nearest_m: Math.round(nearest), cameras: near });
});

// Search across landmarks, districts, named buildings, towers, cameras --
// and, once vehicle tracking is unlocked, a person's name or a plate.
app.get('/api/map/search', async (req, res) => {
  const qtext = String(req.query.q || '').trim();
  if (!qtext) return res.json({ results: [] });
  // Match on letters and digits only, so "ecopark", "eco park", "st aldrics"
  // and "KA05MN4471" all find what the participant means.
  const folded = qtext.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!folded) return res.json({ results: [] });
  const like = `%${folded}%`;
  const F = (col) => `regexp_replace(lower(${col}), '[^a-z0-9]', '', 'g') LIKE $1`;
  const { rows } = await pool.query(
    `SELECT 'landmark' AS type, slug AS key, name, kind, lat, lng FROM landmarks WHERE ${F('name')}
     UNION ALL SELECT 'district', slug, name, kind, center_lat, center_lng FROM districts WHERE ${F('name')}
     UNION ALL SELECT 'building', id::text, name, kind, lat, lng FROM buildings WHERE name IS NOT NULL AND ${F('name')}
     UNION ALL SELECT 'tower', id::text, name, kind, lat, lng FROM towers WHERE ${F('name')} AND kind <> 'pylon'
     UNION ALL SELECT 'cctv', code, code || ' ' || name, 'cctv', lat, lng FROM cctv_cameras WHERE ${F('code')} OR ${F('name')}
     UNION ALL SELECT 'vehicle', slug, owner || ' · ' || plate, 'vehicle', lat, lng FROM vehicles WHERE (${F('owner')} OR ${F('plate')} OR ${F('model')}) AND $2::boolean
     LIMIT 12`,
    [like, await unlocked()]
  );
  res.json({ results: rows });
});

// A tracked vehicle, where it is, and what the participant may know of its
// stops. 403 until the cave trace has unlocked tracking; explicit columns
// only -- the per-stop result texts never leave the server, and nothing in
// the row set says which stop is the true one.
// Every stop carries state: 'searched' (the drones have been; outcome says
// what they found), 'current' (where the car is going / waiting) or 'ahead'.
// A 'chase' car's list holds only the searched stops and the current one:
// the rest stay on the server until the car has driven there. The car is
// placed at at_seq (a stop it is at) or at start (a point on the road).
app.get('/api/vehicles/:slug', async (req, res) => {
  if (!(await unlocked())) return res.status(403).json({ error: 'not unlocked' });
  const v = (await pool.query('SELECT slug, owner, plate, model, note, mode, lat, lng FROM vehicles WHERE slug = $1', [req.params.slug])).rows[0];
  if (!v) return res.status(404).json({ error: 'not found' });
  res.json(await vehicleState(v));
});
async function vehicleState(v) {
  const { rows: stops } = await pool.query(
    'SELECT seq, name, note, lat, lng, building_id, dwell_s, logged_label, cctv_code FROM vehicle_stops WHERE vehicle = $1 ORDER BY seq',
    [v.slug]
  );
  const slugs = stops.map((s) => stopSlug(v.slug, s.seq));
  const { rows: done } = slugs.length
    ? await pool.query('SELECT spot_slug, bool_or(found) AS found, max(searched_at) AS searched_at FROM searches WHERE spot_slug = ANY($1) GROUP BY spot_slug', [slugs])
    : { rows: [] };
  const byslug = new Map(done.map((d) => [d.spot_slug, d]));
  let last = null;
  for (const s of stops) {
    const d = byslug.get(stopSlug(v.slug, s.seq));
    if (d) {
      s.state = 'searched'; s.outcome = d.found ? 'found' : 'clear'; s.searched_at = d.searched_at;
      if (!last || d.searched_at > last.searched_at) last = s;
    } else { s.state = 'ahead'; }
  }
  const found = stops.find((s) => s.outcome === 'found') || null;
  let shown = stops, at = null, chase = null;
  if (v.mode === 'chase') {
    const current = found ? null : stops.find((s) => s.state !== 'searched') || null;
    if (current) current.state = 'current';
    // the car is at the stop she was found at, else at the stop the drones last
    // cleared (it leaves once app.js has shown the result), else on the road
    at = found || last;
    shown = stops.filter((s) => s.state !== 'ahead');
    chase = { total: stops.length, searched: stops.filter((s) => s.state === 'searched').length, current: current ? current.seq : null, found: !!found };
  } else if (v.mode === 'parked') {
    shown = [];
  } else {
    at = stops[0] || null;
  }
  return {
    ...v,
    start: { lat: at ? at.lat : v.lat, lng: at ? at.lng : v.lng },
    at_seq: at ? at.seq : null,
    stops: shown,
    chase,
  };
}

// ---------------------------------------------------------------------------
// The drone search. The player names a point (typed coordinates, an SOS fix,
// or a right-clicked building); the swarm flies out from Police HQ and
// searches a circle of search_radius_m around it. What comes back, in order
// of precedence:
//   1. once tracking is unlocked, a point at one of Nikhil's stops (within
//      STOP_MATCH_M or the same building) answers with that stop's text --
//      'found' only at app_config.truth_stop, which the browser never sees;
//   2. otherwise the first story spot (by priority) whose radius covers the
//      point answers with its outcome ('clue', 'trace', 'clear'); a spot
//      whose requires_spots have not all been swept answers with its sealed
//      row instead (the cave stays sealed until sos-1..sos-4 are swept);
//   3. otherwise today's generic 'No trace' over whatever structures are
//      inside the circle.
// found=true (the engine's MAP-FOUND) exists only on path 1.
// Every answer also carries `photos`: the drone frames for what was searched
// (see photosFor above), so the sweep is something the participant can see.
// ---------------------------------------------------------------------------
app.post('/api/search', async (req, res) => {
  const body = req.body || {};
  const lat = Number(body.lat), lng = Number(body.lng);
  const source = ['coords', 'building', 'sos'].includes(body.source) ? body.source : 'coords';
  const buildingId = Number.isInteger(body.building_id) ? body.building_id : null;
  const following = typeof body.vehicle === 'string' ? body.vehicle.slice(0, 40) : null;   // the car being tracked, if any
  const cfg = await config();
  const raw = await rawConfig();
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat and lng are required' });
  const b = cfg.bounds;
  if (lat < b.south || lat > b.north || lng < b.west || lng > b.east) return res.status(400).json({ error: 'outside the model' });

  const radius = cfg.search_radius_m;
  const wasUnlocked = cfg.vehicle_tracking;

  // what the drones actually looked at
  const [bl, tw, lm] = await Promise.all([
    pool.query('SELECT id, name, kind, lat, lng FROM buildings'),
    pool.query("SELECT name, kind, lat, lng FROM towers WHERE kind <> 'pylon'"),
    pool.query("SELECT name, kind, lat, lng FROM landmarks WHERE kind IN ('cave', 'bus_stop')"),
  ]);
  const within = (rows, label) => rows.filter((r) => dist(lat, lng, r.lat, r.lng) <= radius).map((r) => ({ type: label, name: r.name || `${r.kind} building`, kind: r.kind, distance_m: Math.round(dist(lat, lng, r.lat, r.lng)) }));
  const structures = [...within(bl.rows, 'building'), ...within(tw.rows, 'tower'), ...within(lm.rows, 'landmark')].sort((a, c) => a.distance_m - c.distance_m);
  const generic = structures.length
    ? `Searched ${radius} m around the point: ${structures.length} structure${structures.length > 1 ? 's' : ''} (${structures.slice(0, 3).map((s) => s.name).join(', ')}${structures.length > 3 ? ', …' : ''}). No trace.`
    : `Searched ${radius} m around the point: open ground, no structures. No trace.`;

  let outcome = null, result = null, spotSlug = null, evidenceIds = [], items = null;

  // 1. A vehicle stop -- only once the cave trace has unlocked tracking. The
  //    car being followed answers first; Nikhil's stops answer whether or not
  //    he is the one being followed; anyone else's only while they are.
  if (wasUnlocked) {
    const { rows: stops } = await pool.query('SELECT id, vehicle, seq, name, lat, lng, building_id, result_clear, result_found FROM vehicle_stops ORDER BY vehicle, seq');
    const atStop = stops
      .filter((s) => s.vehicle === 'nikhil' || s.vehicle === following)
      .map((s) => ({ ...s, distance_m: dist(lat, lng, s.lat, s.lng) }))
      .filter((s) => s.distance_m <= STOP_MATCH_M || (buildingId !== null && s.building_id === buildingId))
      .sort((a, c) => (a.vehicle === following ? 0 : 1) - (c.vehicle === following ? 0 : 1) || a.distance_m - c.distance_m)[0];
    if (atStop) {
      if (raw.truth_stop == null) {
        console.warn('[city-map] app_config.truth_stop is missing (upgraded volume?) -- every stop answers clear; apply db/03_story.sql or re-seed with `docker compose down -v`');
      }
      spotSlug = stopSlug(atStop.vehicle, atStop.seq);
      if (raw.truth_stop != null && String(atStop.id) === String(raw.truth_stop)) {
        outcome = 'found';
        result = atStop.result_found || `Thermal signature at ${atStop.name}. One person, alive, sheltered inside. Meera located.`;
      } else {
        outcome = 'clear';
        result = atStop.result_clear || generic;
      }
    }
  }

  // 2. Story spots, by priority: the first whose radius covers the point.
  if (!outcome) {
    const { rows: spots } = await pool.query('SELECT slug, priority, lat, lng, radius_m, outcome, result, items, evidence_ids, requires_spots, sealed_slug FROM story_spots ORDER BY priority, slug');
    const hit = spots.find((s) => dist(lat, lng, s.lat, s.lng) <= s.radius_m);
    if (hit) {
      let spot = hit;
      const required = hit.requires_spots || [];
      if (required.length) {
        const { rows: done } = await pool.query('SELECT DISTINCT spot_slug FROM searches WHERE spot_slug = ANY($1)', [required]);
        const swept = new Set(done.map((r) => r.spot_slug));
        if (!required.every((k) => swept.has(k))) spot = spots.find((s) => s.slug === hit.sealed_slug) || null;
      }
      if (spot) {
        outcome = spot.outcome;
        result = spot.result;
        spotSlug = spot.slug;
        items = spot.items == null ? null : spot.items;
        evidenceIds = spot.evidence_ids || [];
      }
    }
  }

  // 3. Nothing story-shaped here: the generic sweep.
  if (!outcome) { outcome = 'clear'; result = generic; }
  const found = outcome === 'found';

  const ins = await pool.query(
    'INSERT INTO searches (lat, lng, source, building_id, found, result, outcome, spot_slug, evidence_ids, items) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, searched_at',
    [lat, lng, source, buildingId, found, result, outcome, spotSlug, evidenceIds, items == null ? null : JSON.stringify(items)]
  );
  // The first trace row is the unlock; later cave sweeps add rows but change nothing.
  const unlocks = outcome === 'trace' && !wasUnlocked ? ['vehicle_tracking'] : [];
  // The landmarks the drones looked at already include every cave.
  const photos = photosFor({ spot_slug: spotSlug, outcome, source, lat, lng }, lm.rows.filter((r) => r.kind === 'cave'));
  res.json({
    id: ins.rows[0].id, lat, lng, source, radius_m: radius, found, result, structures, searched_at: ins.rows[0].searched_at,
    outcome, spot_slug: spotSlug, evidence_ids: evidenceIds, items, unlocks, photos, story: await story(),
  });
});

app.get('/api/searches', async (req, res) => {
  const [{ rows }, caves] = await Promise.all([pool.query(LAYERS.searches), caveLandmarks()]);
  res.json({ count: rows.length, searches: withPhotos(rows, caves) });
});

// ---------------------------------------------------------------------------
// Evidence API. The model is MERCY's own tool, not a source of evidence, so
// it exposes the contract with nothing in it; locations come from the
// services that actually observed them.
app.get('/api/evidence', requireMercyKey, (req, res) => res.json({ service: 'city-map', count: 0, evidence: [] }));
app.get('/api/evidence/:evidenceId', requireMercyKey, (req, res) => res.status(404).json({ error: 'not found' }));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'city-map' }));

// ---------------------------------------------------------------------------
// Participants (see /MULTIPLAYER.md and tenant.js). The city itself -- every
// layer, the story spots, the cars and their stops -- is read from the
// pristine `template` schema by everyone; what a participant changes
// (searches, app_config) is copied into a schema of their own at login.
// ---------------------------------------------------------------------------
const STATIC_TABLES = ['districts', 'roads', 'water', 'parks', 'mountains', 'landmarks', 'buildings', 'towers', 'power_lines', 'cctv_cameras', 'trees', 'props', 'story_spots', 'vehicles', 'vehicle_stops'];
// The new schema is on the search path when this runs, so app_config here is
// the participant's copy and vehicle_stops resolves to template. The copy
// carries template's truth_stop -- the same stop for everyone -- so redraw
// it: each participant's Meera is at a stop of her own. A copy without the
// key (a template seeded from an older 03_story.sql) gets one drawn instead.
async function afterProvision(client) {
  const draw = "(SELECT id::text FROM vehicle_stops WHERE vehicle = 'nikhil' ORDER BY random() LIMIT 1)";
  const { rowCount } = await client.query(`UPDATE app_config SET value = ${draw} WHERE key = 'truth_stop'`);
  if (!rowCount) await client.query(`INSERT INTO app_config (key, value) VALUES ('truth_stop', ${draw})`);
}
// What the admin panel shows for one participant: how far the search has
// got. Runs as that participant, so the proxy already points at their rows.
async function summary() {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS searches,
            count(DISTINCT spot_slug) FILTER (WHERE spot_slug LIKE 'sos-%')::int AS sos_swept,
            COALESCE(bool_or(outcome = 'trace'), false) AS trace,
            count(DISTINCT spot_slug) FILTER (WHERE spot_slug ~ '^stop-[0-9]+$')::int AS stops_searched,
            COALESCE(bool_or(found), false) AS found
     FROM searches`
  );
  return { ...rows[0], tracking_unlocked: await unlocked() };
}
tenant.mount(app, { service: 'city-map', pool: rawPool, sqlDir: path.join(__dirname, 'db'), staticTables: STATIC_TABLES, afterProvision, summary });
// last, so it catches what guardApp forwards from every route above
app.use(app.tenantErrorHandler);

app.listen(PORT, () => {
  console.log(`[city-map] listening on :${PORT}`);
});
