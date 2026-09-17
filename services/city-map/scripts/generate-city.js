#!/usr/bin/env node
// Generates db/02_city.sql: the whole fictional city of Meridian -- a radial
// plan around the City Police tower, a ring of mountains on the border, the
// caves in the hills at the map's edge. Deterministic (seeded PRNG), so the
// city is identical on every run. `npm run gen:city` to regenerate.
const fs = require('fs');
const path = require('path');

const C = { lat: 13.0, lng: 77.5 };           // fictional coordinates for a fictional city
const BASE = 900;                              // plateau elevation, metres
const HALF = 6500;                             // half-size of the map, metres
const M_LAT = 110574, M_LNG = 108400;

const r6 = (n) => Number(n.toFixed(6));
const r1 = (n) => Number(n.toFixed(1));
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const toLL = (x, y) => [r6(C.lat + y / M_LAT), r6(C.lng + x / M_LNG)];
// polar: distance in metres, bearing in degrees clockwise from north
const polar = (r, deg) => { const a = (deg * Math.PI) / 180; return { x: r * Math.sin(a), y: r * Math.cos(a) }; };
const norm = (deg) => ((deg % 360) + 360) % 360;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(14102018);
const between = (a, b) => a + (b - a) * rand();

// ---------------------------------------------------------------------------
// Mountains: a ring on the border, four named ranges, four named peaks.
// ---------------------------------------------------------------------------
const MOUNTAINS = [];
const rangeFor = (deg) => (deg < 45 || deg >= 315 ? 'Northern Wall' : deg < 135 ? 'Eastern Scarp' : deg < 225 ? 'Southern Hills' : 'Western Tors');
const NAMED_PEAKS = { 0: ['Sentinel Peak', 460, 1900], 90: ['Ash Ridge', 380, 1700], 180: ['Kettle Hill', 400, 1700], 270: ['Grey Tor', 420, 1800] };
for (let deg = 0; deg < 360; deg += 18) {
  const named = NAMED_PEAKS[deg];
  const jitter = named ? 0 : between(-6, 6);
  const r = named ? 6000 : between(5850, 6350);
  const p = polar(r, deg + jitter);
  MOUNTAINS.push({ range: rangeFor(norm(deg + jitter)), name: named ? named[0] : null, x: p.x, y: p.y, h: named ? named[1] : between(220, 360), rad: named ? named[2] : between(1250, 1750) });
}
function elevationXY(x, y) {
  let h = BASE;
  for (const m of MOUNTAINS) { const dx = x - m.x, dy = y - m.y; h += m.h * Math.exp(-(dx * dx + dy * dy) / (m.rad * m.rad)); }
  return h;
}

// ---------------------------------------------------------------------------
// Street plan: rings + radial avenues + block streets in between.
// ---------------------------------------------------------------------------
const RINGS = [600, 1800, 3400, 4800];
const RING_NAMES = ['Plaza Ring', 'Inner Ring Road', 'Outer Ring Road', 'Border Road'];
const RING_CLASS = ['arterial', 'arterial', 'highway', 'highway'];
const AVENUES = { 0: 'North Avenue', 45: 'Kestrel Avenue', 90: 'East Avenue', 135: 'Harrow Road', 180: 'South Avenue', 225: 'Mill Road', 270: 'West Avenue', 315: 'Garden Avenue' };

const roads = [];
const arc = (r, a0, a1, step = 6) => { const pts = []; for (let a = a0; a <= a1 + 1e-9; a += step) pts.push(toLL(...Object.values(polar(r, a)))); return pts; };
RINGS.forEach((r, i) => roads.push({ name: RING_NAMES[i], cls: RING_CLASS[i], path: arc(r, 0, 360, 5) }));
for (const [deg, name] of Object.entries(AVENUES)) {
  const d = Number(deg);
  const pts = [];
  for (let r = RINGS[0]; r <= RINGS[3]; r += 200) pts.push(toLL(...Object.values(polar(r, d))));
  roads.push({ name, cls: 'arterial', path: pts });
}
// block streets: a proper grid inside every annulus -- a sub-ring roughly
// every 170 m and a cross street roughly every 170 m of arc, so the blocks
// come out around 150 m square all over the city.
const subRings = [];
const subRadials = {}; // annulus index -> list of bearings
const STEPS = [22.5, 15, 11.25, 7.5, 5.625, 3.75, 2.8125, 2.25, 1.875];
const BLOCK = 170;
for (let i = 0; i < RINGS.length - 1; i++) {
  const a = RINGS[i], b = RINGS[i + 1];
  const nSub = Math.max(1, Math.round((b - a) / BLOCK) - 1);
  for (let k = 1; k <= nSub; k++) {
    const r = a + ((b - a) * k) / (nSub + 1);
    subRings.push(r);
    roads.push({ name: 'Ring ' + (i + 1) + String.fromCharCode(96 + k) + ' Street', cls: 'street', path: arc(r, 0, 360, 3) });
  }
  const want = (BLOCK / ((a + b) / 2)) * (180 / Math.PI);
  const step = STEPS.reduce((best, s) => (Math.abs(s - want) < Math.abs(best - want) ? s : best), STEPS[0]);
  subRadials[i] = [];
  for (let deg = 0; deg < 360 - 1e-9; deg += step) {
    if (AVENUES[deg]) continue;
    subRadials[i].push(deg);
    const pts = [];
    for (let r = a; r <= b + 1e-9; r += (b - a) / 8) pts.push(toLL(...Object.values(polar(r, deg))));
    roads.push({ name: deg.toFixed(2).replace(/\.?0+$/, '') + '° Cross, ring ' + (i + 1), cls: 'street', path: pts });
  }
}
// lanes in the hamlet at the foot of Kettle Hill
subRadials[RINGS.length - 1] = [];
for (const r of [5030, 5200, 5370, 5540]) { subRings.push(r); roads.push({ name: 'Kettle Hill lane', cls: 'street', path: arc(r, 166, 192, 1.5) }); }
for (let deg = 168; deg <= 190; deg += 3.5) {
  if (Math.abs(deg - 180) < 0.01) continue;
  subRadials[RINGS.length - 1].push(deg);
  const pts = [];
  for (let r = 4850; r <= 5650 + 1e-9; r += 100) pts.push(toLL(...Object.values(polar(r, deg))));
  roads.push({ name: 'Kettle Hill path ' + deg, cls: 'street', path: pts });
}
// the way out: South Avenue continues past Border Road to the Southgate terminus, then a footpath to the cave
const TERMINUS = polar(5000, 180);
const CAVE = polar(5400, 178.5);
const SOS = polar(5300, 176);
const QUARRY_CAVE = polar(5350, 262), HERMIT_CAVE = polar(5300, 38); // Meera's last fix -- surfaced by the smartwatch service, never by this one; the hamlet is built around it
roads.push({ name: 'Southgate Road', cls: 'arterial', path: [toLL(...Object.values(polar(4800, 180))), toLL(...Object.values(polar(4900, 180))), toLL(TERMINUS.x, TERMINUS.y)] });
roads.push({ name: 'Route 7 (Central Station to Southgate)', cls: 'bus_route', path: [toLL(...Object.values(polar(450, 180))), ...Array.from({ length: 24 }, (_, k) => toLL(...Object.values(polar(600 + (4400 * k) / 23, 180)))), toLL(TERMINUS.x, TERMINUS.y)] });
roads.push({ name: 'Footpath past the last stop', cls: 'footpath', path: [toLL(TERMINUS.x, TERMINUS.y), toLL(...Object.values(polar(5120, 179.6))), toLL(...Object.values(polar(5250, 179.1))), toLL(CAVE.x, CAVE.y)] });

