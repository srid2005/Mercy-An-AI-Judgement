// The city model, blueprint style: dark blue ground grid, terrain as a
// wireframe with contour rings, every building as cyan wire edges over a
// translucent fill, roads as lines, pylons and masts, the police tower at
// the centre -- and the drone flight that leaves it to search the streets.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const BP = {
  bg: 0x061a30, grid: 0x1c4a72, grid2: 0x12345a, ground: 0x082240, wire: 0x2a6ea3, edge: 0x8fdcff, edgeDim: 0x3f8fc4,
  fill: 0x0b3358, water: 0x3aa5ff, waterFill: 0x0d3d6b, park: 0x33c39a, road: 0xbfe9ff, street: 0x4f95c6, bus: 0x39ff88,
  foot: 0xffb454, police: 0xffffff, beacon: 0xff3b30, cave2: 0xff9f43, stop: 0x39ff88, cctv: 0xf5d76e,
  power: 0xc7a6ff, cell: 0xffffff, water2: 0x7fd3ff, you: 0xff2a1e, drone: 0xdfeeff, scan: 0x39ff88, route: 0x8fdcff,
  sos: 0xff5fd2, clue: 0xffc44d,   // magenta: the cave trace (the --sos tint); amber: a swept story spot
};
const ROAD_LIFT = { highway: 1.4, arterial: 1.2, street: 1.0, bus_route: 2.2, footpath: 2.0 };
const FLIGHT = { altitude: 22, speed: 330, lag: 26, scanFor: 5 };   // metres above the ground, metres per second, metres between drones
const CAR = { len: 4.4, wid: 1.8 }, BUS = { len: 11, wid: 2.5 };     // vehicle footprints, metres
const TRACK = { speed: 34, dwell: 40, lane: 3.0 };                   // the tracked car: metres per second, seconds at each stop (loop mode), keep-left offset
const CAR_SCALE = 1.6, TRAIL_MAX = 6000, TRAIL_STEP = 6;             // the tracked car: times life size; its breadcrumb trail, points and metres between them
const FOLLOW = { up: 100, back: 28 };                               // the tracking view: metres above and behind the car
const CAR_COLORS = { grey: 0x8b949e, gray: 0x8b949e, silver: 0xc8ced6, white: 0xe6eaee, black: 0x22262c, red: 0xc62828, blue: 0x2f5fd0, maroon: 0x7a1d2e, yellow: 0xe0b100, green: 0x2f7d4f, brown: 0x6b4a2b, orange: 0xe07a1f };
function carColor(model) { for (const w of String(model || '').toLowerCase().split(/[^a-z]+/)) if (CAR_COLORS[w] !== undefined) return CAR_COLORS[w]; return CAR_COLORS.grey; }
const UP = new THREE.Vector3(0, 1, 0);
const TMP = new THREE.Vector3(), TMP2 = new THREE.Vector3();   // per-frame scratch
const SPECIAL = new Set(['school', 'church', 'theatre', 'stadium', 'temple', 'university', 'market', 'fire_station', 'library', 'vet', 'auditorium']);

