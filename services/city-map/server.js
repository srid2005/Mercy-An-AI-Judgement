const path = require('path');
const express = require('express');
const cors = require('cors');
const { pool } = require('./db');

const PORT = process.env.PORT || 4011;
const MERCY_API_KEY = process.env.MERCY_API_KEY || 'dev-mercy-key';
const M_LAT = 110574, M_LNG = 108400;

const app = express();
app.use(cors());
app.use(express.json());
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
  };
}
const dist = (aLat, aLng, bLat, bLng) => Math.hypot((bLng - aLng) * M_LNG, (bLat - aLat) * M_LAT);

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
  searches: 'SELECT s.id, s.lat, s.lng, s.source, s.building_id, b.name AS building_name, s.found, s.result, s.searched_at FROM searches s LEFT JOIN buildings b ON b.id = s.building_id ORDER BY s.id',
};

// ---------------------------------------------------------------------------
// Map data -- everything is lat/lng.
// ---------------------------------------------------------------------------
app.get('/api/map/config', async (req, res) => res.json(await config()));

for (const layer of Object.keys(LAYERS)) {
  app.get(`/api/map/${layer}`, async (req, res) => {
    const { rows } = await pool.query(LAYERS[layer]);
    res.json({ count: rows.length, [layer]: rows });
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

// Search across landmarks, districts, named buildings, towers, cameras.
app.get('/api/map/search', async (req, res) => {
  const qtext = String(req.query.q || '').trim();
  if (!qtext) return res.json({ results: [] });
  const like = `%${qtext}%`;
  const { rows } = await pool.query(
    `SELECT 'landmark' AS type, slug AS key, name, kind, lat, lng FROM landmarks WHERE name ILIKE $1
     UNION ALL SELECT 'district', slug, name, kind, center_lat, center_lng FROM districts WHERE name ILIKE $1
     UNION ALL SELECT 'building', id::text, name, kind, lat, lng FROM buildings WHERE name ILIKE $1
     UNION ALL SELECT 'tower', id::text, name, kind, lat, lng FROM towers WHERE name ILIKE $1 AND kind <> 'pylon'
     UNION ALL SELECT 'cctv', code, code || ' ' || name, 'cctv', lat, lng FROM cctv_cameras WHERE code ILIKE $1 OR name ILIKE $1
     LIMIT 12`,
    [like]
  );
  res.json({ results: rows });
});

// ---------------------------------------------------------------------------
// The drone search. The player names a point (typed coordinates, the SOS fix,
// or a right-clicked building); the swarm flies out from Police HQ and
// searches a circle of search_radius_m around it. The only place that
// counts as a find is the truth landmark, which the browser never receives.
// ---------------------------------------------------------------------------
app.post('/api/search', async (req, res) => {
  const body = req.body || {};
  const lat = Number(body.lat), lng = Number(body.lng);
  const source = ['coords', 'building', 'sos'].includes(body.source) ? body.source : 'coords';
  const buildingId = Number.isInteger(body.building_id) ? body.building_id : null;
  const cfg = await config();
  const raw = await rawConfig();
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat and lng are required' });
  const b = cfg.bounds;
  if (lat < b.south || lat > b.north || lng < b.west || lng > b.east) return res.status(400).json({ error: 'outside the model' });

  const radius = cfg.search_radius_m;
  const truth = (await pool.query('SELECT name, lat, lng FROM landmarks WHERE slug = $1', [raw.truth_landmark])).rows[0];
  const dTruth = truth ? dist(lat, lng, truth.lat, truth.lng) : Infinity;
  const found = dTruth <= radius;

  // what the drones actually looked at
  const [bl, tw, lm] = await Promise.all([
    pool.query('SELECT id, name, kind, lat, lng FROM buildings'),
    pool.query("SELECT name, kind, lat, lng FROM towers WHERE kind <> 'pylon'"),
    pool.query("SELECT name, kind, lat, lng FROM landmarks WHERE kind IN ('cave', 'bus_stop')"),
  ]);
  const within = (rows, label) => rows.filter((r) => dist(lat, lng, r.lat, r.lng) <= radius).map((r) => ({ type: label, name: r.name || `${r.kind} building`, kind: r.kind, distance_m: Math.round(dist(lat, lng, r.lat, r.lng)) }));
  const structures = [...within(bl.rows, 'building'), ...within(tw.rows, 'tower'), ...within(lm.rows, 'landmark')].sort((a, c) => a.distance_m - c.distance_m);

  let result;
  if (found) result = `Thermal signature at ${truth.name}. One person, alive, sheltered inside. Meera located.`;
  else if (structures.length) result = `Searched ${radius} m around the point: ${structures.length} structure${structures.length > 1 ? 's' : ''} (${structures.slice(0, 3).map((s) => s.name).join(', ')}${structures.length > 3 ? ', …' : ''}). No trace.`;
  else result = `Searched ${radius} m around the point: open ground, no structures. No trace.`;

  const ins = await pool.query(
    'INSERT INTO searches (lat, lng, source, building_id, found, result) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, searched_at',
    [lat, lng, source, buildingId, found, result]
  );
  res.json({ id: ins.rows[0].id, lat, lng, source, radius_m: radius, found, result, structures, searched_at: ins.rows[0].searched_at });
});

app.get('/api/searches', async (req, res) => {
  const { rows } = await pool.query(LAYERS.searches);
  res.json({ count: rows.length, searches: rows });
});

// ---------------------------------------------------------------------------
// Evidence API. The model is MERCY's own tool, not a source of evidence, so
// it exposes the contract with nothing in it; locations come from the
// services that actually observed them.
app.get('/api/evidence', requireMercyKey, (req, res) => res.json({ service: 'city-map', count: 0, evidence: [] }));
app.get('/api/evidence/:evidenceId', requireMercyKey, (req, res) => res.status(404).json({ error: 'not found' }));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'city-map' }));

app.listen(PORT, () => {
  console.log(`[city-map] listening on :${PORT}`);
});