// ---------------------------------------------------------------------------
// Districts: annular sectors of the plan.
// ---------------------------------------------------------------------------
function sectorPolygon(r0, r1, a0, a1) {
  const pts = [];
  if (r0 === 0) { for (let a = a0; a < a1; a += 10) pts.push(toLL(...Object.values(polar(r1, a)))); return pts; }
  for (let a = a0; a <= a1; a += 7.5) pts.push(toLL(...Object.values(polar(r1, a))));
  for (let a = a1; a >= a0; a -= 7.5) pts.push(toLL(...Object.values(polar(r0, a))));
  return pts;
}
const DISTRICTS = [
  { slug: 'civic-core',  name: 'Civic Core',      kind: 'civic',       r: [0, 600],      a: [0, 360],   n: 0,   h: [10, 30],  tall: 0,    w: [20, 60] },
  { slug: 'downtown',    name: 'Downtown',        kind: 'cbd',         r: [600, 1800],   a: [0, 360],   n: 420, h: [30, 120], tall: 0.28, w: [18, 44] },
  { slug: 'tech',        name: 'Tech Quarter',    kind: 'tech',        r: [1800, 3400],  a: [0, 90],    n: 260, h: [20, 80],  tall: 0.10, w: [24, 60] },
  { slug: 'old-town',    name: 'Old Town',        kind: 'heritage',    r: [1800, 3400],  a: [90, 180],  n: 320, h: [5, 16],   tall: 0,    w: [9, 22] },
  { slug: 'mill',        name: 'Mill District',   kind: 'industrial',  r: [1800, 3400],  a: [180, 270], n: 170, h: [6, 22],   tall: 0,    w: [30, 80] },
  { slug: 'garden',      name: 'Garden Quarter',  kind: 'residential', r: [1800, 3400],  a: [270, 360], n: 300, h: [8, 28],   tall: 0.02, w: [12, 30] },
  { slug: 'northfield',  name: 'Northfield',      kind: 'suburb',      r: [3400, 4800],  a: [-45, 45],  n: 220, h: [5, 14],   tall: 0,    w: [10, 24] },
  { slug: 'eastmark',    name: 'Eastmark',        kind: 'suburb',      r: [3400, 4800],  a: [45, 135],  n: 200, h: [5, 14],   tall: 0,    w: [10, 24] },
  { slug: 'southgate',   name: 'Southgate',       kind: 'village',     r: [3400, 4800],  a: [135, 225], n: 130, h: [4, 10],   tall: 0,    w: [8, 18] },
  { slug: 'westhollow',  name: 'Westhollow',      kind: 'suburb',      r: [3400, 4800],  a: [225, 315], n: 200, h: [5, 14],   tall: 0,    w: [10, 24] },
  { slug: 'kettle-foot', name: 'Kettle Hill hamlet', kind: 'village',  r: [4850, 5650],  a: [166, 192], n: 90,  h: [4, 9],    tall: 0,    w: [8, 16], maxRise: 460 },
];
for (const d of DISTRICTS) {
  d.polygon = sectorPolygon(d.r[0], d.r[1], d.a[0], d.a[1]);
  const mid = polar((d.r[0] + d.r[1]) / 2 || 0, (d.a[0] + d.a[1]) / 2);
  [d.clat, d.clng] = d.r[0] === 0 ? toLL(0, 0) : toLL(mid.x, mid.y);
}