export class BlueprintScene {
  constructor(container, data, geo, hooks) {
    this.container = container;
    this.data = data;
    this.geo = geo;
    this.hooks = hooks;
    this.labels = [];
    this.pickables = [];
    this.pulses = [];
    this.showLabels = true;
    this.timeScale = 3;       // the world runs fast by default; rate() drops it to 1 while the drones scan
    this.keys = new Set();
    this.tracked = null;      // the followed car (see trackVehicle)
    this.follow = false;

    const canvas = container.querySelector('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.hooks.onContextLost && this.hooks.onContextLost(); });
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BP.bg);
    this.scene.fog = new THREE.Fog(BP.bg, 7000, 42000);
    this.camera = new THREE.PerspectiveCamera(55, 1, 3, 120000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.screenSpacePanning = false;   // right-drag slides along the ground
    this.controls.panSpeed = 2.2;
    this.controls.rotateSpeed = 0.8;
    this.controls.zoomSpeed = 1.6;
    this.controls.minDistance = 30;
    this.controls.maxDistance = 60000;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.clock = new THREE.Clock();

    this.buildTerrain();
    this.buildFlats();
    this.buildRoads();
    this.buildRoadGraph();
    this.buildBuildings();
    this.buildTower();
    this.buildTowers();
    this.buildMarkers();
    this.buildCCTV();
    this.buildYou();
    this.buildTrees();
    this.buildProps();
    this.buildTraffic();
    this.buildDrones();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    canvas.addEventListener('pointermove', (e) => this.onPointer(e));
    canvas.addEventListener('pointerdown', (e) => { this.down = { x: e.clientX, y: e.clientY, button: e.button }; });
    canvas.addEventListener('pointerup', (e) => { if (this.down && e.button === 0 && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 4) this.onClick(e); });
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 4) this.onRightClick(e); });
    canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    canvas.tabIndex = 0;
    const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes((document.activeElement || {}).tagName);
    window.addEventListener('keydown', (e) => { if (typing()) return; const k = e.key.toLowerCase(); if (KEYS.has(k)) { this.keys.add(k); e.preventDefault(); } });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.resetView();
    this.animate();
  }

  // x east, y up (elevation), z south -- north points to -z.
  pos(lat, lng, lift = 0) {
    const p = this.geo.toXY(lat, lng);
    return new THREE.Vector3(p.x, this.geo.elevationXY(p.x, p.y) + lift, -p.y);
  }
  ground(x, z) { return this.geo.elevationXY(x, -z); }
  lines(verts, color, opts = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const mat = opts.dashed
      ? new THREE.LineDashedMaterial({ color, dashSize: opts.dash || 60, gapSize: opts.gap || 40, transparent: opts.opacity !== undefined, opacity: opts.opacity ?? 1, depthTest: !opts.xray })
      : new THREE.LineBasicMaterial({ color, transparent: opts.opacity !== undefined, opacity: opts.opacity ?? 1, depthTest: !opts.xray });
    const l = new THREE.LineSegments(g, mat);
    if (opts.dashed) l.computeLineDistances();
    if (opts.xray) l.renderOrder = 5;
    return l;
  }
  circle(center, r, n, y, color, opts = {}) {
    const pts = Array.from({ length: n }, (_, i) => new THREE.Vector3(center.x + Math.cos((i / n) * Math.PI * 2) * r, y, center.z + Math.sin((i / n) * Math.PI * 2) * r));
    const mat = opts.dashed ? new THREE.LineDashedMaterial({ color, dashSize: opts.dash || 30, gapSize: opts.gap || 20, transparent: true, opacity: opts.opacity ?? 1, depthTest: !opts.xray })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity: opts.opacity ?? 1, depthTest: !opts.xray });
    const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat);
    if (opts.dashed) l.computeLineDistances();
    if (opts.xray) l.renderOrder = 5;
    return l;
  }
  groundCircle(lat, lng, r, color, opts = {}) {
    const c = this.geo.toXY(lat, lng);
    const pts = Array.from({ length: 96 }, (_, i) => { const x = c.x + Math.cos((i / 96) * Math.PI * 2) * r, y = c.y + Math.sin((i / 96) * Math.PI * 2) * r; return new THREE.Vector3(x, this.geo.elevationXY(x, y) + 2, -y); });
    const mat = new THREE.LineDashedMaterial({ color, dashSize: opts.dash || 40, gapSize: opts.gap || 25, transparent: true, opacity: opts.opacity ?? 0.9, depthTest: false });
    const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat);
    l.computeLineDistances(); l.renderOrder = 5;
    return l;
  }

  // --- terrain ------------------------------------------------------------------------
  buildTerrain() {
    const e = this.geo.extent;
    const w = e.maxX - e.minX, h = e.maxY - e.minY, seg = 200;
    const g = new THREE.PlaneGeometry(w, h, seg, seg);
    g.rotateX(-Math.PI / 2);
    g.translate((e.minX + e.maxX) / 2, 0, -(e.minY + e.maxY) / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.geo.elevationXY(pos.getX(i), -pos.getZ(i)));
    this.terrain = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: BP.ground, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
    const wire = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: BP.wire, wireframe: true, transparent: true, opacity: 0.32 }));
    const grid = new THREE.GridHelper(Math.max(w, h) + 2000, 76, BP.grid, BP.grid2);
    grid.position.set((e.minX + e.maxX) / 2, this.geo.base + 0.3, -(e.minY + e.maxY) / 2);
    grid.material.transparent = true; grid.material.opacity = 0.55;
    const verts = [];
    for (const m of this.data.mountains) {
      const c = this.geo.toXY(m.lat, m.lng);
      for (let level = 50; level < m.height_m; level += 50) {
        const r = m.radius_m * Math.sqrt(Math.log(m.height_m / level));
        for (let i = 0; i < 64; i++) {
          for (const a of [(i / 64) * Math.PI * 2, ((i + 1) / 64) * Math.PI * 2]) {
            const x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r;
            verts.push(x, this.geo.elevationXY(x, y) + 2, -y);
          }
        }
      }
    }
    this.scene.add(this.terrain, wire, grid, this.lines(verts, BP.edgeDim, { opacity: 0.6 }));
  }

  // --- flat polygons ----------------------------------------------------------------------
  outline(polygon, color, lift, opacity) {
    const pts = polygon.map(([lat, lng]) => this.pos(lat, lng, lift));
    pts.push(pts[0].clone());
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: opacity !== undefined, opacity: opacity ?? 1 }));
  }
  buildFlats() {
    for (const d of this.data.districts) this.scene.add(this.outline(d.polygon, BP.edgeDim, 1.5, 0.5));
    for (const p of this.data.parks) this.scene.add(this.outline(p.polygon, BP.park, 1.6, 0.8));
    for (const w of this.data.water) {
      const shape = new THREE.Shape(w.polygon.map(([lat, lng]) => { const p = this.geo.toXY(lat, lng); return new THREE.Vector2(p.x, p.y); }));
      const g = new THREE.ShapeGeometry(shape);
      g.rotateX(-Math.PI / 2);
      const fill = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: BP.waterFill }));
      fill.position.y = this.geo.base + 0.5;
      this.scene.add(fill, this.outline(w.polygon, BP.water, 1.7));
    }
  }

  // --- roads ------------------------------------------------------------------------------
  // Roads as bands: two kerb lines a real width apart over a faint surface
  // fill, a dashed centre line on the avenues and rings, and the bus route
  // and footpath as dashed lines on top.
  buildRoads() {
    const WIDTH = { highway: 30, arterial: 18, street: 9 };
    const kerb = { major: [], street: [] }, fill = { major: [], street: [] }, centre = [], dashed = { bus_route: [], footpath: [] };
    for (const r of this.data.roads) {
      const raw = r.path.map(([lat, lng]) => this.geo.toXY(lat, lng));
      // densify so the band follows the terrain
      const pts = [raw[0]];
      for (let i = 1; i < raw.length; i++) {
        const a = raw[i - 1], b = raw[i], len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 0.01) continue;
        const n = Math.max(1, Math.ceil(len / 60));
        for (let k = 1; k <= n; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
      }
      if (pts.length < 2) continue;
      const lift = ROAD_LIFT[r.class] || 1;
      if (r.class === 'bus_route' || r.class === 'footpath') {
        const v = dashed[r.class];
        for (let i = 0; i < pts.length - 1; i++) v.push(pts[i].x, this.geo.elevationXY(pts[i].x, pts[i].y) + lift, -pts[i].y, pts[i + 1].x, this.geo.elevationXY(pts[i + 1].x, pts[i + 1].y) + lift, -pts[i + 1].y);
        continue;
      }
      const w = WIDTH[r.class] / 2;
      const group = r.class === 'street' ? 'street' : 'major';
      // per-vertex normals (average of the adjacent segment normals)
      const nrm = pts.map((p, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
        return { x: -dy / l, y: dx / l };
      });
      const L = pts.map((p, i) => { const x = p.x + nrm[i].x * w, y = p.y + nrm[i].y * w; return [x, this.geo.elevationXY(x, y) + lift, -y]; });
      const R = pts.map((p, i) => { const x = p.x - nrm[i].x * w, y = p.y - nrm[i].y * w; return [x, this.geo.elevationXY(x, y) + lift, -y]; });
      for (let i = 0; i < pts.length - 1; i++) {
        kerb[group].push(...L[i], ...L[i + 1], ...R[i], ...R[i + 1]);
        fill[group].push(...L[i], ...R[i], ...L[i + 1], ...R[i], ...R[i + 1], ...L[i + 1]);
        if (group === 'major') centre.push(pts[i].x, this.geo.elevationXY(pts[i].x, pts[i].y) + lift + 0.2, -pts[i].y, pts[i + 1].x, this.geo.elevationXY(pts[i + 1].x, pts[i + 1].y) + lift + 0.2, -pts[i + 1].y);
      }
    }
    const surface = (verts, opacity) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x10406e, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
    };
    this.scene.add(surface(fill.major, 0.55), this.lines(kerb.major, BP.road, { opacity: 0.95 }), this.lines(centre, BP.road, { dashed: true, dash: 12, gap: 10, opacity: 0.45 }));
    this.streets = new THREE.Group();
    this.streets.add(surface(fill.street, 0.3), this.lines(kerb.street, BP.street, { opacity: 0.8 }));
    this.scene.add(this.streets);
    this.scene.add(this.lines(dashed.bus_route, BP.bus, { dashed: true }), this.lines(dashed.footpath, BP.foot, { dashed: true }));
  }

  // The road network as a graph, so the drones can be routed along streets.
  // Segments are split where they cross (and where an end lands on another
  // road), then Dijkstra finds the shortest way through the junctions.
  buildRoadGraph() {
    const segs = [];
    for (const r of this.data.roads) {
      if (r.class === 'footpath' || r.class === 'bus_route') continue;
      const pts = r.path.map(([lat, lng]) => this.geo.toXY(lat, lng));
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (Math.hypot(b.x - a.x, b.y - a.y) < 0.5) continue;
        segs.push({ a, b, cuts: [0, 1] });
      }
    }
    const CELL = 250, grid = new Map();
    const cellsOf = (s) => {
      const x0 = Math.floor(Math.min(s.a.x, s.b.x) / CELL), x1 = Math.floor(Math.max(s.a.x, s.b.x) / CELL);
      const y0 = Math.floor(Math.min(s.a.y, s.b.y) / CELL), y1 = Math.floor(Math.max(s.a.y, s.b.y) / CELL);
      const out = [];
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(x + ',' + y);
      return out;
    };
    segs.forEach((s, i) => { for (const k of cellsOf(s)) { if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); } });
    const extra = [];
    for (let i = 0; i < segs.length; i++) {
      const si = segs[i], seen = new Set();
      for (const k of cellsOf(si)) for (const j of grid.get(k)) {
        if (j <= i || seen.has(j)) continue;
        seen.add(j);
        const sj = segs[j];
        const hit = segIntersect(si.a, si.b, sj.a, sj.b);
        if (hit) { si.cuts.push(hit.t); sj.cuts.push(hit.u); continue; }
        for (const [p, s] of [[si.a, sj], [si.b, sj], [sj.a, si], [sj.b, si]]) {
          const pr = projectOnSegment(p, s.a, s.b);
          if (pr.t > 0.002 && pr.t < 0.998 && pr.d < 18) { s.cuts.push(pr.t); extra.push([p, pr.point]); }
        }
      }
    }
    const nodes = [], index = new Map();
    const nodeAt = (x, y) => {
      const key = Math.round(x / 3) + ',' + Math.round(y / 3);
      let id = index.get(key);
      if (id === undefined) { id = nodes.length; nodes.push({ x, y, adj: [] }); index.set(key, id); }
      return id;
    };
    const link = (u, v) => { if (u === v) return; const d = Math.hypot(nodes[u].x - nodes[v].x, nodes[u].y - nodes[v].y); nodes[u].adj.push([v, d]); nodes[v].adj.push([u, d]); };
    for (const s of segs) {
      const ts = [...new Set(s.cuts.map((t) => +t.toFixed(5)))].sort((a, b) => a - b);
      let prev = nodeAt(s.a.x + (s.b.x - s.a.x) * ts[0], s.a.y + (s.b.y - s.a.y) * ts[0]);
      for (let k = 1; k < ts.length; k++) { const id = nodeAt(s.a.x + (s.b.x - s.a.x) * ts[k], s.a.y + (s.b.y - s.a.y) * ts[k]); link(prev, id); prev = id; }
    }
    for (const [p, q] of extra) link(nodeAt(p.x, p.y), nodeAt(q.x, q.y));
    this.graph = nodes;
  }
  nearestNode(p) {
    let best = -1, bd = Infinity;
    this.graph.forEach((n, i) => { const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  route(from, to) {
    const nodes = this.graph;
    const s = this.nearestNode(from), t = this.nearestNode(to);
    const dist = new Float64Array(nodes.length).fill(Infinity), prev = new Int32Array(nodes.length).fill(-1);
    const heap = new MinHeap();
    dist[s] = 0; heap.push(0, s);
    while (heap.size) {
      const [d, u] = heap.pop();
      if (d > dist[u]) continue;
      if (u === t) break;
      for (const [v, w] of nodes[u].adj) { const nd = d + w; if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heap.push(nd, v); } }
    }
    if (dist[t] === Infinity) return null;
    const path = [];
    for (let u = t; u !== -1; u = prev[u]) path.push({ x: nodes[u].x, y: nodes[u].y });
    return path.reverse();
  }

  // --- buildings --------------------------------------------------------------------------
  boxEdges(b, out, center) {
    const p = center || this.pos(b.lat, b.lng);
    const ang = (-b.rotation_deg * Math.PI) / 180, cs = Math.cos(ang), sn = Math.sin(ang), hw = b.width_m / 2, hd = b.depth_m / 2;
    const corner = (sx, sz, y) => [p.x + (sx * hw) * cs + (sz * hd) * sn, p.y + y, p.z - (sx * hw) * sn + (sz * hd) * cs];
    const k = [corner(-1, -1, 0), corner(1, -1, 0), corner(1, 1, 0), corner(-1, 1, 0), corner(-1, -1, b.height_m), corner(1, -1, b.height_m), corner(1, 1, b.height_m), corner(-1, 1, b.height_m)];
    for (const [a, c] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) out.push(...k[a], ...k[c]);
  }
  // Buildings come in two shapes: small residential ones are houses with a
  // pitched roof, everything else a block. Both get a procedural facade from
  // the shader: floor slabs, windows (lit at random), a door, roof hatching.
  facadeMaterial() {
    const mat = new THREE.MeshBasicMaterial({ color: BP.fill, transparent: true, opacity: 0.88, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aKind; attribute float aSeed;\nvarying vec3 vLocal; varying vec3 vNrm; varying vec3 vSize; varying float vKind; varying float vSeed;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));\nvLocal = position * vSize; vNrm = normal; vKind = aKind; vSeed = aSeed;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLocal; varying vec3 vNrm; varying vec3 vSize; varying float vKind; varying float vSeed;')
        .replace('#include <opaque_fragment>', `
vec3 col = outgoingLight; float alpha = diffuseColor.a;
const vec3 LIT = vec3(0.56, 0.86, 1.0); const vec3 SLAB = vec3(0.25, 0.5, 0.75); const vec3 DOOR = vec3(0.95, 0.72, 0.33);
bool office = vKind == 2.0 || vKind == 3.0; bool industrial = vKind == 4.0; bool civic = vKind == 5.0;
if (abs(vNrm.y) < 0.45) {
  float h = (abs(vNrm.x) > 0.5) ? vLocal.z : vLocal.x;
  float extent = (abs(vNrm.x) > 0.5) ? vSize.z : vSize.x;
  float v = vLocal.y;
  float floorH = civic ? 4.2 : 3.2;
  float colW = office ? 3.0 : (industrial ? 9.0 : (civic ? 5.0 : 4.4));
  float wx = office ? 0.82 : (industrial ? 0.5 : (civic ? 0.4 : 0.42));
  float wy = office ? 0.72 : (civic ? 0.7 : 0.5);
  float fx = fract(h / colW + 0.5), fy = fract(v / floorH);
  float floorN = floor(v / floorH);
  bool margin = abs(h) > extent * 0.5 - 1.2;
  bool win = !margin && fx > 0.5 - wx * 0.5 && fx < 0.5 + wx * 0.5 && fy > 0.28 && fy < 0.28 + wy;
  bool ground = v < floorH;
  bool door = ground && vNrm.z > 0.5 && abs(h) < 0.95 && v < 2.3;
  float r = fract(sin(dot(vec2(floor(h / colW + 0.5), floorN) + vSeed, vec2(12.9898, 78.233))) * 43758.5453);
  if (win && (!ground || office || vKind == 1.0)) { col = mix(col, LIT, r > 0.4 ? 0.9 : 0.3); alpha = max(alpha, 0.92); }
  if (door) { col = mix(col, DOOR, 0.85); alpha = 1.0; }
  if (fy < 0.035 && v > 0.6 && !industrial) col = mix(col, SLAB, 0.55);
  if (industrial && ground && !margin && fract(h / 14.0) < 0.5 && v < 4.5) col = mix(col, SLAB, 0.35);
} else {
  float hh = fract((vLocal.x + vLocal.z) / 5.0);
  if (hh < 0.09) col = mix(col, SLAB, 0.45);
  if (vNrm.y < 0.95 && fract(vLocal.x / 2.2) < 0.08) col = mix(col, SLAB, 0.35);
}
outgoingLight = col; diffuseColor.a = alpha;
#include <opaque_fragment>`);
    };
    return mat;
  }
  // unit house: a body up to y=0.62 and a gabled roof to y=1, ridge along x
  houseGeometry() {
    const v = [], n = [];
    const quad = (a, b, c, d, nrm) => { v.push(...a, ...b, ...c, ...a, ...c, ...d); for (let i = 0; i < 6; i++) n.push(...nrm); };
    const tri = (a, b, c, nrm) => { v.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) n.push(...nrm); };
    const e = 0.62;
    quad([-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, e, 0.5], [-0.5, e, 0.5], [0, 0, 1]);
    quad([0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, e, -0.5], [0.5, e, -0.5], [0, 0, -1]);
    quad([0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, e, -0.5], [0.5, e, 0.5], [1, 0, 0]);
    quad([-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, e, 0.5], [-0.5, e, -0.5], [-1, 0, 0]);
    const s = Math.hypot(0.5, 1 - e), ny = 0.5 / s, nz = (1 - e) / s;
    quad([-0.5, e, 0.5], [0.5, e, 0.5], [0.5, 1, 0], [-0.5, 1, 0], [0, ny, nz]);
    quad([0.5, e, -0.5], [-0.5, e, -0.5], [-0.5, 1, 0], [0.5, 1, 0], [0, ny, -nz]);
    tri([0.5, e, 0.5], [0.5, e, -0.5], [0.5, 1, 0], [1, 0, 0]);
    tri([-0.5, e, -0.5], [-0.5, e, 0.5], [-0.5, 1, 0], [-1, 0, 0]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    return g;
  }
  houseEdges(b, out, p) {
    const ang = (-b.rotation_deg * Math.PI) / 180, cs = Math.cos(ang), sn = Math.sin(ang), hw = b.width_m / 2, hd = b.depth_m / 2, e = b.height_m * 0.62;
    const at = (sx, sz, y) => [p.x + (sx * hw) * cs + (sz * hd) * sn, p.y + y, p.z - (sx * hw) * sn + (sz * hd) * cs];
    const k = [at(-1, -1, 0), at(1, -1, 0), at(1, 1, 0), at(-1, 1, 0), at(-1, -1, e), at(1, -1, e), at(1, 1, e), at(-1, 1, e), at(-1, 0, b.height_m), at(1, 0, b.height_m)];
    for (const [a, c] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7], [8, 9], [4, 8], [7, 8], [5, 9], [6, 9]]) out.push(...k[a], ...k[c]);
  }
  buildBuildings() {
    const KIND = { residential: 0, commercial: 1, office: 2, tech: 3, industrial: 4, civic: 5, hospital: 5, station: 5, police: 2, utility: 4 };
    const list = this.data.buildings;
    const isHouse = (b) => b.kind === 'residential' && b.height_m <= 12 && Math.max(b.width_m, b.depth_m) <= 24;
    const isSpecial = (b) => SPECIAL.has(b.kind);
    const houses = list.filter((b) => !isSpecial(b) && isHouse(b)), blocks = list.filter((b) => !isSpecial(b) && !isHouse(b));
    this.buildSpecial(list.filter(isSpecial));
    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
    const make = (geom, items) => {
      const mesh = new THREE.InstancedMesh(geom, this.facadeMaterial(), items.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      const kinds = new Float32Array(items.length), seeds = new Float32Array(items.length);
      items.forEach((b, i) => {
        const p = this.pos(b.lat, b.lng);
        q.setFromAxisAngle(UP, (-b.rotation_deg * Math.PI) / 180);
        s.set(b.width_m, b.height_m, b.depth_m);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
        kinds[i] = KIND[b.kind] ?? 1; seeds[i] = (b.id * 0.618) % 1;
      });
      geom.setAttribute('aKind', new THREE.InstancedBufferAttribute(kinds, 1));
      geom.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
      mesh.userData.items = items;
      return mesh;
    };
    this.buildings = make(box, blocks);
    this.houses = make(this.houseGeometry(), houses);
    const edges = [], hedges = [];
    for (const b of blocks) this.boxEdges(b, edges, this.pos(b.lat, b.lng));
    for (const b of houses) this.houseEdges(b, hedges, this.pos(b.lat, b.lng));
    this.scene.add(this.buildings, this.houses, this.lines(edges, BP.edge, { opacity: 0.9 }), this.lines(hedges, BP.edge, { opacity: 0.85 }));
    for (const b of list) if (b.name && b.district === 'kettle-foot') this.addLabel(b.lat, b.lng, b.name, 'place', b.height_m + 14);
  }

  // --- civic landmarks with their own shapes: school, church, theatre, stadium, temple,
  // university, market hall, fire station, library. Edge-drawn, with a hidden pick box.
  buildSpecial(items) {
    const E = [], W = [];
    for (const b of items) {
      const p = this.pos(b.lat, b.lng);
      const ang = (-b.rotation_deg * Math.PI) / 180, cs = Math.cos(ang), sn = Math.sin(ang);
      const w = b.width_m, d = b.depth_m, h = b.height_m, hw = w / 2, hd = d / 2;
      const T = (x, y, z) => [p.x + x * cs + z * sn, p.y + y, p.z - x * sn + z * cs];
      const seg = (arr, a, c) => arr.push(...T(...a), ...T(...c));
      const chain = (arr, pts) => { for (let i = 0; i < pts.length - 1; i++) seg(arr, pts[i], pts[i + 1]); };
      const box = (arr, x0, x1, y0, y1, z0, z1) => { const k = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]; for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) seg(arr, k[i], k[j]); };
      const rect = (arr, x0, x1, y, z0, z1) => chain(arr, [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [x0, y, z0]]);
      const ellipse = (arr, cx, cz, rx, rz, y, n = 36) => chain(arr, Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * rx, y, cz + Math.sin((i / n) * Math.PI * 2) * rz]));
      const arch = (arr, x, z, y0, r, along) => chain(arr, Array.from({ length: 9 }, (_, i) => { const a = Math.PI * (1 - i / 8); return along === 'x' ? [x + Math.cos(a) * r, y0 + Math.sin(a) * r, z] : [x, y0 + Math.sin(a) * r, z + Math.cos(a) * r]; }));
      const gable = (arr, x0, x1, y0, y1, z0, z1, ridge) => { box(arr, x0, x1, y0, y1, z0, z1); const zm = (z0 + z1) / 2; seg(arr, [x0, ridge, zm], [x1, ridge, zm]); for (const x of [x0, x1]) { seg(arr, [x, y1, z0], [x, ridge, zm]); seg(arr, [x, y1, z1], [x, ridge, zm]); } };
      const windows = (arr, x0, x1, z, floors, floorH, step = 4) => { for (let f = 0; f < floors; f++) for (let x = x0 + 2; x < x1 - 2; x += step) chain(arr, [[x, f * floorH + 1.0, z], [x + 1.8, f * floorH + 1.0, z], [x + 1.8, f * floorH + 2.6, z], [x, f * floorH + 2.6, z], [x, f * floorH + 1.0, z]]); };
      if (b.kind === 'school') {
        box(E, -hw, hw, 0, h, -hd, -hd + d * 0.4); box(E, -hw, -hw + w * 0.25, 0, h * 0.8, -hd + d * 0.4, hd); box(E, hw - w * 0.25, hw, 0, h * 0.8, -hd + d * 0.4, hd);
        windows(W, -hw, hw, -hd, b.floors, h / b.floors); windows(W, -hw, hw, -hd + d * 0.4, b.floors, h / b.floors);
        rect(E, -hw + w * 0.25, hw - w * 0.25, 0.4, -hd + d * 0.4, hd); seg(E, [0, 0, hd - 3], [0, 12, hd - 3]); seg(E, [0, 12, hd - 3], [3, 11, hd - 3]); seg(E, [3, 11, hd - 3], [0, 10, hd - 3]);
        rect(E, -hw * 0.6, hw * 0.6, 0.3, hd + 6, hd + 26); ellipse(E, 0, hd + 16, 4, 4, 0.3, 16);
      } else if (b.kind === 'church') {
        const tx = -hw + w * 0.22;
        gable(E, tx, hw, 0, h * 0.6, -hd, hd, h);
        box(E, -hw, tx, 0, h * 1.6, -hd * 0.7, hd * 0.7);
        const tc = (-hw + tx) / 2, sp = h * 2.4;
        for (const [x, z] of [[-hw, -hd * 0.7], [tx, -hd * 0.7], [tx, hd * 0.7], [-hw, hd * 0.7]]) seg(E, [x, h * 1.6, z], [tc, sp, 0]);
        seg(E, [tc, sp, 0], [tc, sp + 3.5, 0]); seg(E, [tc - 1.2, sp + 2.5, 0], [tc + 1.2, sp + 2.5, 0]);
        for (let x = tx + 4; x < hw - 2; x += 5) for (const z of [-hd, hd]) { seg(W, [x - 1, 2.5, z], [x - 1, 5.5, z]); seg(W, [x + 1, 2.5, z], [x + 1, 5.5, z]); arch(W, x, z, 5.5, 1, 'x'); }
        arch(W, hw, 0, 0, 2.2, 'z'); seg(W, [hw, 0, -2.2], [hw, 0, 2.2]);
      } else if (b.kind === 'theatre') {
        const cz = -hd + d * 0.42;
        for (const y of [0, h * 0.5, h]) ellipse(E, 0, cz, hw, d * 0.42, y, 28);
        for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; seg(E, [Math.cos(a) * hw, 0, cz + Math.sin(a) * d * 0.42], [Math.cos(a) * hw, h, cz + Math.sin(a) * d * 0.42]); }
        box(E, -w * 0.32, w * 0.32, 0, h * 1.45, cz + d * 0.3, hd);
        box(E, -hw * 0.9, hw * 0.9, 4, 5.6, -hd - 5, -hd + 1); for (let x = -hw * 0.9; x <= hw * 0.9; x += 3) seg(W, [x, 4, -hd - 5], [x, 5.6, -hd - 5]);
        seg(E, [-hw * 0.9, 4, -hd - 5], [-hw * 0.9, 0, -hd - 5]); seg(E, [hw * 0.9, 4, -hd - 5], [hw * 0.9, 0, -hd - 5]);
      } else if (b.kind === 'stadium') {
        ellipse(E, 0, 0, hw, hd, 0.5, 48);
        for (let k = 0; k < 3; k++) { const f = 0.62 + 0.13 * k; ellipse(E, 0, 0, hw * f, hd * f, h * (0.2 + 0.28 * k), 48); }
        for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; chain(E, [[Math.cos(a) * hw * 0.62, h * 0.2, Math.sin(a) * hd * 0.62], [Math.cos(a) * hw * 0.75, h * 0.48, Math.sin(a) * hd * 0.75], [Math.cos(a) * hw * 0.88, h * 0.76, Math.sin(a) * hd * 0.88], [Math.cos(a) * hw, 0.5, Math.sin(a) * hd]]); }
        rect(W, -hw * 0.5, hw * 0.5, 0.6, -hd * 0.36, hd * 0.36); seg(W, [0, 0.6, -hd * 0.36], [0, 0.6, hd * 0.36]); ellipse(W, 0, 0, 9, 9, 0.6, 20);
        for (const [x, z] of [[-hw * 0.7, -hd * 0.7], [hw * 0.7, -hd * 0.7], [hw * 0.7, hd * 0.7], [-hw * 0.7, hd * 0.7]]) { seg(E, [x, 0, z], [x, h * 1.6, z]); box(W, x - 3, x + 3, h * 1.6, h * 1.6 + 2.5, z - 1, z + 1); }
      } else if (b.kind === 'temple') {
        for (let k = 0; k < 4; k++) { const f = 1 - 0.22 * k; box(E, -hw * f, hw * f, (h * k) / 4, (h * (k + 1)) / 4, -hd * f, hd * f); }
        seg(E, [0, h, 0], [0, h + 5, 0]); box(W, -1, 1, h + 5, h + 6.5, -1, 1);
        rect(W, -hw * 1.3, hw * 1.3, 0.3, -hd * 1.3, hd * 1.3); arch(W, 0, -hd, 0, 3, 'x'); seg(W, [-3, 0, -hd], [-3, 3, -hd]); seg(W, [3, 0, -hd], [3, 3, -hd]);
      } else if (b.kind === 'university') {
        box(E, -hw, hw, 0, h, -hd, -hd + d * 0.3); box(E, hw - w * 0.25, hw, 0, h * 0.9, -hd + d * 0.3, hd); box(E, -hw, -hw + w * 0.25, 0, h * 0.9, -hd + d * 0.3, hd);
        windows(W, -hw, hw, -hd, b.floors, h / b.floors, 5);
        const tx = -hw + w * 0.12, tz = -hd + d * 0.15;
        box(E, tx - 5, tx + 5, 0, h * 1.9, tz - 5, tz + 5); for (const [x, z] of [[tx - 5, tz - 5], [tx + 5, tz - 5], [tx + 5, tz + 5], [tx - 5, tz + 5]]) seg(E, [x, h * 1.9, z], [tx, h * 2.2, tz]);
        ellipse(W, tx, tz - 5.05, 2.5, 0.01, h * 1.7, 16); ellipse(W, tx + 5.05, tz, 0.01, 2.5, h * 1.7, 16);
        seg(W, [-hw + w * 0.25, 0.4, hd * 0.2], [hw - w * 0.25, 0.4, hd * 0.2]); seg(W, [0, 0.4, -hd + d * 0.3], [0, 0.4, hd]);
      } else if (b.kind === 'market') {
        box(E, -hw, hw, 0, h * 0.6, -hd, hd);
        for (let x = -hw; x <= hw + 0.01; x += 6) chain(E, Array.from({ length: 9 }, (_, i) => { const a = Math.PI * (1 - i / 8); return [x, h * 0.6 + Math.sin(a) * h * 0.4, Math.cos(a) * hd]; }));
        seg(E, [-hw, h, 0], [hw, h, 0]);
        for (const x of [-hw, hw]) { arch(W, x, 0, 0, 3.5, 'z'); }
        for (let x = -hw + 5; x < hw - 4; x += 8) for (const z of [-hd, hd]) chain(W, [[x, 1, z], [x + 3, 1, z], [x + 3, 4, z], [x, 4, z], [x, 1, z]]);
      } else if (b.kind === 'fire_station') {
        box(E, -hw, hw, 0, h, -hd, hd);
        for (const x of [-hw + w * 0.2, 0, hw - w * 0.2]) chain(W, [[x - 3, 0, -hd], [x - 3, 5, -hd], [x + 3, 5, -hd], [x + 3, 0, -hd]]);
        box(E, hw - 6, hw, h, h * 2.2, hd - 6, hd); seg(E, [hw - 3, h * 2.2, hd - 3], [hw - 3, h * 2.2 + 4, hd - 3]);
      } else if (b.kind === 'vet') {
        box(E, -hw, hw, 0, h, -hd, hd); windows(W, -hw, hw, -hd, b.floors, h / b.floors, 4.5);
        chain(W, [[-3, 0, -hd], [-3, 2.6, -hd], [3, 2.6, -hd], [3, 0, -hd]]);
        const sx = hw - 3, sz = -hd - 4; seg(E, [sx, 0, sz], [sx, 9, sz]); seg(W, [sx - 2, 10, sz], [sx + 2, 10, sz]); seg(W, [sx, 8, sz], [sx, 12, sz]); box(W, sx - 2.6, sx + 2.6, 7.4, 12.6, sz - 0.2, sz + 0.2);
        for (let x = -hw + 4; x < hw - 4; x += 6) box(E, x, x + 4, 0, 2.4, hd + 4, hd + 7);
        rect(E, -hw * 0.6, hw * 0.6, 0.3, hd + 9, hd + 26); for (let x = -hw * 0.6; x <= hw * 0.6; x += 4) seg(E, [x, 0, hd + 9], [x, 1.1, hd + 9]);
      } else if (b.kind === 'auditorium') {
        const sz = -hd + d * 0.22;
        box(E, -w * 0.28, w * 0.28, 0, h * 0.95, -hd, sz);
        const fan = (r, y, a0 = -1.05, a1 = 1.05, n = 24) => chain(E, Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [Math.sin(a) * r, y, sz + Math.cos(a) * r]; }));
        for (let r = d * 0.2; r < d * 0.74; r += d * 0.09) chain(W, Array.from({ length: 21 }, (_, i) => { const a = -1.0 + (2.0 * i) / 20; return [Math.sin(a) * r, 0.6 + (r - d * 0.2) * 0.12, sz + Math.cos(a) * r]; }));
        fan(d * 0.78, 0); fan(d * 0.78, h * 0.72);
        for (let i = 0; i <= 8; i++) { const a = -1.05 + (2.1 * i) / 8; seg(E, [Math.sin(a) * d * 0.78, 0, sz + Math.cos(a) * d * 0.78], [Math.sin(a) * d * 0.78, h * 0.72, sz + Math.cos(a) * d * 0.78]); seg(E, [Math.sin(a) * d * 0.78, h * 0.72, sz + Math.cos(a) * d * 0.78], [Math.sin(a) * w * 0.28 * 0.95, h * 0.95, sz]); }
        seg(E, [-w * 0.28, 0, -hd], [-w * 0.28, 0, sz]); chain(W, [[-4, 0, sz + d * 0.78], [-4, 3, sz + d * 0.78], [4, 3, sz + d * 0.78], [4, 0, sz + d * 0.78]]);
      } else if (b.kind === 'library') {
        box(E, -hw, hw, 0, h, -hd, hd);
        for (let x = -hw + 3; x <= hw - 3 + 0.01; x += 4.5) seg(E, [x, 1.2, -hd - 3], [x, h * 0.8, -hd - 3]);
        chain(E, [[-hw, h * 0.8, -hd - 3], [hw, h * 0.8, -hd - 3], [0, h * 0.8 + 6, -hd - 3], [-hw, h * 0.8, -hd - 3]]); seg(E, [-hw, h * 0.8, -hd - 3], [-hw, h * 0.8, -hd]); seg(E, [hw, h * 0.8, -hd - 3], [hw, h * 0.8, -hd]);
        for (const y of [0.4, 0.8, 1.2]) seg(E, [-hw, y, -hd - 3 - (1.2 - y) * 4], [hw, y, -hd - 3 - (1.2 - y) * 4]);
        windows(W, -hw, hw, hd, b.floors, h / b.floors, 5);
      }
      const pick = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
      pick.position.set(p.x, p.y + h / 2, p.z); pick.rotation.y = ang;
      pick.userData.feature = { type: 'building', ...b };
      this.pickables.push(pick); this.scene.add(pick);
    }
    this.scene.add(this.lines(E, BP.edge, { opacity: 0.95 }), this.lines(W, 0x6fb6e4, { opacity: 0.7 }));
  }

  // --- trees: instanced wire canopies on thin trunks ------------------------------------------
  buildTrees() {
    this.propsGroup = new THREE.Group();
    this.showProps = true;
    const trees = this.data.trees || [];
    const broad = trees.filter((t) => t.kind === 'broadleaf'), coni = trees.filter((t) => t.kind === 'conifer'), bush = trees.filter((t) => t.kind === 'bush');
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const inst = (geom, color, items, place, opacity = 0.6) => {
      const mesh = new THREE.InstancedMesh(geom, new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity }), items.length);
      items.forEach((t, i) => { place(t, p, s, q); m.compose(p, q, s); mesh.setMatrixAt(i, m); });
      this.propsGroup.add(mesh);
      return mesh;
    };
    const ground = (t) => this.pos(t.lat, t.lng);
    inst(new THREE.IcosahedronGeometry(1, 0), 0x33c39a, broad, (t, p, s, q) => { const g = ground(t); const r = t.height_m * 0.32; p.set(g.x, g.y + t.height_m * 0.64, g.z); s.set(r, r * 0.85, r); q.setFromAxisAngle(UP, (t.lat * 1000) % 6.28); }, 0.55);
    inst(new THREE.ConeGeometry(1, 1, 4), 0x2a9d7a, coni, (t, p, s, q) => { const g = ground(t); const h = t.height_m * 0.78; p.set(g.x, g.y + t.height_m * 0.22 + h / 2, g.z); s.set(t.height_m * 0.2, h, t.height_m * 0.2); q.identity(); }, 0.6);
    inst(new THREE.TetrahedronGeometry(1, 0), 0x2e8f74, bush, (t, p, s, q) => { const g = ground(t); const r = t.height_m * 0.55; p.set(g.x, g.y + t.height_m * 0.45, g.z); s.set(r * 1.2, r * 0.8, r); q.setFromAxisAngle(UP, (t.lng * 1000) % 6.28); }, 0.5);
    inst(new THREE.CylinderGeometry(0.14, 0.18, 1, 3), 0x2a7a6a, trees.filter((t) => t.kind !== 'bush'), (t, p, s, q) => { const g = ground(t); const h = t.height_m * (t.kind === 'broadleaf' ? 0.5 : 0.25); p.set(g.x, g.y + h / 2, g.z); s.set(1, h, 1); q.identity(); }, 0.6);
    this.scene.add(this.propsGroup);
  }

  // --- props: lamps, parked cars, boats, cranes, the fountain, bus shelters -------------------
  buildProps() {
    const steel = [], amber = [], boats = [], lampHeads = [];
    const R = (deg) => (-deg * Math.PI) / 180;
    for (const pr of this.data.props || []) {
      const c = this.pos(pr.lat, pr.lng);
      const a = R(pr.rotation_deg), cs = Math.cos(a), sn = Math.sin(a);
      // local x forward (rotation), z right, y up
      const at = (x, y, z) => [c.x + x * cs + z * sn, c.y + y, c.z - x * sn + z * cs];
      const seg = (arr, p, q) => arr.push(...at(...p), ...at(...q));
      const chain = (arr, pts) => { for (let i = 0; i < pts.length - 1; i++) seg(arr, pts[i], pts[i + 1]); };
      const boxE = (arr, x0, x1, y0, y1, z0, z1) => { const k = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]; for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) seg(arr, k[i], k[j]); };
      if (pr.kind === 'lamp') {
        seg(steel, [0, 0, 0], [0, 7.5, 0]); seg(steel, [0, 7.5, 0], [2.4, 8.2, 0]); boxE(steel, 2.0, 2.9, 7.9, 8.4, -0.3, 0.3);
        lampHeads.push(at(2.45, 8.0, 0));
      } else if (pr.kind === 'car') {
        boxE(steel, -2.2, 2.2, 0.4, 1.35, -0.9, 0.9); boxE(steel, -1.1, 1.2, 1.35, 2.0, -0.8, 0.8);
        seg(steel, [-2.2, 1.35, -0.9], [-1.1, 2.0, -0.8]); seg(steel, [-2.2, 1.35, 0.9], [-1.1, 2.0, 0.8]); seg(steel, [2.2, 1.35, -0.9], [1.2, 2.0, -0.8]); seg(steel, [2.2, 1.35, 0.9], [1.2, 2.0, 0.8]);
        for (const [x, z] of [[-1.4, -0.95], [1.4, -0.95], [-1.4, 0.95], [1.4, 0.95]]) chain(steel, Array.from({ length: 9 }, (_, i) => [x + Math.cos((i / 8) * Math.PI * 2) * 0.35, 0.4 + Math.sin((i / 8) * Math.PI * 2) * 0.35, z]));
      } else if (pr.kind === 'boat') {
        chain(boats, [[-2.4, 0.4, -0.9], [1.6, 0.4, -0.9], [3.0, 0.4, 0], [1.6, 0.4, 0.9], [-2.4, 0.4, 0.9], [-2.4, 0.4, -0.9]]);
        chain(boats, [[-2.4, 1.0, -0.8], [1.6, 1.0, -0.8], [3.0, 1.0, 0], [1.6, 1.0, 0.8], [-2.4, 1.0, 0.8], [-2.4, 1.0, -0.8]]);
        seg(boats, [0.3, 1.0, 0], [0.3, 5.5, 0]); seg(boats, [0.3, 5.5, 0], [-1.8, 1.2, 0]); seg(boats, [0.3, 5.5, 0], [2.4, 1.2, 0]);
      } else if (pr.kind === 'crane') {
        for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [1.2, 1.2], [-1.2, 1.2]]) seg(steel, [x, 0, z], [x, 42, z]);
        for (let y = 4; y <= 42; y += 4) chain(steel, [[-1.2, y, -1.2], [1.2, y, -1.2], [1.2, y, 1.2], [-1.2, y, 1.2], [-1.2, y, -1.2]]);
        seg(steel, [-10, 42, 0], [34, 42, 0]); seg(steel, [-10, 40.5, 0], [34, 40.5, 0]); for (let x = -10; x <= 34; x += 3) seg(steel, [x, 40.5, 0], [x + 1.5, 42, 0]);
        seg(steel, [0, 42, 0], [0, 48, 0]); seg(steel, [0, 48, 0], [34, 42, 0]); seg(steel, [0, 48, 0], [-10, 42, 0]);
        seg(steel, [22, 40.5, 0], [22, 26, 0]); boxE(steel, 21, 23, 24, 26, -1, 1); boxE(steel, -10, -5, 39, 42, -1.5, 1.5);
      } else if (pr.kind === 'fountain') {
        for (const r of [7, 13, 20]) chain(steel, Array.from({ length: 41 }, (_, i) => [Math.cos((i / 40) * Math.PI * 2) * r, r === 20 ? 0.8 : 1.6, Math.sin((i / 40) * Math.PI * 2) * r]));
        seg(steel, [0, 0, 0], [0, 5, 0]);
        for (let i = 0; i < 12; i++) { const a2 = (i / 12) * Math.PI * 2; chain(boats, [[0, 5, 0], [Math.cos(a2) * 3, 7, Math.sin(a2) * 3], [Math.cos(a2) * 6, 4.5, Math.sin(a2) * 6], [Math.cos(a2) * 7, 1.6, Math.sin(a2) * 7]]); }
      } else if (pr.kind === 'turbine') {
        seg(steel, [0, 0, 0], [0, 40, 0]); seg(steel, [-2, 0, -2], [2, 0, 2]); seg(steel, [-2, 0, 2], [2, 0, -2]);
        boxE(steel, -1.5, 3.5, 38.5, 41.5, -1.2, 1.2);
        const hub = new THREE.Group(); hub.position.copy(new THREE.Vector3(...at(3.6, 40, 0)));
        const blades = []; for (let k = 0; k < 3; k++) { const a2 = (k / 3) * Math.PI * 2; blades.push(0, 0, 0, 0, Math.cos(a2) * 18, Math.sin(a2) * 18, 0, Math.cos(a2) * 18, Math.sin(a2) * 18, 0.8, Math.cos(a2 + 0.06) * 12, Math.sin(a2 + 0.06) * 12, 0.8, Math.cos(a2 + 0.06) * 12, Math.sin(a2 + 0.06) * 12, 0, 0, 0); }
        const bl = this.lines(blades, 0xffffff, { opacity: 0.9 }); hub.add(bl); hub.rotation.y = a; hub.userData.spin = 0.5 + (Math.abs(pr.lat * 1000) % 1) * 0.4;
        (this.turbines = this.turbines || []).push(hub); this.propsGroup.add(hub);
      } else if (pr.kind === 'solar') {
        for (let r = 0; r < 3; r++) { const z0 = -9 + r * 7; chain(steel, [[-14, 1, z0], [14, 1, z0], [14, 3.2, z0 + 4], [-14, 3.2, z0 + 4], [-14, 1, z0]]); for (let x = -10; x <= 10; x += 4) seg(steel, [x, 1, z0], [x, 3.2, z0 + 4]); seg(steel, [-14, 0, z0 + 2], [-14, 2.1, z0 + 2]); seg(steel, [14, 0, z0 + 2], [14, 2.1, z0 + 2]); }
      } else if (pr.kind === 'lookout') {
        for (const [x, z] of [[-3, -3], [3, -3], [3, 3], [-3, 3]]) seg(steel, [x * 1.3, 0, z * 1.3], [x, 18, z]);
        for (let y = 6; y <= 18; y += 6) chain(steel, [[-3.3, y, -3.3], [3.3, y, -3.3], [3.3, y, 3.3], [-3.3, y, 3.3], [-3.3, y, -3.3]]);
        boxE(steel, -5, 5, 18, 19, -5, 5); chain(steel, [[-5, 20.2, -5], [5, 20.2, -5], [5, 20.2, 5], [-5, 20.2, 5], [-5, 20.2, -5]]); for (const [x, z] of [[-5, -5], [5, -5], [5, 5], [-5, 5]]) seg(steel, [x, 19, z], [x, 20.2, z]);
        for (const [x, z] of [[-5, -5], [5, -5], [5, 5], [-5, 5]]) seg(steel, [x, 19, z], [0, 24, 0]);
      } else if (pr.kind === 'shelter') {
        boxE(steel, -2.2, 2.2, 2.6, 2.9, -1.2, 1.2); seg(steel, [-2.2, 0, -1.2], [-2.2, 2.6, -1.2]); seg(steel, [2.2, 0, -1.2], [2.2, 2.6, -1.2]);
        chain(steel, [[-2.2, 0.4, -1.2], [-2.2, 2.6, -1.2], [2.2, 2.6, -1.2], [2.2, 0.4, -1.2], [-2.2, 0.4, -1.2]]); seg(steel, [-1.8, 0.5, -0.6], [1.8, 0.5, -0.6]);
      }
    }
    this.propsGroup.add(this.lines(steel, 0x7fb6e0, { opacity: 0.8 }), this.lines(boats, BP.water2, { opacity: 0.85 }));
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 6, 4), new THREE.MeshBasicMaterial({ color: BP.cctv }), lampHeads.length);
    const m = new THREE.Matrix4();
    lampHeads.forEach((h, i) => { m.makeTranslation(h[0], h[1], h[2]); heads.setMatrixAt(i, m); });
    this.propsGroup.add(heads);
  }
  setProps(on) { this.showProps = on; if (on) { this.degraded = false; this.slowFrames = 0; } this.propsGroup.visible = on; }

  buildTower() {
    const b = this.data.buildings.find((x) => x.kind === 'police');
    if (!b) return;
    const feature = { type: 'landmark', ...(this.data.landmarks.find((l) => l.kind === 'police') || {}), ...b };
    const p = this.pos(b.lat, b.lng);
    this.towerBase = p.clone();
    this.towerTop = p.clone().add(new THREE.Vector3(0, b.height_m + 16, 0));
    const grp = new THREE.Group();
    const parts = [
      [new THREE.BoxGeometry(b.width_m * 1.25, 14, b.depth_m * 1.25), b.height_m + 7],
      [new THREE.CylinderGeometry(6, b.width_m * 0.42, 40, 12), b.height_m + 34],
      [new THREE.CylinderGeometry(1.2, 3, 70, 8), b.height_m + 89],
    ];
    for (const [geom, y] of parts) {
      const pick = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: BP.fill, transparent: true, opacity: 0.85 }));
      pick.position.y = y; pick.userData.feature = feature; this.pickables.push(pick);
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geom), new THREE.LineBasicMaterial({ color: BP.police }));
      edge.position.y = y;
      grp.add(pick, edge);
    }
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(7, 16, 12), new THREE.MeshBasicMaterial({ color: BP.beacon }));
    this.beacon.position.y = b.height_m + 126;
    this.beacon.userData.feature = feature; this.pickables.push(this.beacon);
    const axis = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -2, 0), new THREE.Vector3(0, b.height_m + 400, 0)]), new THREE.LineDashedMaterial({ color: BP.police, dashSize: 20, gapSize: 20, transparent: true, opacity: 0.5 }));
    axis.computeLineDistances();
    // the drone pad: a ring on the crown, off to one side of the spire
    this.pad = new THREE.Vector3(p.x + b.width_m * 0.55, p.y + b.height_m + 14.6, p.z + b.depth_m * 0.55);
    grp.add(this.beacon, axis, this.circle(new THREE.Vector3(b.width_m * 0.55, 0, b.depth_m * 0.55), 9, 24, b.height_m + 14.6, BP.police, { opacity: 0.9 }));
    grp.position.copy(p);
    this.scene.add(grp);
    this.addLabel(b.lat, b.lng, 'CITY POLICE HQ', 'police', b.height_m + 150);
  }

  // --- pylons, masts, water towers, relays, substations, power lines -----------------------
  buildTowers() {
    const power = [], cell = [], other = [];
    this.mastLights = [];
    for (const t of this.data.towers || []) {
      const p = this.pos(t.lat, t.lng);
      const h = t.height_m;
      const seg = (arr, a, b) => arr.push(p.x + a[0], p.y + a[1], p.z + a[2], p.x + b[0], p.y + b[1], p.z + b[2]);
      const chain = (arr, pts) => { for (let i = 0; i < pts.length - 1; i++) seg(arr, pts[i], pts[i + 1]); };
      if (t.kind === 'pylon') {
        const base = 5, top = 1.6, arm = 9;
        const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        for (const [sx, sz] of legs) seg(power, [sx * base, 0, sz * base], [sx * top, h, sz * top]);
        for (let y = 6; y < h; y += 8) { const w = base + (top - base) * (y / h); for (let i = 0; i < 4; i++) { const a = legs[i], b = legs[(i + 1) % 4]; seg(power, [a[0] * w, y, a[1] * w], [b[0] * w, y, b[1] * w]); } }
        for (const y of [h - 12, h - 4]) { seg(power, [-arm, y, 0], [arm, y, 0]); seg(power, [-arm, y, 0], [-arm * 0.6, y - 4, 0]); seg(power, [arm, y, 0], [arm * 0.6, y - 4, 0]); }
      } else if (t.kind === 'cell') {
        const r = 2.2;
        const tri = [0, 120, 240].map((d) => [Math.sin((d * Math.PI) / 180) * r, Math.cos((d * Math.PI) / 180) * r]);
        for (const [x, z] of tri) seg(cell, [x * 1.6, 0, z * 1.6], [x, h, z]);
        for (let y = 5; y < h; y += 5) for (let i = 0; i < 3; i++) { const a = tri[i], b = tri[(i + 1) % 3]; const w = 1 + 0.6 * (1 - y / h); seg(cell, [a[0] * w, y, a[1] * w], [b[0] * w, y, b[1] * w]); }
        for (const [x, z] of tri) { const ox = x * 2.4, oz = z * 2.4; chain(cell, [[ox - 0.8, h - 1, oz], [ox + 0.8, h - 1, oz], [ox + 0.8, h - 5, oz], [ox - 0.8, h - 5, oz], [ox - 0.8, h - 1, oz]]); seg(cell, [x, h - 3, z], [ox, h - 3, oz]); }
        const light = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 6), new THREE.MeshBasicMaterial({ color: BP.beacon }));
        light.position.set(p.x, p.y + h + 1.5, p.z); this.scene.add(light); this.mastLights.push(light);
        this.addLabel(t.lat, t.lng, t.name.toUpperCase(), 'infra', h + 12);
      } else if (t.kind === 'radio') {
        seg(cell, [0, 0, 0], [0, h, 0]);
        for (let y = 4; y < h; y += 4) { seg(cell, [-1.2, y, 0], [1.2, y, 0]); seg(cell, [0, y, -1.2], [0, y, 1.2]); }
        for (const d of [0, 120, 240]) { const gx = Math.sin((d * Math.PI) / 180) * h * 0.7, gz = Math.cos((d * Math.PI) / 180) * h * 0.7; seg(other, [0, h * 0.9, 0], [gx, 0, gz]); seg(other, [0, h * 0.5, 0], [gx * 0.6, 0, gz * 0.6]); }
        seg(cell, [-6, h - 6, 0], [6, h - 6, 0]);
        const light = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6), new THREE.MeshBasicMaterial({ color: BP.beacon }));
        light.position.set(p.x, p.y + h + 1.5, p.z); this.scene.add(light); this.mastLights.push(light);
        this.addLabel(t.lat, t.lng, t.name.toUpperCase(), 'infra', h + 12);
      } else if (t.kind === 'water') {
        const R = 6, tankH = 8, legTop = h - tankH;
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { seg(other, [sx * 4.5, 0, sz * 4.5], [sx * 3.5, legTop, sz * 3.5]); seg(other, [sx * 4.5, legTop * 0.5, sz * 4.5], [-sx * 3.5, legTop, sz * 3.5]); }
        for (const y of [legTop, h]) chain(other, Array.from({ length: 17 }, (_, i) => [Math.cos((i / 16) * Math.PI * 2) * R, y, Math.sin((i / 16) * Math.PI * 2) * R]));
        for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; seg(other, [Math.cos(a) * R, legTop, Math.sin(a) * R], [Math.cos(a) * R, h, Math.sin(a) * R]); }
        this.addLabel(t.lat, t.lng, t.name.toUpperCase(), 'infra', h + 10);
      } else if (t.kind === 'substation') {
        chain(other, [[-22, 0.5, -14], [22, 0.5, -14], [22, 0.5, 14], [-22, 0.5, 14], [-22, 0.5, -14]]);
        for (const bx of [-12, 0, 12]) chain(other, [[bx - 4, 0, -4], [bx + 4, 0, -4], [bx + 4, 0, 4], [bx - 4, 0, 4], [bx - 4, 0, -4], [bx - 4, h, -4], [bx + 4, h, -4], [bx + 4, h, 4], [bx - 4, h, 4], [bx - 4, h, -4]]);
        seg(other, [-18, 0, 10], [-18, 14, 10]); seg(other, [18, 0, 10], [18, 14, 10]); seg(other, [-18, 14, 10], [18, 14, 10]);
        this.addLabel(t.lat, t.lng, t.name.toUpperCase(), 'infra', 20);
      }
      const pick = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, h, 6), new THREE.MeshBasicMaterial({ visible: false }));
      pick.position.set(p.x, p.y + h / 2, p.z); pick.userData.feature = { type: 'tower', ...t }; this.pickables.push(pick); this.scene.add(pick);
    }
    const cond = [];
    for (const line of this.data.power_lines || []) {
      const pts = line.path.map(([lat, lng]) => this.pos(lat, lng));
      const t = (this.data.towers || []).find((x) => x.kind === 'pylon' && line.path.length && Math.abs(x.lat - line.path[0][0]) < 1e-6 && Math.abs(x.lng - line.path[0][1]) < 1e-6);
      const h = t ? t.height_m : 30;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize(), nrm = new THREE.Vector3(-dir.z, 0, dir.x);
        for (const [ox, oy] of [[-8, h - 12], [8, h - 12], [0, h - 4]]) {
          const prev = [];
          for (let k = 0; k <= 6; k++) {
            const u = k / 6, sag = -Math.sin(u * Math.PI) * 3;
            prev.push([a.x + (b.x - a.x) * u + nrm.x * ox, a.y + (b.y - a.y) * u + oy + sag, a.z + (b.z - a.z) * u + nrm.z * ox]);
          }
          for (let k = 0; k < 6; k++) cond.push(...prev[k], ...prev[k + 1]);
        }
      }
    }
    this.scene.add(this.lines(power, BP.power, { opacity: 0.85 }), this.lines(cond, BP.power, { opacity: 0.5 }), this.lines(cell, BP.cell, { opacity: 0.9 }), this.lines(other, BP.water2, { opacity: 0.85 }));
  }

  // --- markers + labels ---------------------------------------------------------------------
  marker(lat, lng, color, feature, height = 70, radius = 14) {
    const grp = new THREE.Group();
    const pole = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, height, 0)]), new THREE.LineBasicMaterial({ color }));
    const head = new THREE.Mesh(new THREE.SphereGeometry(radius, 14, 10), new THREE.MeshBasicMaterial({ color, wireframe: true }));
    head.position.y = height;
    const core = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.45, 10, 8), new THREE.MeshBasicMaterial({ color }));
    core.position.y = height;
    grp.add(pole, head, core);
    grp.position.copy(this.pos(lat, lng));
    head.userData.feature = feature; core.userData.feature = feature;
    this.pickables.push(head, core);
    this.scene.add(grp);
    return grp;
  }
  addLabel(lat, lng, text, cls, lift = 0) {
    const el = document.createElement('div');
    el.className = `lbl ${cls}`;
    el.textContent = text;
    this.container.appendChild(el);
    const entry = { el, pos: this.pos(lat, lng, lift), cls };
    this.labels.push(entry);
    return entry;
  }
  buildMarkers() {
    for (const l of this.data.landmarks) {
      const f = { type: 'landmark', ...l };
      if (l.kind === 'cave') { this.buildCave(l, f); this.addLabel(l.lat, l.lng, l.name, 'cave2', 40); }
      else if (l.kind === 'bus_stop') { this.marker(l.lat, l.lng, BP.stop, f, 60, 12); this.addLabel(l.lat, l.lng, l.name, 'stop', 80); }
      else if (l.kind === 'hill') this.addLabel(l.lat, l.lng, `▲ ${l.name}`, 'peak', 40);
      else if (l.kind !== 'police') this.addLabel(l.lat, l.lng, l.name, 'place', 60);
    }
    const ranges = {};
    for (const m of this.data.mountains) (ranges[m.range_name] = ranges[m.range_name] || []).push(m);
    for (const [name, peaks] of Object.entries(ranges)) {
      const lat = peaks.reduce((a, m) => a + m.lat, 0) / peaks.length, lng = peaks.reduce((a, m) => a + m.lng, 0) / peaks.length;
      this.addLabel(lat, lng, name.toUpperCase(), 'range', 520);
    }
  }

  // A cave drawn the way a survey would: an arched mouth cut into the slope,
  // ribs receding into the rock as hidden (dashed, x-ray) lines, a dark
  // opening, rubble. All three caves look the same -- the model does not know
  // which one matters.
  buildCave(l, feature) {
    const mouth = this.geo.toXY(l.lat, l.lng);
    let best = null, bd = Infinity;
    for (const m of this.data.mountains) { const c = this.geo.toXY(m.lat, m.lng); const d = Math.hypot(c.x - mouth.x, c.y - mouth.y); if (d < bd) { bd = d; best = c; } }
    const dx = (best.x - mouth.x) / bd, dy = (best.y - mouth.y) / bd;
    const nx = -dy, ny = dx;
    const e0 = this.geo.elevationXY(mouth.x, mouth.y);
    const L = 140, W = 22, H = 13;
    const seed = l.slug.length * 7;
    const jag = (i, k) => 1 + 0.12 * Math.sin(i * 2.7 + seed) * Math.cos(i * 1.3 + k);
    const rib = (t, n = 14) => {
      const cx = mouth.x + dx * t * L, cy = mouth.y + dy * t * L, floor = e0 - t * 5;
      const w = W * (1 - 0.45 * t) / 2, h = H * (1 - 0.4 * t);
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const a = Math.PI * (1 - i / n);
        const j = t === 0 ? jag(i, 0) : 1;
        const ox = Math.cos(a) * w * j, oy = Math.sin(a) * h * j;
        pts.push(new THREE.Vector3(cx + nx * ox, floor + oy, -(cy + ny * ox)));
      }
      return pts;
    };
    const grp = new THREE.Group();
    const color = BP.cave2;
    const m0 = rib(0);
    grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(m0), new THREE.LineBasicMaterial({ color })));
    const shape = new THREE.Shape(m0.map((p) => new THREE.Vector2((p.x - mouth.x) * nx + (-p.z - mouth.y) * ny, p.y - e0)));
    const opening = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0x02080f, side: THREE.DoubleSide }));
    opening.position.set(mouth.x + dx * 6, e0, -(mouth.y + dy * 6));
    opening.lookAt(mouth.x - dx * 100, e0, -(mouth.y - dy * 100));
    opening.userData.feature = feature;
    this.pickables.push(opening);
    grp.add(opening);
    const hidden = new THREE.LineDashedMaterial({ color, dashSize: 4, gapSize: 3, transparent: true, opacity: 0.85, depthTest: false });
    const ribs = [0.18, 0.4, 0.62, 0.82, 1.0].map((t) => rib(t));
    const segs = [];
    for (const r of ribs) for (let i = 0; i < r.length - 1; i++) segs.push(r[i], r[i + 1]);
    const chain = [m0, ...ribs];
    for (let k = 0; k < chain.length - 1; k++) for (const i of [0, 4, 7, 10, 14]) segs.push(chain[k][i], chain[k + 1][i]);
    const inner = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segs), hidden);
    inner.computeLineDistances(); inner.renderOrder = 5;
    grp.add(inner);
    (this.caves = this.caves || []).push({ slug: l.slug, name: l.name, x: mouth.x, z: -mouth.y, y0: e0, dx, dz: -dy, L, W, H });
    const rocks = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + seed, r = W * 0.8 + (i % 3) * 5;
      const cx = mouth.x - dx * 8 + Math.cos(a) * r, cy = mouth.y - dy * 8 + Math.sin(a) * r * 0.5;
      const z0 = this.geo.elevationXY(cx, cy) + 0.5, s = 2 + (i % 4);
      const b = [[-s, 0, -s], [s, 0, -s], [s, 0, s], [-s, 0, s], [0, s * 1.4, 0]].map(([x, y, z]) => new THREE.Vector3(cx + x, z0 + y, -(cy + z)));
      for (const [p, q] of [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 4], [2, 4], [3, 4]]) rocks.push(b[p], b[q]);
    }
    grp.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(rocks), new THREE.LineBasicMaterial({ color: BP.edgeDim })));
    this.scene.add(grp);
  }

  // --- CCTV ---------------------------------------------------------------------------------
  buildCCTV() {
    this.cctvGroup = new THREE.Group();
    this.showCCTV = true;
    const segs = [], wedges = [];
    for (const c of this.data.cctv || []) {
      const p = this.pos(c.lat, c.lng);
      const h = (c.heading_deg * Math.PI) / 180, half = (c.fov_deg * Math.PI) / 360;
      segs.push(p.x, p.y, p.z, p.x, p.y + 9, p.z);
      const head = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 4), new THREE.MeshBasicMaterial({ color: BP.cctv }));
      head.position.set(p.x, p.y + 9.5, p.z);
      head.rotation.y = -h;
      head.userData.feature = { type: 'cctv', ...c };
      this.pickables.push(head);
      this.cctvGroup.add(head);
      const c2 = this.geo.toXY(c.lat, c.lng);
      const at = (a, r) => { const x = c2.x + Math.sin(a) * r, y = c2.y + Math.cos(a) * r; return [x, this.geo.elevationXY(x, y) + 1.2, -y]; };
      const n = 10;
      for (const a of [h - half, h + half]) wedges.push(p.x, p.y + 1.2, p.z, ...at(a, c.range_m));
      for (let i = 0; i < n; i++) wedges.push(...at(h - half + (i / n) * 2 * half, c.range_m), ...at(h - half + ((i + 1) / n) * 2 * half, c.range_m));
      this.addLabel(c.lat, c.lng, c.code, 'cctv', 16);
    }
    this.cctvGroup.add(this.lines(segs, BP.cctv), this.lines(wedges, BP.cctv, { opacity: 0.55 }));
    this.scene.add(this.cctvGroup);
  }
  setCCTV(on) { this.showCCTV = on; this.cctvGroup.visible = on; }
  nearestCamera(lat, lng) {
    let best = null, bd = Infinity;
    for (const c of this.data.cctv || []) { const d = Math.hypot((c.lng - lng) * 108400, (c.lat - lat) * 110574); if (d < bd) { bd = d; best = c; } }
    return { camera: best, distance_m: Math.round(bd) };
  }

  glowTexture() {
    if (this._glow) return this._glow;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.25, 'rgba(255,255,255,0.5)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    return (this._glow = new THREE.CanvasTexture(c));
  }
  glow(position, color, scale = 140) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.position.copy(position); s.scale.set(scale, scale, 1);
    s.userData.baseScale = scale;
    return s;
  }

  // --- You ----------------------------------------------------------------------------------
  buildYou() {
    const b = this.data.buildings.find((x) => x.name === this.data.config.player_building);
    if (!b) return;
    const p = this.pos(b.lat, b.lng);
    const top = p.y + b.height_m + 45;
    const edges = [];
    this.boxEdges(b, edges, p);
    const outline = this.lines(edges, BP.you, { xray: true });
    outline.renderOrder = 6;
    const ring = this.circle(p, Math.max(b.width_m, b.depth_m) * 0.9, 48, p.y + 1.5, BP.you, { opacity: 0.8, xray: true });
    const beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(p.x, p.y + b.height_m, p.z), new THREE.Vector3(p.x, top, p.z)]), new THREE.LineBasicMaterial({ color: BP.you, transparent: true, opacity: 0.7 }));
    const dot = new THREE.Mesh(new THREE.SphereGeometry(7, 16, 12), new THREE.MeshBasicMaterial({ color: BP.you }));
    dot.position.set(p.x, top, p.z);
    const glow = this.glow(new THREE.Vector3(p.x, top, p.z), BP.you);
    const feature = { type: 'you', ...b };
    dot.userData.feature = feature; glow.userData.feature = feature;
    this.pickables.push(dot, glow);
    this.scene.add(outline, ring, beam, dot, glow);
    this.pulses.push({ glow, ring, dot, rate: 3 });
    this.addLabel(b.lat, b.lng, `● YOU · ${b.name}`, 'track', b.height_m + 75);
    const near = this.nearestCamera(b.lat, b.lng);
    if (near.distance_m > 600) {
      const r = Math.min(near.distance_m, 900);
      this.scene.add(this.groundCircle(b.lat, b.lng, r, BP.beacon));
      this.addLabel(b.lat, b.lng, `NO CCTV WITHIN ${r} M`, 'gap', 6);
    }
  }

  // --- drones -------------------------------------------------------------------------------
  droneModel() {
    const g = new THREE.Group();
    const arms = [];
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) arms.push(0, 0, 0, x * 3.2, 0, z * 3.2);
    g.add(this.lines(arms, BP.drone));
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const rotor = this.circle(new THREE.Vector3(0, 0, 0), 1.7, 10, 0, BP.drone, { opacity: 0.8 });
      rotor.position.set(x * 3.2, 0.4, z * 3.2);
      rotor.userData.rotor = true;
      g.add(rotor);
    }
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 3), new THREE.MeshBasicMaterial({ color: BP.fill }));
    g.add(body, new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), new THREE.LineBasicMaterial({ color: BP.drone })));
    // navigation lights: red port, green starboard, a white strobe underneath
    const port = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff3b30 })); port.position.set(-3.2, 0.2, 0);
    const stbd = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 4), new THREE.MeshBasicMaterial({ color: 0x39ff88 })); stbd.position.set(3.2, 0.2, 0);
    const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff })); strobe.position.set(0, -0.8, 0);
    const halo = this.glow(new THREE.Vector3(0, 0, 0), BP.drone, 6); halo.material.opacity = 0.25;
    g.add(port, stbd, strobe, halo);
    g.userData.strobe = strobe;
    g.userData.halo = halo;
    return g;
  }
  // --- live traffic: cars driving the street graph, buses shuttling route 7 ------------------
  buildTraffic() {
    this.vehicles = [];
    // edge templates in local coords: x forward, z right, y up (shared with the tracked car)
    const box = (x0, x1, y0, y1, z0, z1) => { const k = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]; return [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].flatMap(([i, j]) => [k[i], k[j]]); };
    this.vehicleTemplate = {
      car: [...box(-2.2, 2.2, 0.4, 1.35, -0.9, 0.9), ...box(-1.1, 1.2, 1.35, 2.0, -0.8, 0.8), [-2.2, 1.35, -0.9], [-1.1, 2.0, -0.8], [-2.2, 1.35, 0.9], [-1.1, 2.0, 0.8], [2.2, 1.35, -0.9], [1.2, 2.0, -0.8], [2.2, 1.35, 0.9], [1.2, 2.0, 0.8]],
      bus: [...box(-5.5, 5.5, 0.5, 3.2, -1.25, 1.25), ...[-4, -2, 0, 2, 4].flatMap((x) => [[x, 1.6, -1.25], [x, 2.9, -1.25], [x, 1.6, 1.25], [x, 2.9, 1.25]]), [-5.5, 1.6, -1.25], [5.5, 1.6, -1.25], [-5.5, 1.6, 1.25], [5.5, 1.6, 1.25]],
    };
    const nodes = this.graph;
    if (!nodes || !nodes.length) return;
    const usable = nodes.map((n, i) => i).filter((i) => nodes[i].adj.length > 0);
    for (let i = 0; i < 150; i++) {
      const u = usable[Math.floor(Math.random() * usable.length)];
      const [v] = nodes[u].adj[Math.floor(Math.random() * nodes[u].adj.length)];
      this.vehicles.push({ kind: 'car', u, v, prev: -1, t: Math.random(), speed: 9 + Math.random() * 8, ...CAR, pos: new THREE.Vector3(), dir: new THREE.Vector3(1, 0, 0) });
    }
    // buses: the route 7 polyline, back and forth
    const route = (this.data.roads || []).find((r) => r.class === 'bus_route');
    if (route) {
      const pts = route.path.map(([lat, lng]) => this.pos(lat, lng));
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
      this.busRoute = { pts, cum, length: cum[cum.length - 1] };
      for (let i = 0; i < 6; i++) this.vehicles.push({ kind: 'bus', s: (i / 6) * this.busRoute.length, way: i % 2 ? 1 : -1, speed: 8, ...BUS, pos: new THREE.Vector3(), dir: new THREE.Vector3(1, 0, 0) });
    }
    const total = this.vehicles.reduce((a, v) => a + this.vehicleTemplate[v.kind].length, 0);
    this.trafficBuf = new Float32Array(total * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.trafficBuf, 3).setUsage(THREE.DynamicDrawUsage));
    this.trafficLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.95 }));
    this.trafficLines.frustumCulled = false;
    const n = this.vehicles.length;
    this.headlights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }), n * 2);
    this.taillights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.24, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff3b30 }), n * 2);
    this.headlights.frustumCulled = false; this.taillights.frustumCulled = false;
    this.propsGroup.add(this.trafficLines, this.headlights, this.taillights);
  }
  updateTraffic(dt) {
    if (!this.vehicles || !this.vehicles.length || !this.propsGroup.visible) return;
    const nodes = this.graph;
    const step = dt * this.rate();
    const buf = this.trafficBuf;
    const m = new THREE.Matrix4(), tmp = new THREE.Vector3();
    let o = 0, li = 0;
    for (const v of this.vehicles) {
      if (v.kind === 'car') {
        const a = nodes[v.u], b = nodes[v.v];
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        v.t += (v.speed * step) / len;
        let hops = 0;
        while (v.t >= 1 && hops++ < 12) {
          v.t -= 1;
          const from = v.u; v.u = v.v;
          const options = nodes[v.u].adj.filter(([w]) => w !== from);
          const [next] = options.length ? options[Math.floor(Math.random() * options.length)] : nodes[v.u].adj[0];
          v.prev = from; v.v = next;
          const a2 = nodes[v.u], b2 = nodes[v.v];
          v.t = v.t * len / (Math.hypot(b2.x - a2.x, b2.y - a2.y) || 1);
        }
        const a3 = nodes[v.u], b3 = nodes[v.v];
        const x = a3.x + (b3.x - a3.x) * v.t, y = a3.y + (b3.y - a3.y) * v.t;
        v.dir.set(b3.x - a3.x, 0, -(b3.y - a3.y)).normalize();
        // keep left: offset to the driver's left of the centre line
        v.pos.set(x + v.dir.z * 3.0, this.ground(x, -y) + 0.6, -y - v.dir.x * 3.0);
      } else {
        const r = this.busRoute;
        v.s += v.way * v.speed * step;
        if (v.s >= r.length) { v.s = r.length; v.way = -1; } else if (v.s <= 0) { v.s = 0; v.way = 1; }
        let i = 1; while (i < r.cum.length - 1 && r.cum[i] < v.s) i++;
        const a = r.pts[i - 1], b = r.pts[i], u = (v.s - r.cum[i - 1]) / ((r.cum[i] - r.cum[i - 1]) || 1);
        tmp.lerpVectors(a, b, u);
        v.dir.subVectors(b, a); v.dir.y = 0; v.dir.normalize(); if (v.way < 0) v.dir.negate();
        v.pos.set(tmp.x + v.dir.z * 4.5, this.ground(tmp.x, tmp.z) + 0.6, tmp.z - v.dir.x * 4.5);
      }
      o = this.writeVehicle(v, this.vehicleTemplate[v.kind], buf, o);
      const cs = v.dir.x, sn = v.dir.z;   // rotation from local +x to dir, in the xz plane
      const half = v.len / 2, w = v.wid / 2 - 0.2, hy = v.kind === 'bus' ? 1.2 : 0.9;
      for (const side of [-1, 1]) {
        m.makeTranslation(v.pos.x + half * cs - side * w * sn, v.pos.y + hy, v.pos.z + half * sn + side * w * cs);
        this.headlights.setMatrixAt(li, m);
        m.makeTranslation(v.pos.x - half * cs - side * w * sn, v.pos.y + hy, v.pos.z - half * sn + side * w * cs);
        this.taillights.setMatrixAt(li, m);
        li++;
      }
    }
    this.trafficLines.geometry.attributes.position.needsUpdate = true;
    this.headlights.instanceMatrix.needsUpdate = true;
    this.taillights.instanceMatrix.needsUpdate = true;
  }
  // Write one vehicle's edge template into a line buffer at `offset`, rotated from
  // local +x to v.dir in the xz plane and placed at v.pos; returns the next offset.
  writeVehicle(v, tpl, buf, offset) {
    const cs = v.dir.x, sn = v.dir.z;
    let o = offset;
    for (const [lx, ly, lz] of tpl) {
      buf[o++] = v.pos.x + lx * cs - lz * sn;
      buf[o++] = v.pos.y + ly;
      buf[o++] = v.pos.z + lx * sn + lz * cs;
    }
    return o;
  }

  // --- the tracked car ------------------------------------------------------------------------
  // One solid car -- a low-poly hatchback at CAR_SCALE times life size, body colour from the
  // model text, glass, wheels, lamps, lit by lamps of its own, plus a red x-ray outline that
  // shows through the buildings -- in its own group in this.scene, not propsGroup, so it
  // survives the props toggle, the auto-degrade and the 9 km cull. It moves leg by leg:
  // trackVehicle() puts it where the server says it is, driveTo(stop) routes it there through
  // the street graph (driveway, shortest path, driveway; a straight line where the graph
  // cannot join) and pulls up at the kerb outside; on arrival the stop is revealed -- pylon and
  // label -- and hooks.onVehicleArrive fires. What happens next is v.mode's:
  //   chase  -- the car waits at the stop, for as long as it takes, until app.js calls
  //             driveTo() again (once the drones have searched the place);
  //   loop   -- it dwells stop.dwell_s and drives on to the next stop by itself, round and round;
  //   parked -- it never moves.
  // Idempotent: the same vehicle is never built twice, a different one replaces the old.
  // v = { slug, owner, plate, model, note, mode, start: {lat, lng}, at_seq,
  //       stops: [{ seq, name, note, lat, lng, building_id, dwell_s, logged_label, cctv_code, state, outcome }] }
  buildCar(color) {
    const grp = new THREE.Group();
    const lit = (c) => new THREE.MeshLambertMaterial({ color: c });
    const flat = (c) => new THREE.MeshBasicMaterial({ color: c });
    // side profile, metres, x forward and y up, extruded across the width (z)
    const profile = (pts) => { const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (const [x, y] of pts.slice(1)) s.lineTo(x, y); s.closePath(); return s; };
    const BODY = [[-2.25, 0.34], [-2.25, 0.86], [-2.05, 0.98], [-1.75, 1.02], [-1.55, 1.42], [-1.1, 1.56], [0.35, 1.56], [0.95, 1.2], [1.75, 1.02], [2.2, 0.9], [2.3, 0.62], [2.3, 0.34]];
    const bodyGeo = new THREE.ExtrudeGeometry(profile(BODY), { depth: 1.8, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 });
    bodyGeo.translate(0, 0, -0.9);
    const body = new THREE.Mesh(bodyGeo, lit(color));
    // the glass: side windows as a slab a touch wider than the body; windscreen and hatch as
    // quads lifted just off their slopes
    const GLASS = [[-1.5, 1.08], [-1.4, 1.4], [-1.05, 1.5], [0.3, 1.5], [0.82, 1.2], [0.82, 1.08]];
    const glassGeo = new THREE.ExtrudeGeometry(profile(GLASS), { depth: 1.92, bevelEnabled: false });
    glassGeo.translate(0, 0, -0.96);
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x141c26, side: THREE.DoubleSide });
    const glass = new THREE.Mesh(glassGeo, glassMat);
    const pane = (a, b, w, lift) => {
      const d = new THREE.Vector2(b[0] - a[0], b[1] - a[1]).normalize();
      const n = new THREE.Vector2(-d.y, d.x); if (n.y < 0) n.negate();   // the normal that points up
      const ax = a[0] + n.x * lift, ay = a[1] + n.y * lift, bx = b[0] + n.x * lift, by = b[1] + n.y * lift, h = w / 2;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([ax, ay, -h, bx, by, -h, bx, by, h, ax, ay, -h, bx, by, h, ax, ay, h], 3));
      g.computeVertexNormals();
      return new THREE.Mesh(g, glassMat);
    };
    const windscreen = pane([0.9, 1.23], [0.42, 1.52], 1.7, 0.09);
    const hatch = pane([-1.5, 1.435], [-1.15, 1.545], 1.6, 0.09);
    // wheels, hubs, lamps, plates
    const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 18); wheelGeo.rotateX(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.26, 12); hubGeo.rotateX(Math.PI / 2);
    const tyre = lit(0x0f1216), hub = lit(0x9aa3ad);
    for (const x of [1.45, -1.4]) for (const z of [0.9, -0.9]) {
      const w = new THREE.Mesh(wheelGeo, tyre); w.position.set(x, 0.34, z);
      const c = new THREE.Mesh(hubGeo, hub); c.position.set(x, 0.34, z);
      grp.add(w, c);
    }
    const lampGeo = new THREE.BoxGeometry(0.08, 0.16, 0.38);
    for (const z of [0.6, -0.6]) {
      const head = new THREE.Mesh(lampGeo, flat(0xfff4d6)); head.position.set(2.34, 0.8, z);
      const tail = new THREE.Mesh(lampGeo, flat(0xff2a1e)); tail.position.set(-2.29, 0.86, z);
      grp.add(head, tail);
    }
    const plateGeo = new THREE.BoxGeometry(0.03, 0.12, 0.5);
    const front = new THREE.Mesh(plateGeo, flat(0xf2f4f6)); front.position.set(2.36, 0.52, 0);
    const rear = new THREE.Mesh(plateGeo, flat(0xf2f4f6)); rear.position.set(-2.31, 0.6, 0);
    // the x-ray outline: the body's edges, drawn through everything
    const ghost = new THREE.LineSegments(new THREE.EdgesGeometry(bodyGeo, 25), new THREE.LineBasicMaterial({ color: BP.you, transparent: true, opacity: 0.32, depthTest: false }));
    ghost.renderOrder = 6;
    grp.add(body, glass, windscreen, hatch, front, rear, ghost);
    grp.traverse((o) => { o.frustumCulled = false; });
    grp.scale.setScalar(CAR_SCALE);
    grp.userData.pick = [body, glass];
    return grp;
  }
  // The kerb outside a stop: the building's edge on the side the nearest street is, so the car
  // pulls up at the door rather than driving into the footprint.
  kerbXY(stop) {
    const b = this.geo.toXY(stop.lat, stop.lng);
    const bld = stop.building_id != null ? this.data.buildings.find((x) => x.id === stop.building_id) : null;
    const edge = bld ? Math.max(bld.width_m, bld.depth_m) / 2 + 7 : 10;
    if (!this.graph || !this.graph.length) return b;
    const n = this.graph[this.nearestNode(b)];
    const dx = n.x - b.x, dy = n.y - b.y, d = Math.hypot(dx, dy);
    if (d < 1) return b;
    const k = Math.min(d, edge) / d;
    return { x: b.x + dx * k, y: b.y + dy * k };
  }
  trackVehicle(v) {
    if (!v) return null;
    if (this.tracked && v.slug && this.tracked.v.slug === v.slug) { this.setStops(v.stops); return this.tracked; }
    this.untrackVehicle();
    if (!this.carLamps) {
      // the cars' materials are the only lit ones in the model, so these touch nothing else
      const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x141c28, 1.15);
      const sun = new THREE.DirectionalLight(0xffffff, 1.05); sun.position.set(300, 500, 200);
      this.carLamps = new THREE.Group(); this.carLamps.add(hemi, sun); this.scene.add(this.carLamps);
    }
    const stops = (v.stops || []).slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
    const at = v.at_seq != null ? stops.find((s) => s.seq === v.at_seq) || null : null;
    const start = v.start || v;
    let p0;
    if (at) { const k = this.kerbXY(at); p0 = new THREE.Vector3(k.x, this.geo.elevationXY(k.x, k.y), -k.y); }
    else p0 = this.pos(start.lat, start.lng);
    const grp = new THREE.Group();
    const mesh = this.buildCar(carColor(v.model));
    const feature = { type: 'vehicle', slug: v.slug, owner: v.owner, plate: v.plate, model: v.model, note: v.note, lat: start.lat, lng: start.lng, building_id: null, stop_seq: null };
    for (const o of mesh.userData.pick) { o.userData.feature = feature; this.pickables.push(o); }
    const glow = this.glow(p0.clone(), 0x9a1c14, 56);   // a halo on the road under the car; the car itself hides it where they overlap
    glow.userData.feature = feature;
    this.pickables.push(glow);
    // the breadcrumb trail: where the car has been since it was picked up, grown as it drives
    const trailBuf = new Float32Array(TRAIL_MAX * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailBuf, 3).setUsage(THREE.DynamicDrawUsage));
    trailGeo.setDrawRange(0, 0);
    const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: BP.you, transparent: true, opacity: 0.55, depthTest: false }));
    trail.frustumCulled = false; trail.renderOrder = 5;
    grp.add(mesh, glow, trail);
    const label = this.addLabel(start.lat, start.lng, '', 'track', 16);
    const pulse = { glow, ring: null, dot: null, rate: 4 };
    this.pulses.push(pulse);
    grp.frustumCulled = false;
    this.scene.add(grp);
    this.trackedGroup = grp;
    this.tracked = {
      v, mode: v.mode || 'chase', stops, revealed: new Map(), leg: null, at: null, dwell: 0, frozen: false, speed: TRACK.speed,
      kind: 'car', ...CAR, pos: p0.clone(), dir: new THREE.Vector3(1, 0, 0),
      mesh, glow, label, labels: [label], picks: [glow, ...mesh.userData.pick], pulse, feature,
      trail: { buf: trailBuf, geo: trailGeo, n: 0, last: new THREE.Vector3(1e9, 0, 1e9) },
    };
    // what the participant already knows: every searched stop, and the one the car is at
    for (const s of stops) if (s.state === 'searched') this.revealStop(s);
    if (at) {
      // parked facing away from the street it came in from
      const b = this.geo.toXY(at.lat, at.lng);
      TMP2.set(b.x - p0.x, 0, -b.y - p0.z); if (TMP2.lengthSq() > 1e-6) this.tracked.dir.copy(TMP2).normalize();
      this.arrive(at, false);
    }
    this.setLabel();
    this.updateTracked(0);
    return this.tracked;
  }
  // The stops as the server now describes them (states, outcomes); anything searched is shown.
  setStops(stops) {
    const t = this.tracked;
    if (!t) return;
    t.stops = (stops || []).slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
    if (t.at) t.at = t.stops.find((s) => s.seq === t.at.seq) || t.at;
    if (t.leg) t.leg.dest = t.stops.find((s) => s.seq === t.leg.dest.seq) || t.leg.dest;
    for (const s of t.stops) {
      if (s.state === 'searched') this.revealStop(s);
      const r = t.revealed.get(s.seq);
      if (r) for (const c of r.marker.children) if (c.userData.feature) Object.assign(c.userData.feature, s);
    }
  }
  revealStop(stop) {
    const t = this.tracked;
    if (!t || t.revealed.has(stop.seq)) return;
    const m = this.marker(stop.lat, stop.lng, BP.you, { type: 'stop', ...stop }, 50, 10);
    this.trackedGroup.add(m);   // re-parents the pylon from this.scene into the tracked group
    t.picks.push(...m.children.filter((c) => c.userData.feature));
    const label = this.addLabel(stop.lat, stop.lng, `STOP ${stop.seq} · ${stop.name}`, 'stopn', 62);
    t.labels.push(label);
    t.revealed.set(stop.seq, { marker: m, label });
  }
  isRevealed(seq) { return !!(this.tracked && this.tracked.revealed.has(seq)); }
  // Drive from wherever the car is now to the kerb outside `stop`. Returns the leg's length in metres.
  driveTo(stop) {
    const t = this.tracked;
    if (!t || !stop || t.frozen) return 0;
    const a = { x: t.pos.x, y: -t.pos.z }, b = this.kerbXY(stop);
    const pts = [];
    const push = (x, y) => { const p = new THREE.Vector3(x, this.geo.elevationXY(x, y), -y); if (!pts.length || pts[pts.length - 1].distanceTo(p) > 0.5) pts.push(p); };
    push(a.x, a.y);
    const path = this.graph && this.graph.length ? this.route(a, b) : null;
    for (const n of path || []) push(n.x, n.y);
    push(b.x, b.y);
    if (pts.length < 2) { this.arrive(stop, true); return 0; }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const from = t.at;
    t.leg = { pts, cum, length: cum[cum.length - 1], s: 0, dest: stop };
    t.at = null; t.dwell = 0;
    this.setLabel();
    if (this.hooks.onVehicleDepart) this.hooks.onVehicleDepart(t.v, stop, from);
    return t.leg.length;
  }
  arrive(stop, fire) {
    const t = this.tracked;
    if (!t) return;
    t.leg = null; t.at = stop;
    t.dwell = t.mode === 'loop' ? (stop.dwell_s ?? TRACK.dwell) : Infinity;
    this.revealStop(stop);
    this.setLabel();
    if (fire && this.hooks.onVehicleArrive) this.hooks.onVehicleArrive(t.v, stop);
  }
  setLabel() {
    const t = this.tracked;
    if (!t) return;
    const who = `● ${String(t.v.plate || t.v.owner || t.v.slug || '').toUpperCase()}`;
    t.label.el.textContent = t.frozen ? `${who} · STOPPED` : t.at ? `${who} · AT STOP ${t.at.seq}` : t.leg ? `${who} · MOVING` : t.mode === 'parked' ? `${who} · PARKED` : who;
  }
  untrackVehicle() {
    const t = this.tracked;
    if (!t) return;
    this.scene.remove(this.trackedGroup);
    for (const l of t.labels) l.el.remove();
    this.labels = this.labels.filter((l) => !t.labels.includes(l));
    this.pickables = this.pickables.filter((p) => !t.picks.includes(p));
    this.pulses = this.pulses.filter((p) => p !== t.pulse);
    this.tracked = null; this.trackedGroup = null; this.follow = false;
  }
  // Called every frame right after updateTraffic, whether or not the props are visible.
  updateTracked(dt) {
    const t = this.tracked;
    if (!t) return;
    const step = dt * this.rate();
    if (!t.frozen) {
      if (t.leg) {
        const L = t.leg;
        L.s = Math.min(L.length, L.s + t.speed * step);
        const { pts, cum } = L;
        let i = 1; while (i < cum.length - 1 && cum[i] < L.s) i++;
        const a = pts[i - 1], b = pts[i], u = (L.s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
        TMP.lerpVectors(a, b, u);
        TMP2.subVectors(b, a); TMP2.y = 0;
        if (TMP2.lengthSq() > 1e-6) t.dir.copy(TMP2).normalize();
        // keep left on the road; straight in at the kerb
        const lane = L.s >= L.length ? 0 : TRACK.lane;
        t.pos.set(TMP.x + t.dir.z * lane, this.ground(TMP.x, TMP.z), TMP.z - t.dir.x * lane);
        if (L.s >= L.length) this.arrive(L.dest, true);
      } else if (t.at && t.mode === 'loop' && t.stops.length > 1) {
        t.dwell -= step;
        if (t.dwell <= 0) { const i = t.stops.indexOf(t.at); this.driveTo(t.stops[(i + 1) % t.stops.length]); }
      }
    }
    // the pose
    t.mesh.position.copy(t.pos);
    t.mesh.rotation.y = Math.atan2(-t.dir.z, t.dir.x);
    t.glow.position.set(t.pos.x, t.pos.y + 0.8, t.pos.z);
    t.label.pos.set(t.pos.x, t.pos.y + 16, t.pos.z);
    // breadcrumbs
    const tr = t.trail;
    if (tr.n < TRAIL_MAX && t.pos.distanceTo(tr.last) > TRAIL_STEP) {
      tr.buf[tr.n * 3] = t.pos.x; tr.buf[tr.n * 3 + 1] = t.pos.y + 1.5; tr.buf[tr.n * 3 + 2] = t.pos.z;
      tr.n++; tr.last.copy(t.pos);
      tr.geo.setDrawRange(0, tr.n);
      tr.geo.attributes.position.needsUpdate = true;
    }
    // the feature app.js gets on a right-click: where the car is now, and whose
    // building it is stopped at (null on the road)
    const ll = this.geo.toLatLng(t.pos.x, -t.pos.z);
    t.feature.lat = ll.lat; t.feature.lng = ll.lng;
    t.feature.building_id = t.at ? (t.at.building_id ?? null) : null;
    t.feature.stop_seq = t.at ? (t.at.seq ?? null) : null;
  }
  // Camera follow: the tracking view is from high above and a little behind the car, looking
  // down at it; after the glide in, the orbit target rides with the car and the eye keeps
  // whatever offset the participant orbits or zooms to.
  followVehicle(on) {
    this.follow = !!on && !!this.tracked;
    if (!this.follow || this.chase) return;
    const t = this.tracked, p = t.pos;
    const off = new THREE.Vector3(-t.dir.x, 0, -t.dir.z).multiplyScalar(FOLLOW.back); off.y = FOLLOW.up;
    this.tween = { t: 0, dur: 1.1, fromT: this.controls.target.clone(), fromC: this.camera.position.clone(), toT: p.clone(), toC: p.clone().add(off) };
  }
  updateFollow() {
    if (!this.follow || !this.tracked || this.chase) return;
    const p = this.tracked.pos;
    if (this.tween) { const tw = this.tween; TMP.subVectors(p, tw.toT); tw.toT.copy(p); tw.toC.add(TMP); return; }
    TMP.subVectors(p, this.controls.target);
    this.controls.target.copy(p);
    this.camera.position.add(TMP);
  }
  // She has been found: the car stops where it is and says so.
  stopTracking() {
    const t = this.tracked;
    if (!t) return;
    t.frozen = true; t.leg = null; t.dwell = Infinity;
    this.setLabel();
  }

  // draw the drones through the rock while they are inside a cave
  setDroneXray(on) {
    for (const d of this.drones) d.traverse((o) => { if (o.material) { o.material.depthTest = !on; o.material.needsUpdate = true; o.renderOrder = on ? 8 : 0; } });
  }
  buildDrones() {
    this.drones = [];
    // lateral offset (m), height offset (m) -- an open echelon, one drone every FLIGHT.lag metres along the street
    this.formation = [[0, 0], [-10, 3], [10, 3], [0, 7]];
    for (let i = 0; i < this.formation.length; i++) {
      const d = this.droneModel();
      d.visible = false;
      d.scale.setScalar(1.5);
      this.scene.add(d);
      this.drones.push(d);
    }
    this.mission = null;
    this.camLook = new THREE.Vector3();
  }
  // Plan a line between the buildings: an A* search on a 10 m grid where every
  // building footprint (plus clearance) and every mast is blocked, then the
  // path is pulled tight with line-of-sight checks so the legs run straight
  // and only bend where something is in the way.
  planBetweenBuildings(from, to) {
    const CELL = 10, MARGIN = 350, CLEAR = 7;
    const minX = Math.min(from.x, to.x) - MARGIN, maxX = Math.max(from.x, to.x) + MARGIN;
    const minY = Math.min(from.y, to.y) - MARGIN, maxY = Math.max(from.y, to.y) + MARGIN;
    const W = Math.ceil((maxX - minX) / CELL), H = Math.ceil((maxY - minY) / CELL);
    const blocked = new Uint8Array(W * H);
    const mark = (x, y) => { const cx = Math.floor((x - minX) / CELL), cy = Math.floor((y - minY) / CELL); if (cx >= 0 && cy >= 0 && cx < W && cy < H) blocked[cy * W + cx] = 1; };
    if (!this.bxy) this.bxy = this.data.buildings.map((b) => { const p = this.geo.toXY(b.lat, b.lng); const a = (b.rotation_deg * Math.PI) / 180; return { x: p.x, y: p.y, hw: b.width_m / 2, hd: b.depth_m / 2, cs: Math.cos(a), sn: Math.sin(a), r: Math.hypot(b.width_m, b.depth_m) / 2 }; });
    for (const b of this.bxy) {
      if (b.x < minX - b.r || b.x > maxX + b.r || b.y < minY - b.r || b.y > maxY + b.r) continue;
      const R = b.r + CLEAR;
      for (let x = b.x - R; x <= b.x + R; x += CELL * 0.5) for (let y = b.y - R; y <= b.y + R; y += CELL * 0.5) {
        const dx = x - b.x, dy = y - b.y;
        const lx = dx * b.cs - dy * b.sn, ly = dx * b.sn + dy * b.cs;
        if (Math.abs(lx) <= b.hw + CLEAR && Math.abs(ly) <= b.hd + CLEAR) mark(x, y);
      }
    }
    for (const t of this.data.towers || []) { const p = this.geo.toXY(t.lat, t.lng); if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue; for (let x = p.x - 9; x <= p.x + 9; x += 5) for (let y = p.y - 9; y <= p.y + 9; y += 5) mark(x, y); }
    const cellOf = (p) => [Math.min(W - 1, Math.max(0, Math.floor((p.x - minX) / CELL))), Math.min(H - 1, Math.max(0, Math.floor((p.y - minY) / CELL)))];
    const [sx, sy] = cellOf(from), [tx, ty] = cellOf(to);
    for (const [cx, cy] of [[sx, sy], [tx, ty]]) for (let x = cx - 2; x <= cx + 2; x++) for (let y = cy - 2; y <= cy + 2; y++) if (x >= 0 && y >= 0 && x < W && y < H) blocked[y * W + x] = 0;
    // A*
    const g = new Float32Array(W * H).fill(Infinity), came = new Int32Array(W * H).fill(-1);
    const heap = new MinHeap();
    const h = (x, y) => { const dx = Math.abs(x - tx), dy = Math.abs(y - ty); return CELL * (Math.max(dx, dy) + 0.4142 * Math.min(dx, dy)); };
    const s0 = sy * W + sx, t0 = ty * W + tx;
    g[s0] = 0; heap.push(h(sx, sy), s0);
    let found = false, expanded = 0;
    while (heap.size && expanded < 400000) {
      const [, cur] = heap.pop();
      if (cur === t0) { found = true; break; }
      expanded++;
      const cx = cur % W, cy = (cur - cx) / W;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (blocked[ni]) continue;
        if (dx && dy && (blocked[cy * W + nx] || blocked[ny * W + cx])) continue;   // no corner cutting
        const ng = g[cur] + (dx && dy ? CELL * 1.4142 : CELL);
        if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; heap.push(ng + h(nx, ny), ni); }
      }
    }
    if (!found) return [from, to];
    const cells = [];
    for (let c = t0; c !== -1; c = came[c]) cells.push({ x: minX + ((c % W) + 0.5) * CELL, y: minY + (Math.floor(c / W) + 0.5) * CELL });
    cells.reverse();
    cells[0] = from; cells[cells.length - 1] = to;
    // string-pulling: keep only the corners that a straight leg cannot skip
    const clear = (a, b) => { const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (CELL * 0.4)); for (let k = 0; k <= n; k++) { const x = a.x + ((b.x - a.x) * k) / n, y = a.y + ((b.y - a.y) * k) / n; const cx = Math.floor((x - minX) / CELL), cy = Math.floor((y - minY) / CELL); if (cx >= 0 && cy >= 0 && cx < W && cy < H && blocked[cy * W + cx]) return false; } return true; };
    const out = [cells[0]];
    let i = 0;
    while (i < cells.length - 1) {
      let j = cells.length - 1;
      while (j > i + 1 && !clear(cells[i], cells[j])) j--;
      out.push(cells[j]); i = j;
    }
    return out;
  }
  // The flight plan: lift off the pad, drop to gap height and thread between
  // the buildings on a straight-as-possible line to the point.
  flightPlan(target) {
    const from = { x: this.pad.x, y: -this.pad.z };
    const to = { x: target.x, y: -target.z };
    const legs = this.planBetweenBuildings(from, to);
    const alt = FLIGHT.altitude;
    const pts = [this.pad.clone(), this.pad.clone().add(new THREE.Vector3(0, 30, 0))];
    // densify each leg so the flight follows the terrain, easing down from the roof on the first one
    const roofY = this.pad.y + 30;
    for (let i = 0; i < legs.length - 1; i++) {
      const a = legs[i], b = legs[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 70));
      for (let k = 1; k <= n; k++) {
        const u = k / n, x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u;
        let yy = this.ground(x, -y) + alt;
        if (i === 0) yy = Math.max(yy, roofY + (yy - roofY) * Math.min(1, (u * n) / 5));
        pts.push(new THREE.Vector3(x, yy, -y));
      }
    }
    pts.push(new THREE.Vector3(target.x, target.y, target.z));
    const clean = [pts[0]];
    for (const p of pts.slice(1)) if (p.distanceTo(clean[clean.length - 1]) > 6) clean.push(p);
    const curve = new THREE.CatmullRomCurve3(clean, false, 'centripetal', 0.35);
    curve.arcLengthDivisions = Math.max(400, clean.length * 12);
    return { curve, length: curve.getLength(), nodes: clean.length };
  }
  launchSearch(lat, lng, meta = {}) {
    if (this.mission && this.mission.phase !== 'return' && this.mission.phase !== 'done') return false;
    if (this.mission && this.mission.phase === 'return') this.finishMission();
    const target = this.pos(lat, lng, 26);
    const plan = this.flightPlan(target);
    const track = new THREE.Line(new THREE.BufferGeometry().setFromPoints(plan.curve.getSpacedPoints(Math.min(1200, Math.round(plan.length / 12))).map((p) => new THREE.Vector3(p.x, this.ground(p.x, p.z) + 2.5, p.z))), new THREE.LineDashedMaterial({ color: BP.route, dashSize: 14, gapSize: 10, transparent: true, opacity: 0.6, depthTest: false }));
    track.computeLineDistances(); track.renderOrder = 5;
    this.scene.add(track);
    const rings = [0, 1, 2].map(() => { const r = this.circle(new THREE.Vector3(0, 0, 0), 1, 64, 0, BP.scan, { opacity: 0, xray: true }); r.position.set(target.x, target.y - 24, target.z); r.visible = false; this.scene.add(r); return r; });
    // what the sweep is shaped around: the named building, or the nearest one within 30 m, or a bare point
    const near = (meta.building && this.data.buildings.find((b) => b.id === meta.building.id)) || this.data.buildings.find((b) => Math.hypot((b.lng - lng) * 108400, (b.lat - lat) * 110574) < 30);
    const g0 = this.ground(target.x, target.z);
    const scan = near
      ? { cx: this.pos(near.lat, near.lng).x, cz: this.pos(near.lat, near.lng).z, y0: this.ground(this.pos(near.lat, near.lng).x, this.pos(near.lat, near.lng).z), y1: this.ground(this.pos(near.lat, near.lng).x, this.pos(near.lat, near.lng).z) + near.height_m, r: Math.hypot(near.width_m, near.depth_m) / 2 + 8, scanFor: 7 }
      : { cx: target.x, cz: target.z, y0: g0, y1: g0 + 24, r: 24, scanFor: FLIGHT.scanFor };
    // a cave is different: two drones work the entrance, two fly the tunnel
    const cave = (this.caves || []).find((c) => Math.hypot(c.x - target.x, c.z - target.z) < 45);
    if (cave) Object.assign(scan, { kind: 'cave', cave, cx: cave.x, cz: cave.z, y0: cave.y0, y1: cave.y0 + 30, r: 30, scanFor: 9 });
    this.mission = { phase: 'out', dist: 0, curve: plan.curve, length: plan.length, target, lat, lng, meta, track, rings, scan, scanT: 0, reported: false, resolved: false };
    for (const d of this.drones) { d.visible = true; d.position.copy(this.pad); }
    this.chase = true;
    this.controls.enabled = false;
    this.camera.position.copy(this.pad).add(new THREE.Vector3(-70, 30, 110));
    this.camLook.copy(this.pad);
    return true;
  }
  finishMission() {
    const m = this.mission;
    if (!m) return;
    m.phase = 'done';
    this.drones.forEach((d) => { d.visible = false; });
    this.scene.remove(m.track);
    m.rings.forEach((r) => this.scene.remove(r));
  }
  resolveMission() { if (this.mission) this.mission.resolved = true; }
  // A searched point, by outcome: 'found' (green, pulsing), 'trace' (magenta,
  // pulsing -- the jacket and the band), 'clue' (amber -- a swept story spot),
  // anything else 'clear' (orange). A boolean still reads as found / clear.
  markSearch(lat, lng, outcome, radius) {
    if (typeof outcome !== 'string') outcome = outcome ? 'found' : 'clear';
    const STYLE = {
      found: { color: BP.scan, label: '✔ FOUND · MEERA LOCATED', cls: 'found', opacity: 1, pulse: true },
      trace: { color: BP.sos, label: '⚠ TRACE · JACKET + BAND · RECORDING', cls: 'trace', opacity: 1, pulse: true },
      clue: { color: BP.clue, label: '● CLUE · SWEPT', cls: 'clue', opacity: 0.85, pulse: false },
      clear: { color: BP.cave2, label: '✕ SEARCHED · NO TRACE', cls: 'searched', opacity: 0.7, pulse: false },
    };
    const st = STYLE[outcome] || STYLE.clear;
    const p = this.pos(lat, lng);
    const ring = this.groundCircle(lat, lng, radius, st.color, { dash: 12, gap: 8, opacity: st.opacity });
    const cross = this.lines([p.x - 12, p.y + 2, p.z, p.x + 12, p.y + 2, p.z, p.x, p.y + 2, p.z - 12, p.x, p.y + 2, p.z + 12], st.color, { xray: true });
    this.scene.add(ring, cross);
    this.addLabel(lat, lng, st.label, st.cls, 30);
    if (st.pulse) { const g = this.glow(new THREE.Vector3(p.x, p.y + 30, p.z), st.color, 110); this.scene.add(g); this.pulses.push({ glow: g, ring, dot: null, rate: 2 }); }
  }
  placeDrones(curve, length, headDist, reverse) {
    const tan = new THREE.Vector3(), right = new THREE.Vector3(), p = new THREE.Vector3();
    this.drones.forEach((d, i) => {
      const [lat, up] = this.formation[i];
      const u = THREE.MathUtils.clamp((headDist - i * FLIGHT.lag) / length, 0, 1);
      curve.getPointAt(reverse ? 1 - u : u, p);
      curve.getTangentAt(reverse ? 1 - u : u, tan);
      if (reverse) tan.negate();
      right.crossVectors(tan, UP).normalize();
      p.addScaledVector(right, lat);
      p.y = Math.max(p.y + up, this.ground(p.x, p.z) + 10);
      d.position.copy(p);
      d.rotation.set(0, Math.atan2(tan.x, tan.z) + Math.PI, 0);
      d.rotation.x = -0.18;                                  // nose down, like a quad in forward flight
      d.rotation.z = -right.dot(new THREE.Vector3(0, 0, 0)) * 0;
      d.children.forEach((c) => { if (c.userData.rotor) c.rotation.y += 0.9; });
    });
    return tan;
  }
  chaseCamera(dt, lead, forward) {
    // behind the whole line of drones, a little above, looking past the leader
    const back = 30 + FLIGHT.lag * (this.drones.length - 1) + 30;
    const desired = lead.clone().addScaledVector(forward, -back).add(new THREE.Vector3(0, 30, 0));
    desired.y = Math.max(desired.y, this.ground(desired.x, desired.z) + 8);
    const k = 1 - Math.pow(0.02, dt);
    this.camera.position.lerp(desired, k);
    this.camLook.lerp(lead.clone().addScaledVector(forward, 30).add(new THREE.Vector3(0, -4, 0)), k);
    this.camera.lookAt(this.camLook);
  }
  updateMission(dt, now) {
    const m = this.mission;
    if (!m || m.phase === 'done') return;
    const step = FLIGHT.speed * dt * this.rate();
    this.drones.forEach((d, i) => { d.userData.strobe.material.color.setHex(Math.sin(now * 9 + i * 1.3) > 0.7 ? 0xffffff : 0x223344); });
    if (m.phase === 'out') {
      m.dist += step;
      const tan = this.placeDrones(m.curve, m.length, m.dist, false);
      if (this.chase) this.chaseCamera(dt, this.drones[0].position, tan);
      if (m.dist >= m.length + FLIGHT.lag * (this.drones.length - 1)) { m.phase = 'scan'; m.scanT = 0; m.rings.forEach((r) => { r.visible = true; }); }
    } else if (m.phase === 'scan') {
      // Four sweeps of the building at once: one drone rings the base, one rings
      // the roof, one spirals down from the roof, one spirals up from the base.
      m.scanT += dt * this.rate();
      const s = m.scanT, sc = m.scan;
      const T = sc.scanFor, w = 1.1;
      const lowY = sc.y0 + 6, highY = sc.y1 + 8;
      const frac = (s % (T / 2)) / (T / 2);
      const patterns = [
        [w * s, lowY],
        [w * s + Math.PI, highY],
        [w * 1.6 * s + Math.PI / 2, highY - (highY - lowY) * frac],
        [w * 1.6 * s + (3 * Math.PI) / 2, lowY + (highY - lowY) * frac],
      ];
      if (sc.kind === 'cave') {
        // Cave: drones 1 and 2 work the entrance from outside, drones 3 and 4
        // fly the tunnel -- one going in while the other comes out.
        const c = sc.cave;
        if (!m.xray) { m.xray = true; this.setDroneXray(true); }
        const fwd = new THREE.Vector3(c.dx, 0, c.dz), side = new THREE.Vector3(-c.dz, 0, c.dx);
        const mouth = new THREE.Vector3(c.x, c.y0, c.z);
        // outside: a ring in front of the mouth, and a low sweep across it
        const o1 = mouth.clone().addScaledVector(fwd, -34).addScaledVector(side, Math.sin(s * 0.9) * 26); o1.y = c.y0 + 14;
        const o2 = mouth.clone().addScaledVector(fwd, -18).addScaledVector(side, Math.cos(s * 1.2) * 12); o2.y = c.y0 + 5 + Math.abs(Math.sin(s * 1.2)) * 6;
        // inside: depth along the tunnel, oscillating, in antiphase
        const din = c.L * (0.5 - 0.5 * Math.cos(s * 0.9));
        const dout = c.L * (0.5 - 0.5 * Math.cos(s * 0.9 + Math.PI));
        const inside = (depth, lat) => { const p = mouth.clone().addScaledVector(fwd, depth).addScaledVector(side, lat * c.W * (1 - 0.45 * (depth / c.L)) * 0.3); p.y = c.y0 - (depth / c.L) * 5 + c.H * (1 - 0.4 * (depth / c.L)) * 0.45; return p; };
        const targets = [o1, o2, inside(din, 1), inside(dout, -1)];
        this.drones.forEach((d, i) => {
          const t = targets[i % targets.length];
          const prev = d.position.clone();
          d.position.copy(t);
          const mv = t.clone().sub(prev); mv.y = 0;
          if (mv.lengthSq() > 0.01) d.rotation.set(-0.08, Math.atan2(mv.x, mv.z) + Math.PI, 0);
          d.children.forEach((k) => { if (k.userData.rotor) k.rotation.y += 0.9; });
        });
        m.rings.forEach((r, i) => { const u = (s * 0.5 + i / 3) % 1; const R = 4 + u * 60; r.scale.set(R, 1, R); r.position.set(c.x, c.y0 + 1, c.z); r.material.opacity = 0.9 * (1 - u); });
        if (this.chase) {
          // stand off in front of the mouth, a little to one side, drifting
          const desired = mouth.clone().addScaledVector(fwd, -95).addScaledVector(side, Math.sin(s * 0.2) * 40); desired.y = c.y0 + 30;
          desired.y = Math.max(desired.y, this.ground(desired.x, desired.z) + 8);
          const k = 1 - Math.pow(0.02, dt);
          this.camera.position.lerp(desired, k);
          this.camLook.lerp(mouth.clone().addScaledVector(fwd, 25).add(new THREE.Vector3(0, 4, 0)), k);
          this.camera.lookAt(this.camLook);
        }
      } else {
      this.drones.forEach((d, i) => {
        const [ang, y] = patterns[i % patterns.length];
        const r = sc.r + (i >= 2 ? 6 : 0);
        d.position.set(sc.cx + Math.cos(ang) * r, y, sc.cz + Math.sin(ang) * r);
        d.rotation.set(-0.1, -ang, 0);
        d.children.forEach((k) => { if (k.userData.rotor) k.rotation.y += 0.9; });
      });
      m.rings.forEach((r, i) => { const u = (s * 0.5 + i / 3) % 1; const R = 4 + u * (sc.r * 2.5); r.scale.set(R, 1, R); r.material.opacity = 0.9 * (1 - u); });
      if (this.chase) {
        // a slow orbit around the building, looking at its middle
        const a = s * 0.25 + Math.PI / 4, R = sc.r + 70 + (sc.y1 - sc.y0) * 0.6;
        const desired = new THREE.Vector3(sc.cx + Math.cos(a) * R, (sc.y0 + sc.y1) / 2 + 30 + (sc.y1 - sc.y0) * 0.25, sc.cz + Math.sin(a) * R);
        const k = 1 - Math.pow(0.02, dt);
        this.camera.position.lerp(desired, k);
        this.camLook.lerp(new THREE.Vector3(sc.cx, (sc.y0 + sc.y1) / 2, sc.cz), k);
        this.camera.lookAt(this.camLook);
      }
      }
      // the app pins the flight's frames to the building as the sweep runs
      if (this.hooks.onScanProgress) this.hooks.onScanProgress(m, Math.min(1, s / T));
      if (s >= T && !m.reported) { m.reported = true; this.hooks.onScanComplete(m); }
      if (m.resolved && s >= T) {
        const c = m.target;
        m.phase = 'return'; m.dist = 0; m.rings.forEach((r) => { r.visible = false; });
        if (m.xray) { m.xray = false; this.setDroneXray(false); }
        // hand the camera back, parked over the searched point
        this.chase = false;
        this.controls.enabled = true;
        this.controls.target.copy(c);
        this.camera.position.copy(c).add(new THREE.Vector3(120, 150, 180));
        this.controls.update();
      }
    } else if (m.phase === 'return') {
      m.dist += step;
      this.placeDrones(m.curve, m.length, m.dist, true);
      if (m.dist >= m.length + FLIGHT.lag * (this.drones.length - 1)) this.finishMission();
    }
  }
  setTimeScale(x) { this.timeScale = x; }
  // What one second of wall clock is worth to everything that moves: the
  // flights, the cars, the turbines. The sweep itself always runs at 1x -- the
  // frames pop in on its clock, and that is the beat worth watching.
  rate() { return this.mission && this.mission.phase === 'scan' ? 1 : this.timeScale; }

  // --- camera + navigation --------------------------------------------------------------------
  resetView() {
    this.releaseCamera();
    const base = this.geo.base;
    this.controls.target.set(0, base + 60, 0);
    this.camera.position.set(2300, base + 2400, 2300);
    this.controls.update();
  }
  overview() {
    this.releaseCamera();
    const base = this.geo.base;
    this.controls.target.set(0, base, 0);
    this.camera.position.set(0, base + 9500, 11500);
    this.controls.update();
  }
  releaseCamera() {
    if (this.chase) { this.chase = false; this.controls.enabled = true; this.camera.up.set(0, 1, 0); }
    this.tween = null;
    this.follow = false;   // Fly here / Reset / Overview drop the car
  }
  flyTo(lat, lng, distance = 900) {
    this.releaseCamera();
    const p = this.pos(lat, lng);
    const offset = this.camera.position.clone().sub(this.controls.target);
    if (offset.length() < 1) offset.set(0.35, 0.7, 0.8);
    offset.setLength(distance);
    offset.y = Math.max(offset.y, distance * 0.35);
    this.tween = { t: 0, dur: 0.9, fromT: this.controls.target.clone(), fromC: this.camera.position.clone(), toT: p, toC: p.clone().add(offset) };
  }
  updateNav(dt) {
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(tw.dur, tw.t + dt);
      const u = tw.t / tw.dur, e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      this.controls.target.lerpVectors(tw.fromT, tw.toT, e);
      this.camera.position.lerpVectors(tw.fromC, tw.toC, e);
      if (u >= 1) this.tween = null;
    }
    if (!this.controls.enabled || !this.keys.size) return;
    const k = this.keys;
    const fwd = new THREE.Vector3().subVectors(this.controls.target, this.camera.position); fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const d = this.camera.position.distanceTo(this.controls.target);
    const speed = THREE.MathUtils.clamp(d * 0.9, 60, 6000) * (k.has('shift') ? 3 : 1) * dt;
    const move = new THREE.Vector3();
    if (k.has('w') || k.has('arrowup')) move.add(fwd);
    if (k.has('s') || k.has('arrowdown')) move.sub(fwd);
    if (k.has('d') || k.has('arrowright')) move.add(right);
    if (k.has('a') || k.has('arrowleft')) move.sub(right);
    if (move.lengthSq()) { move.normalize().multiplyScalar(speed); this.controls.target.add(move); this.camera.position.add(move); }
    const off = this.camera.position.clone().sub(this.controls.target);
    if (k.has('q') || k.has('e')) { off.applyAxisAngle(UP, (k.has('q') ? 1 : -1) * 1.4 * dt); this.camera.position.copy(this.controls.target).add(off); }
    if (k.has('r') || k.has('f') || k.has('+') || k.has('-') || k.has('=')) {
      const zoomIn = k.has('r') || k.has('+') || k.has('=');
      off.multiplyScalar(zoomIn ? Math.max(0.2, 1 - 1.6 * dt) : 1 + 1.6 * dt);
      if (off.length() > this.controls.minDistance && off.length() < this.controls.maxDistance) this.camera.position.copy(this.controls.target).add(off);
    }
    // keep the eye above the ground
    const minY = this.ground(this.camera.position.x, this.camera.position.z) + 8;
    if (this.camera.position.y < minY) this.camera.position.y = minY;
    this.controls.target.y = Math.max(this.controls.target.y, this.ground(this.controls.target.x, this.controls.target.z));
  }
  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // --- picking ------------------------------------------------------------------------------
  setPointer(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }
  onPointer(e) {
    this.setPointer(e);
    const hit = this.raycaster.intersectObject(this.terrain)[0];
    if (hit) { const ll = this.geo.toLatLng(hit.point.x, -hit.point.z); this.hooks.onHover({ ...ll, elevation: hit.point.y }); }
  }
  hitFeature() {
    const mk = this.raycaster.intersectObjects(this.pickables)[0];
    if (mk) return mk.object.userData.feature;
    const bh = this.raycaster.intersectObjects([this.buildings, this.houses])[0];
    if (bh && bh.instanceId !== undefined) return { type: 'building', ...bh.object.userData.items[bh.instanceId] };
    const th = this.raycaster.intersectObject(this.terrain)[0];
    if (th) {
      const ll = this.geo.toLatLng(th.point.x, -th.point.z);
      const inDistrict = this.data.districts.find((d) => pointInPolygon({ x: th.point.x, y: -th.point.z }, d.polygon.map(([lat, lng]) => this.geo.toXY(lat, lng))));
      if (inDistrict) return { type: 'district', ...inDistrict, lat: inDistrict.center_lat, lng: inDistrict.center_lng, clicked: ll };
      return { type: 'ground', lat: ll.lat, lng: ll.lng, elevation_m: th.point.y };
    }
    return null;
  }
  onClick(e) { this.setPointer(e); this.hooks.onSelect(this.hitFeature()); }
  onRightClick(e) { this.setPointer(e); const f = this.hitFeature(); if (f) this.hooks.onSearchRequest(f); }
  onDoubleClick(e) {
    this.setPointer(e);
    const hit = this.raycaster.intersectObject(this.terrain)[0];
    if (!hit) return;
    const ll = this.geo.toLatLng(hit.point.x, -hit.point.z);
    this.flyTo(ll.lat, ll.lng, Math.max(160, this.camera.position.distanceTo(this.controls.target) * 0.5));
  }

  // Where the current sweep's subject sits on screen (its top), in CSS pixels
  // of the container -- for HTML that must ride the building through the
  // orbiting camera. Null when there is no mission or it is behind the camera.
  scanAnchor() {
    const m = this.mission;
    if (!m || !m.scan) return null;
    const sc = m.scan;
    const v = new THREE.Vector3(sc.cx, sc.y1 + 6, sc.cz).project(this.camera);
    if (v.z >= 1) return null;
    return { x: ((v.x + 1) / 2) * this.container.clientWidth, y: ((1 - v.y) / 2) * this.container.clientHeight };
  }
  updateLabels() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const v = new THREE.Vector3();
    const camPos = this.camera.position;
    const maxDist = { police: 1e9, found: 1e9, trace: 1e9, range: 1e9, track: 1e9, gap: 40000, peak: 60000, searched: 30000, clue: 30000, stopn: 30000, cave2: 20000, stop: 30000, place: 9000, infra: 6000, cctv: 2600 };
    for (const l of this.labels) {
      v.copy(l.pos).project(this.camera);
      const allowed = l.cls === 'cctv' ? this.showCCTV : true;
      const visible = allowed && this.showLabels && v.z < 1 && camPos.distanceTo(l.pos) < maxDist[l.cls] && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      l.el.hidden = !visible;
      if (visible) { l.el.style.left = `${((v.x + 1) / 2) * w}px`; l.el.style.top = `${((1 - v.y) / 2) * h}px`; }
    }
    const viewDist = camPos.distanceTo(this.controls.target);
    if (this.streets) this.streets.visible = viewDist < 16000 || this.chase || this.follow;
    // vegetation, props and traffic only when close enough to matter
    this.propsGroup.visible = this.showProps && !this.degraded && (viewDist < 9000 || this.chase);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    if (this.container.hidden) return;
    const raw = this.clock.getDelta();
    const dt = Math.min(0.1, raw);
    // auto-degrade: if frames stay slow, drop the heavy layers and say so
    this.slowFrames = raw > 0.12 ? (this.slowFrames || 0) + 1 : Math.max(0, (this.slowFrames || 0) - 1);
    if (this.slowFrames > 20 && !this.degraded) { this.degraded = true; this.hooks.onDegrade && this.hooks.onDegrade(); }
    const now = this.clock.getElapsedTime();
    this.updateMission(dt, now);
    this.updateTraffic(dt);
    this.updateTracked(dt);   // the tracked car moves whether or not the props are on
    this.updateFollow();
    this.updateNav(dt);
    if (this.controls.enabled) this.controls.update();
    if (this.beacon) this.beacon.material.color.setHex(Math.sin(now * 4) > 0 ? BP.beacon : 0x661a14);
    for (const t of this.turbines || []) t.children[0].rotation.x += dt * this.rate() * t.userData.spin * 2;
    for (const l of this.mastLights || []) l.material.color.setHex(Math.sin(now * 2.5 + l.position.x * 0.01) > 0.3 ? BP.beacon : 0x441010);
    for (const g of this.pulses) {
      const pulse = 0.5 + 0.5 * Math.sin(now * g.rate);
      const base = g.glow.userData.baseScale || 140;
      g.glow.scale.setScalar(base * (0.8 + 0.5 * pulse));
      g.glow.material.opacity = 0.55 + 0.45 * pulse;
      if (g.ring && g.ring.material) g.ring.material.opacity = 0.35 + 0.5 * pulse;
      if (g.dot && g.dot.scale) g.dot.scale.setScalar(0.9 + 0.3 * pulse);
    }
    this.updateLabels();
    this.renderer.render(this.scene, this.camera);
    // the first frame is the page's "ready": the loader comes down on it
    if (!this.rendered) { this.rendered = true; this.hooks.onFirstFrame && this.hooks.onFirstFrame(); }
  }
}

const KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e', 'r', 'f', '+', '-', '=', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function segIntersect(p, p2, q, q2) {
  const rx = p2.x - p.x, ry = p2.y - p.y, sx = q2.x - q.x, sy = q2.y - q.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q.x - p.x) * sy - (q.y - p.y) * sx) / den;
  const u = ((q.x - p.x) * ry - (q.y - p.y) * rx) / den;
  if (t <= 0.001 || t >= 0.999 || u <= 0.001 || u >= 0.999) return null;
  return { t, u };
}
function projectOnSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  const point = { x: a.x + dx * t, y: a.y + dy * t };
  return { t, point, d: Math.hypot(p.x - point.x, p.y - point.y) };
}
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
}