// ---------------------------------------------------------------------------
// Water, parks, forests at the foot of the hills.
// ---------------------------------------------------------------------------
const circleLL = (cx, cy, radius, n, wobble) => { const pts = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, r = radius * (1 + wobble * (rand() - 0.5) * 2); pts.push(toLL(cx + Math.cos(a) * r, cy + Math.sin(a) * r)); } return pts; };
const WATER = [
  { name: 'Eco-Park pond', kind: 'pond', ...polar(4150, 292), rad: 110 },
  { name: 'Heron Lake', kind: 'lake', ...polar(2600, 300), rad: 380 },
  { name: 'Mill Pond', kind: 'pond', ...polar(2500, 235), rad: 200 },
  { name: 'Eastmark Lake', kind: 'lake', ...polar(4050, 100), rad: 430 },
  { name: 'Kettle Tarn', kind: 'pond', ...polar(5250, 195), rad: 160 },
];
const PARKS = [
  { name: 'Eco-Park', kind: 'eco', ...polar(4150, 292), rad: 420 },
  { name: 'Central Plaza', kind: 'plaza', x: 0, y: 0, rad: 520 },
  { name: 'Northfield Commons', kind: 'park', ...polar(4000, 20), rad: 480 },
  { name: 'Old Town Green', kind: 'park', ...polar(2500, 140), rad: 240 },
  { name: 'Garden Quarter Park', kind: 'park', ...polar(3000, 330), rad: 260 },
  { name: 'Northern Forest', kind: 'forest', ...polar(5250, 20), rad: 900 },
  { name: 'Scarp Woods', kind: 'forest', ...polar(5300, 110), rad: 800 },
  { name: 'Kettle Woods', kind: 'forest', ...polar(5300, 205), rad: 750 },
  { name: 'Tor Forest', kind: 'forest', ...polar(5300, 290), rad: 850 },
];
const inCircle = (x, y, c, k = 0.85) => (x - c.x) ** 2 + (y - c.y) ** 2 < c.rad * c.rad * k;

// ---------------------------------------------------------------------------
// Named buildings. The police tower is the centre of everything.
// ---------------------------------------------------------------------------
const named = [
  { name: 'City Police Headquarters', kind: 'police', x: 0, y: 0, rot: 0, w: 52, d: 52, h: 280, floors: 72, district: 'civic-core' },
  { name: 'City Hall', kind: 'civic', ...polar(420, 0), rot: 0, w: 90, d: 60, h: 42, floors: 9, district: 'civic-core' },
  { name: 'High Court', kind: 'civic', ...polar(420, 90), rot: 90, w: 100, d: 70, h: 38, floors: 8, district: 'civic-core' },
  { name: 'Central Station', kind: 'station', ...polar(430, 180), rot: 0, w: 170, d: 60, h: 20, floors: 3, district: 'civic-core' },
  { name: 'City Museum', kind: 'civic', ...polar(420, 270), rot: 90, w: 90, d: 60, h: 26, floors: 5, district: 'civic-core' },
  { name: 'Kestrel Tower', kind: 'office', ...polar(950, 45), rot: 45, w: 44, d: 44, h: 190, floors: 48, district: 'downtown' },
  { name: 'Meridian Exchange', kind: 'office', ...polar(1000, 135), rot: 45, w: 50, d: 40, h: 150, floors: 38, district: 'downtown' },
  { name: 'Meridian General Hospital', kind: 'hospital', ...polar(1450, 290), rot: 20, w: 130, d: 70, h: 48, floors: 12, district: 'downtown' },
  { name: 'Northwind Campus', kind: 'tech', ...polar(2600, 40), rot: 40, w: 110, d: 60, h: 72, floors: 18, district: 'tech' },
  { name: 'Harrow Court', kind: 'residential', ...polar(2900, 160), rot: 160, w: 42, d: 22, h: 18, floors: 5, district: 'old-town' },
  { name: 'Block 14, Garden Quarter', kind: 'residential', ...polar(2750, 292), rot: 292, w: 46, d: 20, h: 22, floors: 6, district: 'garden' },
  { name: 'Kettle Hill pump house', kind: 'utility', ...polar(5250, 178), rot: 178, w: 16, d: 12, h: 7, floors: 1, district: 'kettle-foot' },
  { name: 'Old quarry office', kind: 'commercial', ...polar(5350, 186), rot: 186, w: 20, d: 12, h: 6, floors: 1, district: 'kettle-foot' },
  { name: 'Forest ranger post', kind: 'civic', ...polar(5150, 171), rot: 171, w: 14, d: 10, h: 5, floors: 1, district: 'kettle-foot' },
  { name: 'Hillside chapel', kind: 'civic', ...polar(5450, 183), rot: 183, w: 12, d: 9, h: 11, floors: 1, district: 'kettle-foot' },
  { name: 'Kettle Hill hostel', kind: 'commercial', ...polar(5080, 179), rot: 179, w: 30, d: 14, h: 9, floors: 2, district: 'kettle-foot' },
  { name: 'Transmitter hut', kind: 'utility', ...polar(5330, 172), rot: 172, w: 8, d: 6, h: 4, floors: 1, district: 'kettle-foot' },
  { name: 'City Library', kind: 'library', ...polar(430, 45), rot: 45, w: 60, d: 40, h: 22, floors: 4, district: 'civic-core' },
  { name: 'Meridian Grand Theatre', kind: 'theatre', ...polar(1300, 100), rot: 100, w: 46, d: 60, h: 26, floors: 5, district: 'downtown' },
  { name: 'Meridian Temple', kind: 'temple', ...polar(1500, 220), rot: 220, w: 36, d: 36, h: 24, floors: 1, district: 'downtown' },
  { name: 'Meridian University', kind: 'university', ...polar(2900, 25), rot: 25, w: 120, d: 90, h: 18, floors: 4, district: 'tech' },
  { name: 'Meridian Stadium', kind: 'stadium', ...polar(4000, 60), rot: 60, w: 190, d: 140, h: 30, floors: 4, district: 'eastmark' },
  { name: 'Meridian Grammar School', kind: 'school', ...polar(2600, 305), rot: 305, w: 70, d: 40, h: 12, floors: 3, district: 'garden' },
  { name: 'Northfield Primary School', kind: 'school', ...polar(4100, 350), rot: 350, w: 55, d: 30, h: 8, floors: 2, district: 'northfield' },
  { name: 'Eastmark High School', kind: 'school', ...polar(4000, 120), rot: 120, w: 70, d: 40, h: 12, floors: 3, district: 'eastmark' },
  { name: "St Aldric's Church", kind: 'church', ...polar(2300, 150), rot: 150, w: 44, d: 20, h: 16, floors: 1, district: 'old-town' },
  { name: 'Westhollow Chapel', kind: 'church', ...polar(4200, 250), rot: 250, w: 30, d: 14, h: 12, floors: 1, district: 'westhollow' },
  { name: 'Old Town Market Hall', kind: 'market', ...polar(2100, 120), rot: 120, w: 80, d: 30, h: 12, floors: 1, district: 'old-town' },
  { name: 'Mill District Fire Station', kind: 'fire_station', ...polar(2000, 235), rot: 235, w: 40, d: 24, h: 10, floors: 2, district: 'mill' },
  { name: 'Veterinary Hospital', kind: 'vet', ...polar(2000, 315), rot: 315, w: 40, d: 22, h: 9, floors: 2, district: 'garden' },
  { name: 'Auditorium', kind: 'auditorium', ...polar(2650, 47), rot: 47, w: 64, d: 52, h: 16, floors: 2, district: 'tech' },
  { name: 'Harrow Mills', kind: 'industrial', ...polar(2600, 245), rot: 245, w: 150, d: 80, h: 24, floors: 4, district: 'mill' },
];

// ---------------------------------------------------------------------------
// Buildings: sample inside each district, keep off the streets, water,
// parks and hill slopes. Height falls off with distance from the tower.
// ---------------------------------------------------------------------------
const rows = [];
const placed = [];
const push = (b) => { placed.push({ x: b.x, y: b.y, r: Math.max(b.w, b.d) * 0.6 }); const [lat, lng] = toLL(b.x, b.y); rows.push(`(${b.name ? q(b.name) : 'NULL'}, ${q(b.kind)}, ${lat}, ${lng}, ${r1(b.rot)}, ${r1(b.w)}, ${r1(b.d)}, ${r1(b.h)}, ${b.floors}, (SELECT id FROM districts WHERE slug=${q(b.district)}))`); };
named.forEach(push);
const nearRing = (r) => [...RINGS, ...subRings].some((R) => Math.abs(r - R) < 34);
const nearRadial = (r, deg, annulus) => {
  const bearings = [...Object.keys(AVENUES).map(Number), ...(subRadials[annulus] || [])];
  return bearings.some((b) => { const da = Math.abs(((deg - b + 540) % 360) - 180); return da * (Math.PI / 180) * r < 28; });
};
let generated = 0;
for (const d of DISTRICTS) {
  let placed = 0, tries = 0;
  while (placed < d.n && tries < d.n * 30) {
    tries++;
    const r = Math.sqrt(between(d.r[0] ** 2, d.r[1] ** 2));
    const deg = norm(between(d.a[0], d.a[1]));
    const { x, y } = polar(r, deg);
    const annulus = RINGS.findIndex((R, i) => r >= R && r < (RINGS[i + 1] || Infinity));
    if (r < RINGS[0] + 40 || nearRing(r) || nearRadial(r, deg, annulus)) continue;
    if (WATER.some((w) => inCircle(x, y, w, 1.2)) || PARKS.some((p) => inCircle(x, y, p, 1.0))) continue;
    if (elevationXY(x, y) > BASE + (d.maxRise || 45)) continue;
    if (named.some((n) => Math.hypot(n.x - x, n.y - y) < Math.max(n.w, n.d) * 0.8 + 20)) continue;
    const falloff = d.kind === 'cbd' ? 1 - (r - d.r[0]) / (d.r[1] - d.r[0]) * 0.7 : 1;
    const tall = rand() < d.tall * falloff;
    const h = tall ? between(110, 200) * falloff : between(d.h[0], d.h[1]) * falloff;
    const w = tall ? between(28, 46) : between(d.w[0], d.w[1]);
    const dd = tall ? between(28, 46) : between(d.w[0], d.w[1]);
    let kind = 'residential';
    if (d.kind === 'cbd') kind = tall ? 'office' : rand() < 0.55 ? 'commercial' : 'office';
    else if (d.kind === 'tech') kind = rand() < 0.8 ? 'tech' : 'commercial';
    else if (d.kind === 'industrial') kind = rand() < 0.75 ? 'industrial' : 'commercial';
    else if (d.kind === 'heritage') kind = rand() < 0.4 ? 'commercial' : 'residential';
    else if (rand() < 0.12) kind = 'commercial';
    push({ name: null, kind, x, y, rot: deg + (rand() - 0.5) * 4, w, d: dd, h, floors: Math.max(1, Math.round(h / 3.2)), district: d.slug });
    placed++; generated++;
  }
}

// ---------------------------------------------------------------------------
// Infrastructure: a high-voltage ring with pylons, a spur down to the hamlet,
// cell masts, water towers, radio relays on two peaks, two substations.
// ---------------------------------------------------------------------------
const TOWERS = [];
const tower = (kind, name, p, height) => TOWERS.push({ kind, name, p, height });
const LINES = [];
function stringLine(name, waypoints, spacing, pylonHeight) {
  // pylons every N metres along the polyline, a conductor through them
  const pylons = [];
  let carry = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i], b = waypoints[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let d = carry === 0 && i === 0 ? 0 : spacing - carry;
    while (d <= len) { pylons.push({ x: a.x + ((b.x - a.x) * d) / len, y: a.y + ((b.y - a.y) * d) / len }); d += spacing; }
    carry = len - (d - spacing);
  }
  pylons.forEach((p, i) => tower('pylon', name + ' pylon ' + (i + 1), p, pylonHeight));
  LINES.push({ name, path: pylons.map((p) => toLL(p.x, p.y)) });
}
const ringPts = []; for (let a = 250; a <= 610; a += 10) ringPts.push(polar(4200, a));
stringLine('Meridian ring main (132 kV)', [polar(2300, 250), polar(3200, 250), ...ringPts], 380, 38);
stringLine('Southgate spur (33 kV)', [polar(4200, 180), polar(4600, 178), polar(5250, 178)], 320, 26);
tower('substation', 'Mill District substation', polar(2300, 250), 8);
tower('substation', 'Southgate substation', polar(4600, 178), 6);
for (const [name, r, a] of [['Downtown mast', 700, 100], ['Tech Quarter mast', 2100, 30], ['Old Town mast', 2600, 130], ['Mill mast', 2500, 250], ['Garden Quarter mast', 2300, 330],
  ['Northfield mast', 4000, 10], ['Eastmark mast', 4100, 95], ['Westhollow mast', 4200, 265], ['Southgate mast', 4500, 175], ['Kettle Hill mast', 5300, 172]]) tower('cell', name, polar(r, a), 45);
tower('radio', 'Sentinel Peak relay', polar(6000, 0), 60);
tower('radio', 'Grey Tor relay', polar(6000, 270), 60);
tower('water', 'Northfield water tower', polar(3800, 35), 28);
tower('water', 'Southgate water tower', polar(4300, 190), 28);
tower('water', 'Kettle Hill water tower', polar(5200, 182), 24);


// ---------------------------------------------------------------------------
// Trees and props.
// ---------------------------------------------------------------------------
const TREES = [], PROPS = [];
const treeOK = (x, y) => elevationXY(x, y) < BASE + 320 && !WATER.some((w) => inCircle(x, y, w, 1.0)) && !placed.some((b) => Math.hypot(b.x - x, b.y - y) < b.r + 3);
const annulusOf = (r) => RINGS.findIndex((R, i) => r >= R && r < (RINGS[i + 1] || Infinity));
function fillCircle(cx, cy, rad, spacing, kind, hRange, exclude = 0, cap = 1500) {
  const n = Math.min(cap, Math.round((Math.PI * rad * rad) / (spacing * spacing)));
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * rad;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (Math.hypot(x - cx, y - cy) < exclude) continue;
    if (!treeOK(x, y)) continue;
    TREES.push({ kind, x, y, h: between(hRange[0], hRange[1]) });
  }
}
for (const p of PARKS) {
  if (p.kind === 'forest') fillCircle(p.x, p.y, p.rad * 0.95, 42, 'conifer', [9, 16], 0, 650);
  else fillCircle(p.x, p.y, p.rad * 0.9, 27, 'broadleaf', [7, 12], p.kind === 'plaza' ? 95 : 0, 900);
}
// rows along the avenues and the two big rings
for (const deg of Object.keys(AVENUES).map(Number)) {
  for (let r = 660; r <= 4780; r += 60) for (const side of [-1, 1]) {
    const p = polar(r, deg), n = polar(1, deg + 90);
    const x = p.x + n.x * side * 13, y = p.y + n.y * side * 13;
    if (treeOK(x, y) && !PARKS.some((pk) => inCircle(x, y, pk, 1))) TREES.push({ kind: 'broadleaf', x, y, h: between(8, 11) });
  }
}
for (const [R, off] of [[1800, 13], [3400, 19]]) {
  const step = (45 / R) * (180 / Math.PI);
  for (let deg = 0; deg < 360; deg += step) for (const side of [-1, 1]) {
    const p = polar(R + side * off, deg);
    if (treeOK(p.x, p.y) && !PARKS.some((pk) => inCircle(p.x, p.y, pk, 1))) TREES.push({ kind: 'broadleaf', x: p.x, y: p.y, h: between(8, 11) });
  }
}
// garden scatter in the living districts
for (const d of DISTRICTS) {
  if (!['residential', 'suburb', 'village', 'heritage'].includes(d.kind)) continue;
  const n = Math.round(d.n * 0.6);
  let ok = 0, tries = 0;
  while (ok < n && tries < n * 20) {
    tries++;
    const r = Math.sqrt(between(d.r[0] ** 2, d.r[1] ** 2)), deg = norm(between(d.a[0], d.a[1]));
    const { x, y } = polar(r, deg);
    if (nearRing(r) || nearRadial(r, deg, annulusOf(r))) continue;
    if (!treeOK(x, y)) continue;
    TREES.push({ kind: d.kind === 'village' ? 'conifer' : 'broadleaf', x, y, h: between(5, 10) });
    ok++;
  }
}
// thickets around every cave: conifers, some broadleaf, a lot of bushes.
// The mouth and the footpath up from the terminus stay clear.
const nearFootpath = (x, y) => {
  const a = TERMINUS, b = CAVE, dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
  return Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t)) < 11;
};
for (const c of [CAVE, QUARRY_CAVE, HERMIT_CAVE]) {
  let n = 0, tries = 0;
  while (n < 320 && tries < 3000) {
    tries++;
    const a = rand() * Math.PI * 2, r = 22 + Math.sqrt(rand()) * 230;
    const x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r;
    if (elevationXY(x, y) > BASE + 600) continue;
    if (WATER.some((w) => inCircle(x, y, w, 1.0))) continue;
    if (placed.some((b) => Math.hypot(b.x - x, b.y - y) < b.r + 3)) continue;
    if (c === CAVE && nearFootpath(x, y)) continue;
    // a mouth-facing gap so the entrance reads from the path side
    const roll = rand();
    const kind = roll < 0.55 ? 'bush' : roll < 0.85 ? 'conifer' : 'broadleaf';
    TREES.push({ kind, x, y, h: kind === 'bush' ? between(1.2, 2.8) : between(6, 13) });
    n++;
  }
}
// lamps along avenues and rings, on both kerbs, arm pointing at the road
const lamp = (x, y, rot) => PROPS.push({ kind: 'lamp', x, y, rot: norm(rot) });
for (const deg of Object.keys(AVENUES).map(Number)) for (let r = 640; r <= 4790; r += 36) for (const side of [-1, 1]) { const p = polar(r, deg), n = polar(1, deg + 90); lamp(p.x + n.x * side * 11, p.y + n.y * side * 11, deg + 90 - side * 90); }
for (const [R, off] of [[600, 11], [1800, 11], [3400, 17]]) { const step = (40 / R) * (180 / Math.PI); for (let deg = 0; deg < 360; deg += step) for (const side of [-1, 1]) { const p = polar(R + side * off, deg); lamp(p.x, p.y, deg + (side > 0 ? 180 : 0)); } }
// parked cars along the block streets
for (let i = 0; i < 1300; i++) {
  const ann = Math.floor(rand() * (RINGS.length - 1));
  const a = RINGS[ann], b = RINGS[ann + 1];
  if (rand() < 0.5) {
    const r = subRings.filter((sr) => sr > a && sr < b)[Math.floor(rand() * subRings.filter((sr) => sr > a && sr < b).length)];
    if (!r) continue;
    const deg = rand() * 360, side = rand() < 0.5 ? -1 : 1;
    const p = polar(r + side * 6.2, deg);
    if (!treeOK(p.x, p.y)) continue;
    PROPS.push({ kind: 'car', x: p.x, y: p.y, rot: norm(deg + 90) });
  } else {
    const list = subRadials[ann] || [];
    const deg = list[Math.floor(rand() * list.length)];
    if (deg === undefined) continue;
    const r = between(a + 40, b - 40), n = polar(1, deg + 90), side = rand() < 0.5 ? -1 : 1;
    const p = polar(r, deg);
    const x = p.x + n.x * side * 6.2, y = p.y + n.y * side * 6.2;
    if (!treeOK(x, y)) continue;
    PROPS.push({ kind: 'car', x, y, rot: norm(deg) });
  }
}
// boats, cranes, the fountain, bus shelters on route 7
for (const w of WATER) for (let i = 0; i < (w.kind === 'lake' ? 4 : 2); i++) { const a = rand() * Math.PI * 2, r = rand() * w.rad * 0.55; PROPS.push({ kind: 'boat', x: w.x + Math.cos(a) * r, y: w.y + Math.sin(a) * r, rot: rand() * 360 }); }
for (const [r, a, rot] of [[2450, 238, 20], [2700, 252, 200], [2900, 244, 110]]) { const p = polar(r, a); PROPS.push({ kind: 'crane', x: p.x, y: p.y, rot }); }
PROPS.push({ kind: 'fountain', x: 0, y: 0, rot: 0 });
{
  const eco = polar(4150, 292);
  for (const [r, a] of [[300, 292 - 4], [340, 292 + 3], [250, 292 + 9]]) { const p = polar(4150 + (a > 292 ? 0 : -60), a); PROPS.push({ kind: 'turbine', x: eco.x + (p.x - eco.x) * 0 + Math.cos((a * Math.PI) / 180) * r * 0 + (r * Math.cos(((a - 292) * 6 + 40) * Math.PI / 180)), y: eco.y + r * Math.sin(((a - 292) * 6 + 40) * Math.PI / 180), rot: 292 }); }
  for (let i = 0; i < 6; i++) PROPS.push({ kind: 'solar', x: eco.x - 260 + (i % 3) * 34, y: eco.y - 120 + Math.floor(i / 3) * 26, rot: 292 });
  PROPS.push({ kind: 'lookout', x: eco.x + 180, y: eco.y + 210, rot: 0 });
  for (const r of [160, 300]) roads.push({ name: 'Eco-Park loop', cls: 'footpath', path: Array.from({ length: 49 }, (_, i) => toLL(eco.x + Math.cos((i / 48) * Math.PI * 2) * r, eco.y + Math.sin((i / 48) * Math.PI * 2) * r)) });
}
for (const r of [1200, 2000, 2800, 3600, 4400]) { const p = polar(r, 180), n = polar(1, 270); PROPS.push({ kind: 'shelter', x: p.x + n.x * 13, y: p.y + n.y * 13, rot: 270 }); }
{ const n = polar(1, 90); PROPS.push({ kind: 'shelter', x: TERMINUS.x + n.x * 14, y: TERMINUS.y + n.y * 14, rot: 90 }); }

// ---------------------------------------------------------------------------
// Landmarks: the important places, the ones that get a label.
// ---------------------------------------------------------------------------
const elev = (p) => Math.round(elevationXY(p.x, p.y));
const LANDMARKS = [
  { slug: 'police-hq', name: 'City Police Headquarters', kind: 'police', p: { x: 0, y: 0 }, desc: 'The tallest structure in Meridian, at the exact centre of the plan. Every avenue leads here.' },
  { slug: 'city-hall', name: 'City Hall', kind: 'civic', p: polar(420, 0) },
  { slug: 'high-court', name: 'High Court', kind: 'civic', p: polar(420, 90), desc: 'Where the case will be heard.' },
  { slug: 'central-station', name: 'Central Station', kind: 'station', p: polar(430, 180), desc: 'Route 7 leaves from here for Southgate.' },
  { slug: 'city-museum', name: 'City Museum', kind: 'civic', p: polar(420, 270) },
  { slug: 'hospital', name: 'Meridian General Hospital', kind: 'hospital', p: polar(1450, 290) },
  { slug: 'city-library', name: 'City Library', kind: 'library', p: polar(430, 45) },
  { slug: 'vet-hospital', name: 'Veterinary Hospital', kind: 'vet', p: polar(2000, 315), desc: 'Garden Quarter, on the Inner Ring.' },
  { slug: 'auditorium', name: 'Auditorium', kind: 'auditorium', p: polar(2650, 47), desc: 'Next to the university.' },
  { slug: 'eco-park', name: 'Eco-Park', kind: 'park', p: polar(4150, 292), desc: 'Westhollow. Wind turbines, solar field, a pond and a lookout tower.' },
  { slug: 'grand-theatre', name: 'Meridian Grand Theatre', kind: 'theatre', p: polar(1300, 100), desc: 'Downtown, off East Avenue.' },
  { slug: 'temple', name: 'Meridian Temple', kind: 'temple', p: polar(1500, 220) },
  { slug: 'university', name: 'Meridian University', kind: 'university', p: polar(2900, 25) },
  { slug: 'stadium', name: 'Meridian Stadium', kind: 'stadium', p: polar(4000, 60), desc: 'Forty thousand seats on the Eastmark side.' },
  { slug: 'grammar-school', name: 'Meridian Grammar School', kind: 'school', p: polar(2600, 305) },
  { slug: 'northfield-primary', name: 'Northfield Primary School', kind: 'school', p: polar(4100, 350) },
  { slug: 'eastmark-high', name: 'Eastmark High School', kind: 'school', p: polar(4000, 120) },
  { slug: 'st-aldrics', name: "St Aldric's Church", kind: 'church', p: polar(2300, 150), desc: 'Old Town. The tower is the tallest thing south of the ring.' },
  { slug: 'westhollow-chapel', name: 'Westhollow Chapel', kind: 'church', p: polar(4200, 250) },
  { slug: 'market-hall', name: 'Old Town Market Hall', kind: 'market', p: polar(2100, 120) },
  { slug: 'fire-station', name: 'Mill District Fire Station', kind: 'fire_station', p: polar(2000, 235) },
  { slug: 'kestrel-tower', name: 'Kestrel Tower', kind: 'office', p: polar(950, 45), desc: 'Tallest office tower after the police headquarters.' },
  { slug: 'meridian-exchange', name: 'Meridian Exchange', kind: 'office', p: polar(1000, 135) },
  { slug: 'northwind-campus', name: 'Northwind Campus', kind: 'tech', p: polar(2600, 40), desc: "The Tech Quarter's main campus." },
  { slug: 'harrow-mills', name: 'Harrow Mills', kind: 'industrial', p: polar(2600, 245), desc: "The Mill District's namesake." },
  { slug: 'southgate-terminus', name: 'Southgate terminus (Route 7 last stop)', kind: 'bus_stop', p: TERMINUS, desc: 'The last stop. The road ends here; the hills start.' },
  { slug: 'kettle-cave', name: 'Cave, Kettle Hill (north face)', kind: 'cave', p: CAVE, desc: 'Unmarked cave at the southern edge of the map, a footpath past the last stop. Matches the geotag on two childhood photos (SOC-006, SOC-009).' },
  { slug: 'quarry-cave', name: 'Quarry cave', kind: 'cave', p: QUARRY_CAVE, desc: 'Old quarry workings in the Western Tors. No road access.' },
  { slug: 'hermit-cave', name: "Hermit's cave", kind: 'cave', p: HERMIT_CAVE, desc: 'A shallow overhang on the Northern Wall. Popular with hikers.' },
  { slug: 'sentinel-peak', name: 'Sentinel Peak', kind: 'hill', p: polar(6000, 0), desc: 'Highest point on the Northern Wall.' },
  { slug: 'ash-ridge', name: 'Ash Ridge', kind: 'hill', p: polar(6000, 90) },
  { slug: 'kettle-hill', name: 'Kettle Hill', kind: 'hill', p: polar(6000, 180), desc: 'Southern border of the city.' },
  { slug: 'grey-tor', name: 'Grey Tor', kind: 'hill', p: polar(6000, 270) },
  { slug: 'heron-lake', name: 'Heron Lake', kind: 'lake', p: WATER[0] },
  { slug: 'eastmark-lake', name: 'Eastmark Lake', kind: 'lake', p: WATER[2] },
  { slug: 'central-plaza', name: 'Central Plaza', kind: 'park', p: { x: 0, y: 0 } },
  { slug: 'northfield-commons', name: 'Northfield Commons', kind: 'park', p: PARKS[1] },
];

// ---------------------------------------------------------------------------
// Write SQL.
// ---------------------------------------------------------------------------
const L = [];
L.push('-- GENERATED by scripts/generate-city.js -- do not edit by hand.');
L.push("CREATE OR REPLACE FUNCTION t(s TEXT) RETURNS TIMESTAMPTZ AS $$ SELECT s::TIMESTAMPTZ $$ LANGUAGE SQL IMMUTABLE;");
const [southLat, westLng] = toLL(-HALF, -HALF), [northLat, eastLng] = toLL(HALF, HALF);
L.push(`INSERT INTO app_config (key, value) VALUES ('city', 'Meridian'), ('base_elevation_m', '${BASE}'), ('center_lat', '${C.lat}'), ('center_lng', '${C.lng}'), ('bounds_south', '${southLat}'), ('bounds_north', '${northLat}'), ('bounds_west', '${westLng}'), ('bounds_east', '${eastLng}');`);
L.push('INSERT INTO districts (slug, name, kind, center_lat, center_lng, polygon) VALUES');
L.push(DISTRICTS.map((d) => `(${q(d.slug)}, ${q(d.name)}, ${q(d.kind)}, ${d.clat}, ${d.clng}, ${q(JSON.stringify(d.polygon))})`).join(',\n') + ';');
L.push('INSERT INTO roads (name, class, path) VALUES');
L.push(roads.map((r) => `(${q(r.name)}, ${q(r.cls)}, ${q(JSON.stringify(r.path))})`).join(',\n') + ';');
L.push('INSERT INTO water (name, kind, polygon) VALUES');
L.push(WATER.map((w) => `(${q(w.name)}, ${q(w.kind)}, ${q(JSON.stringify(circleLL(w.x, w.y, w.rad, 16, 0.3)))})`).join(',\n') + ';');
L.push('INSERT INTO parks (name, kind, polygon) VALUES');
L.push(PARKS.map((p) => `(${q(p.name)}, ${q(p.kind)}, ${q(JSON.stringify(circleLL(p.x, p.y, p.rad, 14, p.kind === 'plaza' ? 0 : 0.3)))})`).join(',\n') + ';');
L.push('INSERT INTO mountains (range_name, peak_name, lat, lng, height_m, radius_m) VALUES');
L.push(MOUNTAINS.map((m) => { const [lat, lng] = toLL(m.x, m.y); return `(${q(m.range)}, ${m.name ? q(m.name) : 'NULL'}, ${lat}, ${lng}, ${r1(m.h)}, ${r1(m.rad)})`; }).join(',\n') + ';');
L.push('INSERT INTO landmarks (slug, name, kind, lat, lng, elevation_m, description) VALUES');
L.push(LANDMARKS.map((l) => { const [lat, lng] = toLL(l.p.x, l.p.y); return `(${q(l.slug)}, ${q(l.name)}, ${q(l.kind)}, ${lat}, ${lng}, ${elev(l.p)}, ${q(l.desc || '')})`; }).join(',\n') + ';');
L.push('INSERT INTO buildings (name, kind, lat, lng, rotation_deg, width_m, depth_m, height_m, floors, district_id) VALUES');
L.push(rows.join(',\n') + ';');

const HOME = polar(2750, 292);

// ---------------------------------------------------------------------------
// CCTV. Dense in the core and on the ring junctions, thin in the suburbs,
// and -- deliberately -- nothing within 900 m of the flat in the Garden
// Quarter. The guard below makes that a hard rule.
// ---------------------------------------------------------------------------
const CCTV = [];
const cam = (name, p, heading, range = 100, fov = 90) => CCTV.push({ name, p, heading: norm(heading), range, fov });
[45, 135, 225, 315].forEach((a, i) => cam('Central Plaza ' + ['NE', 'SE', 'SW', 'NW'][i], polar(560, a), a + 180, 130));
[0, 90, 180, 270].forEach((a, i) => cam('Police HQ perimeter ' + ['N', 'E', 'S', 'W'][i], polar(90, a), a, 110, 120));
cam('City Hall entrance', polar(380, 0), 180, 80); cam('High Court steps', polar(370, 90), 270, 80); cam('City Museum forecourt', polar(370, 270), 90, 80);
cam('Central Station, north concourse', polar(400, 172), 350, 90, 110); cam('Central Station, bus bays', polar(470, 188), 180, 120, 110);
for (const [a, name] of Object.entries(AVENUES)) { cam('Inner Ring Road at ' + name, polar(1800, Number(a)), Number(a) + 90, 110); cam('Outer Ring Road at ' + name, polar(3400, Number(a)), Number(a) + 90, 120); }
cam('Kestrel Tower lobby', polar(950, 45), 225, 70); cam('Meridian Exchange', polar(1000, 135), 315, 70); cam('Meridian General Hospital, A&E', polar(1450, 290), 110, 90);
cam('Northwind Campus gate', polar(2600, 40), 220, 100); cam('Northwind Campus car park', polar(2500, 55), 40, 100);
cam('Old Town Green', polar(2500, 140), 320, 90); cam('Old Town, Harrow Road', polar(3000, 110), 200, 90);
cam('Harrow Mills gate', polar(2600, 245), 65, 100); cam('Mill District yard', polar(2200, 255), 255, 100);
cam('Garden Avenue, north end', polar(2000, 350), 170, 90); cam('Westhollow Road', polar(3300, 275), 95, 90);
cam('Northfield Commons', polar(4000, 20), 200, 100); cam('Eastmark Lake shore', polar(4050, 100), 280, 100); cam('Westhollow high street', polar(4000, 270), 90, 90);
cam('Southgate village', polar(4200, 180), 180, 100); cam('Southgate terminus', TERMINUS, 180, 120, 120);
for (const c of CCTV) { const d = Math.hypot(c.p.x - HOME.x, c.p.y - HOME.y); if (d < 900) throw new Error('camera "' + c.name + '" is ' + Math.round(d) + ' m from the flat -- the Garden Quarter gap must stay empty'); }
L.push('INSERT INTO towers (kind, name, lat, lng, height_m) VALUES');
L.push(TOWERS.map((t) => { const [lat, lng] = toLL(t.p.x, t.p.y); return '(' + q(t.kind) + ', ' + q(t.name) + ', ' + lat + ', ' + lng + ', ' + t.height + ')'; }).join(',\n') + ';');
L.push('INSERT INTO power_lines (name, path) VALUES');
L.push(LINES.map((l) => '(' + q(l.name) + ', ' + q(JSON.stringify(l.path)) + ')').join(',\n') + ';');
{
  const [lat, lng] = toLL(SOS.x, SOS.y);
  L.push("INSERT INTO app_config (key, value) VALUES ('player_building', 'Block 14, Garden Quarter'), ('truth_landmark', 'kettle-cave'), ('search_radius_m', '60');");
}
L.push('INSERT INTO trees (kind, lat, lng, height_m) VALUES');
L.push(TREES.map((t) => { const [lat, lng] = toLL(t.x, t.y); return '(' + q(t.kind) + ', ' + lat + ', ' + lng + ', ' + r1(t.h) + ')'; }).join(',\n') + ';');
L.push('INSERT INTO props (kind, lat, lng, rotation_deg) VALUES');
L.push(PROPS.map((p) => { const [lat, lng] = toLL(p.x, p.y); return '(' + q(p.kind) + ', ' + lat + ', ' + lng + ', ' + r1(p.rot) + ')'; }).join(',\n') + ';');
L.push('INSERT INTO cctv_cameras (code, name, lat, lng, heading_deg, fov_deg, range_m, status) VALUES');
L.push(CCTV.map((c, i) => { const [lat, lng] = toLL(c.p.x, c.p.y); return "('CCTV-" + String(i + 1).padStart(2, '0') + "', " + q(c.name) + ', ' + lat + ', ' + lng + ', ' + r1(c.heading) + ', ' + c.fov + ', ' + c.range + ", 'online')"; }).join(',\n') + ';');
const out = path.join(__dirname, '..', 'db', '02_city.sql');
fs.writeFileSync(out, L.join('\n') + '\n');
const [caveLat, caveLng] = toLL(CAVE.x, CAVE.y);
console.log(`wrote ${out}: ${DISTRICTS.length} districts, ${roads.length} roads, ${WATER.length} lakes, ${PARKS.length} parks, ${MOUNTAINS.length} peaks, ${LANDMARKS.length} landmarks, ${rows.length} buildings (${generated} generated + ${named.length} named), ${TOWERS.length} towers, ${CCTV.length} cameras, ${TREES.length} trees, ${PROPS.length} props`);
console.log(`cave: ${caveLat}, ${caveLng} (elev ${elev(CAVE)} m); SOS: ${toLL(SOS.x, SOS.y).join(', ')} (${Math.round(Math.hypot(SOS.x - CAVE.x, SOS.y - CAVE.y))} m from the cave); terminus: ${toLL(TERMINUS.x, TERMINUS.y).join(', ')}`);
