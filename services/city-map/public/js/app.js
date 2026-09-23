import { makeGeo, KIND_LABEL } from './geo.js';
import { BlueprintScene } from './scene3d.js';

const $ = (s) => document.querySelector(s);
const data = await fetch('/api/map/bundle').then((r) => r.json());
// no session (the cookie is gone, or was never set): the lobby is where one comes from
if (!data || !data.config) {
  if (data && data.login) location.replace(`http://${location.hostname}:3030/`);
  else document.querySelector('#mission').textContent = (data && data.error) || 'The model could not be loaded.';
  throw new Error('no bundle');
}
const geo = makeGeo(data.config, data.mountains);

const fmtTime = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const readout = $('#readout');
const info = $('#info');
const status = $('#mission');
const log = $('#search-log');
const latIn = $('#lat'), lngIn = $('#lng');
const speedBtn = $('#speed');
const searchBox = $('#search');
const trackPanel = $('#trackpanel'), trackBtn = $('#jump-track'), trackQ = $('#track-q'), trackResults = $('#track-results'), trackHint = $('#track-hint'), vehicleCard = $('#vehicle-card'), stopsEl = $('#stops');
const footage = $('#footage'), footageBody = $('#footage-body'), footageN = $('#footage-n');
const lightbox = $('#lightbox'), lbKind = $('#lb-kind'), lbCount = $('#lb-count'), lbImg = $('#lb-img'), lbCap = $('#lb-cap');

// a search has one of four outcomes; rows written before the story columns
// existed only know found / not found
const outcomeOf = (s) => s.outcome || (s.found ? 'found' : 'clear');
const GLYPH = { found: '✔ ', trace: '⚠ ', clue: '● ', clear: '✕ ' };
// what the story remembers across reloads (the memo played, the rescue shown);
// localStorage can be off, and nothing here may break when it is
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  remove(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
// Fifty participants may pass through one browser: every key is suffixed
// with the participant the server named in the bundle, so one game's memory
// never becomes another's. No participant (single-player) keeps the bare key.
const key = (k) => (data.config.player ? `${k}:${data.config.player}` : k);

// Nikhil's car: null until tracking is unlocked and GET /api/vehicles/nikhil has answered
let vehicle = null;

const hooks = {
  onHover(p) {
    readout.innerHTML = `<span>LAT ${p.lat.toFixed(5)}</span><span>LNG ${p.lng.toFixed(5)}</span><span>ELEV ${Math.round(p.elevation)} m</span>`;
  },
  onSelect(f) { select(f, false); },
  onDegrade() { $('#props-toggle').checked = false; setStatus('busy', 'Slow frames: trees, props and traffic switched off. Tick "Trees & props" to bring them back.'); },
  onContextLost() { setStatus('error', 'The graphics context was lost. Reloading the model…'); setTimeout(() => location.reload(), 1500); },
  onSearchRequest(f) {
    if (f.type === 'building' || f.type === 'you') return launch(f.lat, f.lng, 'building', f);
    if (f.type === 'stop') return launch(f.lat, f.lng, 'building', { id: f.building_id, name: f.name });
    if (f.type === 'vehicle') return launchAtCar(f);
    if (f.type === 'district' && f.clicked) return launch(f.clicked.lat, f.clicked.lng, 'coords');
    if (f.lat !== undefined) return launch(f.lat, f.lng, 'coords');
  },
  onScanProgress(m, p) { liveFrames.tick(p); },
  // the tracked car pulling up / pulling away: the panel lists the place, and
  // the mission line says so unless the drones are out (their report owns it)
  onVehicleArrive(v, stop) {
    renderTracking();
    if (v.mode === 'chase' && !dronesOut()) setStatus('trace', `${v.owner}'s car has stopped: ${stop.name}. Send the drones there.`);
  },
  onVehicleDepart(v, stop, from) {
    renderTracking();
    // the pick-up is worth a line; leaving a searched stop is not (the report is on the line)
    if (v.mode === 'chase' && !from && !dronesOut()) setStatus('busy', `${v.owner}'s car picked up on the ANPR grid. It is moving -- follow it.`);
  },
  async onScanComplete(m) {
    // the report was requested at launch (see launch()); the flight was the
    // wait. Fall back to asking now if that request never got off the ground.
    let r;
    try {
      r = await (liveFrames.pending || requestSearch(m));
    } catch (e) { r = { found: false, outcome: 'clear', result: 'Link to the flight dropped. Try again.' }; }
    const outcome = outcomeOf(r);
    scene.markSearch(m.lat, m.lng, outcome, r.radius_m || data.config.search_radius_m);
    scene.resolveMission();
    setStatus(outcome, r.result);
    showFootage(photosOf(r), outcome);
    liveFrames.settle(); // the frames over the building fly down into the strip
    // a search result is something the participant can cite to MERCY, the
    // same as anything on Meera's laptop -- tell the console it exists now,
    // along with anything the drones brought back with it (the band's memo).
    const seen = r.id != null ? ['MAP-' + r.id] : [];
    for (const id of r.evidence_ids || []) if (!seen.includes(id)) seen.push(id);
    for (const id of seen) {
      try { window.top.postMessage({ type: 'mercy:evidence-seen', evidence_id: id }, '*'); } catch (e) {}
    }
    if (r.story) data.config = { ...data.config, ...r.story };
    // the trace reveals the band's memo, nothing more: the memo names the
    // driver, and only once it has been played does vehicle tracking unlock
    if (outcome === 'trace' || (r.unlocks || []).includes('vehicle_tracking')) revealMemo();
    // she has been found: the car stops where it is. Any other search at a
    // stop moves the chase on: the server says where the car goes next.
    if (outcome === 'found' && scene.tracked) scene.stopTracking();
    if (vehicle && r.spot_slug && r.spot_slug.startsWith('stop-')) refreshVehicle();
    reportContext();
    addLog({ ...r, outcome, lat: m.lat, lng: m.lng, source: m.meta.source || 'coords', building_name: m.meta.building ? m.meta.building.name : null, searched_at: r.searched_at || new Date().toISOString() });
    // MERCY comes in once the frames have landed in the strip: at the cave it
    // pulls the memo off the band; at the place she is found it sends the units
    if (outcome === 'trace') setTimeout(() => { if (!running && !(memoEl && memoEl.isConnected)) runCaveSequence(r); else memoChip.hidden = false; }, 2000);
    if (outcome === 'found') {
      const name = (m.meta.building && m.meta.building.name) || (scene.tracked && scene.tracked.at && scene.tracked.at.name) || 'the location';
      setTimeout(() => { revealRescue(r, name); if (!running) runRescueSequence(r, name); }, 2000);
    }
  },
};
// the drones are out: flying, scanning or on their way home with a report not yet shown
function dronesOut() { const m = scene.mission; return !!m && m.phase !== 'done' && !m.resolved; }
// POST the search for a mission; the server's answer (outcome, prose, frames)
function requestSearch(m) {
  const body = { lat: m.lat, lng: m.lng, source: m.meta.source || 'coords' };
  if (m.meta.building && Number.isInteger(m.meta.building.id)) body.building_id = m.meta.building.id;
  if (vehicle) body.vehicle = vehicle.slug;   // whose stops answer first
  return fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
}
// --- telling the console where the participant is ------------------------------------
// The console keeps the last screen it was told about and sends it with every
// hint request, so the hint desk answers the place they are standing in rather
// than the story at large. Same channel and same shape as the evidence
// emitter. The map has two screens: the model sitting idle, and something in
// flight over it -- the drones on a search, or a car being followed.
let lastContext = '';
function reportContext() {
  const m = scene.mission, t = scene.tracked;
  let screen = 'map-idle', detail = '';
  if (dronesOut()) {
    const b = m.meta && m.meta.building;
    screen = 'map-search';
    detail = b && b.name ? b.name.toLowerCase() : geo.fmt(m.lat, m.lng);
  } else if (t && !t.frozen) {
    // frozen is the end of the chase (she has been found): nothing is being followed then
    screen = 'map-search';
    detail = `${(t.v.owner || 'the driver').toLowerCase()}'s car`;
  }
  // the tracking tick calls this every second: the same screen goes out once
  const sig = `${screen}|${detail}`;
  if (sig === lastContext) return;
  lastContext = sig;
  try { window.top.postMessage({ type: 'mercy:context', screen, detail }, '*'); } catch (e) {}
}
const scene = new BlueprintScene($('#view3d'), data, geo, hooks);
window.mercyScene = scene;   // for the console: the live model
$('#labels-toggle').addEventListener('change', (e) => { scene.showLabels = e.target.checked; });
$('#cctv-toggle').addEventListener('change', (e) => { scene.setCCTV(e.target.checked); });
$('#props-toggle').addEventListener('change', (e) => { scene.setProps(e.target.checked); });

// --- info card -------------------------------------------------------------------
function select(f, fly = true) {
  if (!f) { info.hidden = true; return; }
  const rows = [];
  let title = f.name || 'Unnamed';
  let kind = KIND_LABEL[f.kind] || KIND_LABEL[f.type] || f.type;
  let searchable = true;
  let stops = null;
  if (f.type === 'building' || f.type === 'you') {
    title = f.name || `${KIND_LABEL[f.kind] || f.kind} building`;
    if (f.type === 'you') kind = 'You · your flat';
    rows.push(['Height', `${Math.round(f.height_m)} m · ${f.floors} floors`], ['Footprint', `${Math.round(f.width_m)} × ${Math.round(f.depth_m)} m`], ['District', (data.districts.find((d) => d.slug === f.district) || {}).name || '—']);
    const near = scene.nearestCamera(f.lat, f.lng);
    rows.push(['Nearest CCTV', near.camera ? `${near.camera.code} · ${near.distance_m} m${near.distance_m > 600 ? ' · NOT COVERED' : ''}` : '—']);
  } else if (f.type === 'tower') {
    kind = `${KIND_LABEL[f.kind] || f.kind} · ${Math.round(f.height_m)} m`;
  } else if (f.type === 'cctv') {
    title = `${f.code} · ${f.name}`; kind = `CCTV camera · ${f.status}`;
    rows.push(['Looks', `${Math.round(f.heading_deg)}° · ${f.fov_deg}° field · ${f.range_m} m range`]);
    searchable = false;
  } else if (f.type === 'district') {
    kind = `District · ${f.kind}`;
    if (f.clicked) f = { ...f, lat: f.clicked.lat, lng: f.clicked.lng };
  } else if (f.type === 'ground') {
    title = 'Point on the model'; kind = 'Terrain';
  } else if (f.type === 'vehicle') {
    // the scene's feature carries the live position; the fetched record carries the rest
    const live = liveVehicleFeature();
    f = { ...(vehicle || {}), ...f, ...(live ? { lat: live.lat, lng: live.lng, building_id: live.building_id } : {}) };
    title = `${f.owner} -- ${f.plate}`; kind = 'Vehicle · tracked live';
    rows.push(['Plate', f.plate], ['Model', f.model || '—'], ['ANPR', f.note || '—'], ['Last seen', `<span id="car-live">${carWhere(f)}</span>`]);
    stops = shownStops();
  } else if (f.type === 'stop') {
    const who = vehicle ? `${vehicle.owner}'s car` : 'the tracked car';
    kind = `Stop ${f.seq}${vehicle && vehicle.chase ? '/' + vehicle.chase.total : ''} · ${who} · ANPR ${f.logged_label || '—'}`;
    rows.push(['Logged', `${f.logged_label || '—'}${f.cctv_code ? ' · ' + f.cctv_code : ''}`]);
    if (f.state === 'searched') rows.push(['Drones', f.outcome === 'found' ? 'MEERA FOUND HERE' : 'searched · no trace']);
    if (vehicle && vehicle.mode === 'loop') rows.push(['Dwell', `${f.dwell_s || 40} s each lap`]);
    if (f.note) rows.push(['Note', f.note]);
  }
  const elev = f.elevation_m !== undefined ? Math.round(f.elevation_m) : Math.round(geo.elevation(f.lat, f.lng));
  if (f.description) rows.push(['About', f.description]);
  rows.push(['Coordinates', geo.fmt(f.lat, f.lng)], ['Elevation', `${elev} m ASL`]);
  info.hidden = false;
  info.innerHTML = `
    <div class="info-head"><div><div class="info-kind ${f.type}">${kind}</div><h2>${title}</h2></div><button id="info-close" aria-label="Close">×</button></div>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    ${stops ? `<ul class="stops">${stopRows(stops)}</ul>` : ''}
    <div class="info-actions"><button id="info-go">Fly here</button>${f.type === 'vehicle' ? '<button id="info-follow">Follow</button>' : ''}${searchable ? '<button id="info-search" class="danger">Send drones</button>' : ''}</div>`;
  $('#info-close').onclick = () => select(null);
  $('#info-go').onclick = () => scene.flyTo(f.lat, f.lng, 500);
  if (f.type === 'vehicle') { $('#info-follow').onclick = () => setFollow(true); syncFollow(); }
  if (stops) bindStopRows(info, stops);
  const isBuilding = f.type === 'building' || f.type === 'you';
  if (searchable) $('#info-search').onclick = () => {
    if (f.type === 'vehicle') return launchAtCar(f);
    if (f.type === 'stop') return launch(f.lat, f.lng, 'building', { id: f.building_id, name: f.name });
    launch(f.lat, f.lng, isBuilding ? 'building' : 'coords', isBuilding ? f : null);
  };
  if (fly) scene.flyTo(f.lat, f.lng, f.type === 'district' ? 2800 : 600);
}

// --- launching a search ----------------------------------------------------------------
function setStatus(state, text) {
  status.dataset.state = state;
  status.textContent = text;
  // a new flight replaces the last report: its frames go with it
  if (state === 'flying') footage.hidden = true;
}
function launch(lat, lng, source, building) {
  const b = data.config.bounds;
  if (!(lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east)) { setStatus('error', 'Those coordinates are outside the model.'); return; }
  const ok = scene.launchSearch(lat, lng, { source, building: building ? { id: building.id, name: building.name } : null });
  if (!ok) { setStatus('busy', 'The flight is still out. Wait for it to report.'); return; }
  // ask for the report now: the frames arrive long before the drones do, and
  // are pinned to the building one by one as the sweep runs (liveFrames)
  liveFrames.begin(requestSearch(scene.mission));
  latIn.value = lat.toFixed(6); lngIn.value = lng.toFixed(6);
  setStatus('flying', `Flight up from Police HQ → ${geo.fmt(lat, lng)}${building && building.name ? ' (' + building.name + ')' : ''}. Threading between the buildings…`);
  info.hidden = true;
  reportContext();
}
$('#launch').onclick = () => {
  const lat = Number(latIn.value), lng = Number(lngIn.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) { setStatus('error', 'Enter a latitude and a longitude.'); return; }
  launch(lat, lng, 'coords');
};
[latIn, lngIn].forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#launch').click(); }));
// the world runs at 3x unless the participant wants to watch it at 1x; the
// sweeps ignore this either way (scene.rate()). The label says what a click does.
speedBtn.onclick = () => { const fast = scene.timeScale !== 1; scene.setTimeScale(fast ? 1 : 3); speedBtn.textContent = fast ? '▶▶ ×3' : '▶ ×1 normal'; };

function addLog(s) {
  const outcome = outcomeOf(s);
  const li = document.createElement('li');
  li.className = outcome;
  li.innerHTML = `<span class="t">${fmtTime(s.searched_at)}</span><div><div class="pl">${GLYPH[outcome] || GLYPH.clear}${s.building_name || geo.fmt(s.lat, s.lng)}</div><div class="pa">${s.result}</div></div>`;
  li.onclick = () => scene.flyTo(s.lat, s.lng, 400);
  log.prepend(li);
}

// --- drone footage ------------------------------------------------------------------------
// Every search comes back with a few frames from the flight: r.photos on POST
// /api/search, and `photos` on the bundle's search rows, each [{url, kind,
// caption}] with kind one of aerial / thermal / ground / detail. The mission
// bar shows the last flight's frames, each log row keeps its own, and any
// frame opens the lightbox over the model. A frame whose file is missing
// becomes a dark tile carrying its kind, so the strip never breaks the layout.
const PHOTO_KINDS = ['aerial', 'thermal', 'ground', 'detail'];
function photosOf(r) {
  let list = r ? r.photos : null;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch (e) { list = null; } }
  if (!Array.isArray(list)) return [];
  return list.filter((p) => p && typeof p.url === 'string' && p.url).map((p) => {
    const kind = String(p.kind || '').toLowerCase();
    return { url: p.url, kind: PHOTO_KINDS.includes(kind) ? kind : 'frame', caption: typeof p.caption === 'string' ? p.caption : '' };
  });
}
function kindTag(kind) {
  const s = document.createElement('span');
  s.className = `ftag ${kind}`;
  s.textContent = kind.toUpperCase();
  return s;
}
// one thumbnail: the frame, its kind tag, a dark tile in its place if the file is missing
function thumb(p, i, all) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `thumb ${p.kind}`;
  b.title = p.caption || `${p.kind} frame`;
  b.setAttribute('aria-label', `${p.kind} frame ${i + 1} of ${all.length}${p.caption ? ': ' + p.caption : ''}`);
  const img = document.createElement('img');
  img.src = p.url; img.alt = p.caption || `${p.kind} frame`; img.loading = 'lazy'; img.decoding = 'async';
  img.onerror = () => { img.remove(); b.classList.add('missing'); };
  b.append(img, kindTag(p.kind));
  b.onclick = (e) => { e.stopPropagation(); openLightbox(all, i); };
  return b;
}
// a row of up to `max` thumbnails; the lightbox still walks the whole set
function photoStrip(photos, max, small) {
  if (!photos.length) return null;
  const row = document.createElement('div');
  row.className = small ? 'footage-row small' : 'footage-row';
  photos.slice(0, max).forEach((p, i) => row.appendChild(thumb(p, i, photos)));
  if (photos.length > max) {
    const more = document.createElement('span');
    more.className = 'more';
    more.textContent = `+${photos.length - max}`;
    row.lastElementChild.appendChild(more);
  }
  return row;
}
// the strip under the mission bar: the frames of the flight that just reported
function showFootage(photos, outcome) {
  footageBody.replaceChildren();
  footage.hidden = !photos.length;
  if (!photos.length) return;
  footage.dataset.state = outcome;
  footageN.textContent = `${photos.length} frame${photos.length === 1 ? '' : 's'}`;
  footageBody.appendChild(photoStrip(photos, 4, false));
}
// --- frames during the sweep ------------------------------------------------------------
// The cinematic beat: while the drones ring the building, its frames are
// revealed one at a time -- a reticle lands on the target, a tether draws out
// from it, and the shot snaps in at the end of the line with a shutter flash.
// The cards ride the building through the orbiting camera in two flanking
// columns that never overlap, and when the flight reports they fly down into
// the footage strip under the mission bar and become its thumbnails. The
// frames are known from launch (the report is requested then); the sweep is
// the reveal.
const CARD = { w: 260, h: 146, dx: 250, dy: 172, gap: 14 };
const liveFrames = {
  pending: null,
  photos: null,
  cards: [],
  layer: null,
  reticle: null,
  begin(promise) {
    this.clear();
    this.pending = promise;
    this.photos = null;
    promise.then((r) => { if (this.pending === promise) this.photos = photosOf(r); }).catch(() => {});
  },
  // p = sweep progress 0..1; frame i is revealed at (i + 0.5) / (N + 0.5)
  tick(p) {
    if (!this.photos || !this.photos.length) return;
    const n = this.photos.length;
    while (this.cards.length < n && p >= (this.cards.length + 0.5) / (n + 0.5)) this.pop(this.cards.length);
    this.place();
  },
  pop(i) {
    if (!this.layer) {
      this.layer = document.createElement('div'); this.layer.id = 'dcards'; view3d.appendChild(this.layer);
      this.reticle = document.createElement('div'); this.reticle.className = 'dret'; this.layer.appendChild(this.reticle);
    }
    const p = this.photos[i];
    const card = document.createElement('div');
    card.className = `dcard ${p.kind}`;
    const img = document.createElement('img');
    img.src = p.url; img.alt = ''; img.decoding = 'async';
    img.onerror = () => { img.remove(); card.classList.add('missing'); };
    const cap = document.createElement('div');
    cap.className = 'dcap';
    cap.textContent = `FRAME ${String(i + 1).padStart(2, '0')} · ${p.kind.toUpperCase()}`;
    const tether = document.createElement('div');
    tether.className = 'dtether';
    // the pop-in scales an inner wrapper: the card itself only ever translates (place())
    const inner = document.createElement('div');
    inner.className = 'dinner';
    inner.append(img, kindTag(p.kind), cap);
    card.append(inner);
    this.layer.append(tether, card);
    this.cards.push({ card, tether, i, born: performance.now() });
    // the pointer first: the reticle pulses on the building, the line draws
    // out over 320 ms, then the shutter fires and the shot lands
    this.reticle.classList.remove('pulse'); void this.reticle.offsetWidth; this.reticle.classList.add('pulse');
    setTimeout(() => {
      if (!card.isConnected || !this.layer) return;   // the flight reported (settle) before the shutter fired
      const flash = document.createElement('div');
      flash.className = 'dflash';
      this.layer.appendChild(flash);
      flash.addEventListener('animationend', () => flash.remove());
    }, 320);
  },
  // two columns flanking the building, cards stacked with a gap, the whole
  // arrangement shifted (not clamped card by card) to stay inside the model
  layout(a) {
    const W = view3d.clientWidth, H = view3d.clientHeight;
    const n = this.photos.length;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const col = i % 2 ? 1 : -1, row = Math.floor(i / 2);
      const rows = Math.ceil((n - (col > 0 ? 1 : 0)) / 2);
      const y0 = a.y - ((rows - 1) * CARD.dy) / 2 - 20;
      pts.push({ x: a.x + col * CARD.dx, y: y0 + row * CARD.dy });
    }
    const minX = Math.min(...pts.map((p) => p.x)) - CARD.w / 2, maxX = Math.max(...pts.map((p) => p.x)) + CARD.w / 2;
    const minY = Math.min(...pts.map((p) => p.y)) - CARD.h / 2, maxY = Math.max(...pts.map((p) => p.y)) + CARD.h / 2;
    const pad = 12, top = 64; // keep clear of the top HUD row
    let sx = 0, sy = 0;
    if (minX < pad) sx = pad - minX; else if (maxX > W - pad) sx = W - pad - maxX;
    if (minY < top) sy = top - minY; else if (maxY > H - pad) sy = H - pad - maxY;
    return pts.map((p) => ({ x: p.x + sx, y: p.y + sy }));
  },
  place() {
    if (!this.cards.length) return;
    const a = scene.scanAnchor();
    if (!a) { this.layer.style.opacity = '0'; return; }
    this.layer.style.opacity = '';
    this.reticle.style.transform = `translate(${a.x}px, ${a.y}px) translate(-50%, -50%)`;
    const pts = this.layout(a);
    const now = performance.now();
    this.cards.forEach(({ card, tether, i, born }) => {
      const { x, y } = pts[i];
      card.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      const dx = x - a.x, dy = y - a.y, len = Math.hypot(dx, dy);
      // the line grows from the reticle to the card over its first 320 ms
      const grow = Math.min(1, (now - born) / 320);
      tether.style.transform = `translate(${a.x}px, ${a.y}px) rotate(${Math.atan2(dy, dx)}rad)`;
      tether.style.width = `${Math.max(0, len - CARD.w * 0.42) * grow}px`;
    });
  },
  // the flight has reported: each card flies to its thumbnail in the strip
  settle() {
    this.pending = null;
    this.photos = null; // the sweep loop keeps ticking for a few frames: nothing may be re-popped
    if (!this.cards.length) return this.clear();
    const thumbs = Array.from(footageBody.querySelectorAll('.thumb'));
    const flying = this.cards;
    this.cards = [];
    if (this.reticle) { this.reticle.remove(); this.reticle = null; }
    const layer = this.layer;
    this.layer = null;
    flying.forEach(({ card, tether }, k) => {
      tether.remove();
      const target = thumbs[Math.min(k, thumbs.length - 1)];
      if (!target) return card.remove();
      const from = card.getBoundingClientRect(), to = target.getBoundingClientRect(), base = view3d.getBoundingClientRect();
      target.classList.add('landing');
      card.classList.add('fly');
      card.style.transition = 'transform 620ms cubic-bezier(.3,.7,.2,1), opacity 620ms ease';
      card.style.transform = `translate(${to.left - base.left + to.width / 2}px, ${to.top - base.top + to.height / 2}px) translate(-50%, -50%) scale(${to.width / Math.max(1, from.width)})`;
      card.style.opacity = '0.15';
      setTimeout(() => { card.remove(); target.classList.remove('landing'); }, 680);
    });
    setTimeout(() => { if (layer && layer.isConnected && layer !== this.layer) layer.remove(); }, 720);
  },
  clear() {
    this.cards.forEach(({ card, tether }) => { card.remove(); tether.remove(); });
    this.cards = [];
    this.reticle = null;
    if (this.layer) { this.layer.remove(); this.layer = null; }
  },
};
const view3d = $('#view3d');

// the lightbox: one frame large, its caption, n / N, arrows and ← → Esc
const lb = { photos: [], i: 0, opener: null };
function openLightbox(photos, i) {
  lb.photos = photos;
  lb.opener = document.activeElement;
  lightbox.hidden = false;
  showFrame(i);
  $('#lb-close').focus();
}
function showFrame(i) {
  const n = lb.photos.length;
  if (!n) return closeLightbox();
  lb.i = ((i % n) + n) % n;
  const p = lb.photos[lb.i];
  lbKind.className = `ftag ${p.kind}`;
  lbKind.textContent = p.kind.toUpperCase();
  lbCount.textContent = `${lb.i + 1} / ${n}`;
  lbCap.textContent = p.caption || '';
  lbImg.className = `lb-img ${p.kind}`;
  const img = document.createElement('img');
  img.src = p.url; img.alt = p.caption || `${p.kind} frame`; img.decoding = 'async';
  img.onerror = () => { if (lbImg.contains(img)) { img.remove(); lbImg.classList.add('missing'); } };
  lbImg.replaceChildren(img);
  $('#lb-prev').disabled = $('#lb-next').disabled = n < 2;
  // warm the neighbours so the arrows feel instant
  for (const j of [lb.i - 1, lb.i + 1]) { const q = lb.photos[((j % n) + n) % n]; if (q && q !== p) new Image().src = q.url; }
}
function closeLightbox() {
  lightbox.hidden = true;
  lbImg.replaceChildren();
  lb.photos = [];
  if (lb.opener && typeof lb.opener.focus === 'function' && document.contains(lb.opener)) lb.opener.focus();
  lb.opener = null;
}
$('#lb-close').onclick = closeLightbox;
$('#lb-prev').onclick = () => showFrame(lb.i - 1);
$('#lb-next').onclick = () => showFrame(lb.i + 1);
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
// the lightbox owns the keyboard while it is up: the model must not fly on
// WASD / arrows underneath it (the scene listens on window, after this)
document.addEventListener('keydown', (e) => {
  if (lightbox.hidden || e.key === 'Tab') return;
  e.stopPropagation();
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowLeft') showFrame(lb.i - 1);
  else if (e.key === 'ArrowRight') showFrame(lb.i + 1);
  else return;
  e.preventDefault();
}, true);

for (const s of data.searches || []) { addLog(s); scene.markSearch(s.lat, s.lng, outcomeOf(s), data.config.search_radius_m); }

// --- vehicle tracking ---------------------------------------------------------------------
// Unlocked by the cave trace (the search response says so, and the bundle says
// so after a reload). The server answers GET /api/vehicles/:slug with 403 until
// then, so nothing here can run early.
let vehicleReq = null;
function enableTracking(slug = 'nikhil') {
  // the memo is the gate, whichever box the name was typed into
  if (!trackingUnlocked && data.config.vehicle_tracking && memoPlayed()) unlockTracking(false);
  if (!trackingUnlocked) { openTracking(); return Promise.resolve(null); }
  if (vehicle && vehicle.slug === slug) return Promise.resolve(vehicle);
  if (!vehicleReq) vehicleReq = loadVehicle(slug).finally(() => { vehicleReq = null; });
  return vehicleReq;
}
async function loadVehicle(slug) {
  let v = null;
  try {
    const res = await fetch(`/api/vehicles/${encodeURIComponent(slug)}`);
    if (res.ok) v = await res.json();
  } catch (e) { v = null; }
  if (!v || !v.slug) { setStatus('error', 'Vehicle tracking is not available yet.'); return null; }
  vehicle = v;
  scene.trackVehicle(v);
  // the car the participant chose survives a reload of the tab, nothing more
  try { sessionStorage.setItem(key('track-slug'), v.slug); } catch (e) {}
  $('#legend-track').hidden = false;
  renderTracking();
  if (!tick) tick = setInterval(tickTracking, 1000);
  planChase(true);
  return v;
}
// The chase. The server names the stop the car goes to next (chase.current)
// and the car waits there, for as long as it takes, until the drones have
// searched it; then the server names the next. Nothing is listed before the
// car has pulled up at it. A found stop ends the chase where it is.
function currentStop() {
  const v = vehicle;
  if (!v || !v.chase || v.chase.current == null) return null;
  return (v.stops || []).find((s) => s.seq === v.chase.current) || null;
}
let chaseTimer = null;
function planChase(fresh) {
  clearTimeout(chaseTimer);
  const v = vehicle;
  if (!v || v.mode !== 'chase') return;
  if (v.chase.found) { scene.stopTracking(); renderTracking(); return; }
  const next = currentStop();
  if (!next) { scene.stopTracking(); renderTracking(); setStatus('trace', 'Every stop has been searched. The car has nothing left to show.'); return; }
  const t = scene.tracked;
  if (t && t.at && t.at.seq === next.seq) return;          // already there, waiting for the drones
  if (t && t.leg && t.leg.dest.seq === next.seq) return;   // already on its way
  // a beat before it pulls away: the participant sees the result land first
  chaseTimer = setTimeout(() => { if (vehicle === v) scene.driveTo(next); }, fresh ? 2500 : 4000);
}
async function refreshVehicle() {
  const v = vehicle;
  if (!v) return;
  try {
    const res = await fetch(`/api/vehicles/${encodeURIComponent(v.slug)}`);
    if (!res.ok || vehicle !== v) return;
    vehicle = await res.json();
    scene.setStops(vehicle.stops);
    renderTracking();
    planChase(false);
  } catch (e) {}
}
// the stops the participant may see: searched ones, and any the car has pulled up at
function shownStops() {
  const v = vehicle;
  if (!v) return [];
  return (v.stops || []).filter((s) => s.state === 'searched' || scene.isRevealed(s.seq));
}
let tick = null;
function tickTracking() {
  syncFollow();
  reportContext();
  const el = $('#car-live'), live = liveVehicleFeature();
  if (el && live) el.textContent = carWhere(live);
  const where = $('#veh-where');
  if (where) { const st = carState(); where.textContent = st.text; where.parentElement.className = `live ${st.cls}`; }
}
// the glow sprite the scene keeps over the car: its feature's lat/lng are rewritten
// every frame and building_id is the stop's building while the car dwells there
function liveVehicleFeature() {
  const o = (scene.pickables || []).find((p) => p.userData && p.userData.feature && p.userData.feature.type === 'vehicle');
  return o ? o.userData.feature : null;
}
function carWhere(l) {
  const t = scene.tracked;
  if (t && t.frozen) return `${geo.fmt(l.lat, l.lng)} · stopped`;
  if (t && t.at) return `stop ${t.at.seq} · ${t.at.name} · ${t.mode === 'chase' ? 'waiting' : 'stopped'}`;
  if (t && t.mode === 'parked') return `${geo.fmt(l.lat, l.lng)} · parked`;
  return `${geo.fmt(l.lat, l.lng)} · moving`;
}
// the one line under the card that says what the car is doing right now
function carState() {
  const t = scene.tracked;
  if (!t) return { cls: 'idle', text: 'Locating…' };
  if (t.frozen) return { cls: 'stopped', text: t.at ? `Stopped · STOP ${t.at.seq} · ${t.at.name}` : 'Stopped' };
  if (t.at) return { cls: 'here', text: t.mode === 'chase' ? `Waiting at STOP ${t.at.seq} · ${t.at.name}` : `At STOP ${t.at.seq} · ${t.at.name}` };
  if (t.leg) return { cls: 'moving', text: 'On the move · follow it' };
  if (t.mode === 'parked') return { cls: 'stopped', text: 'Parked · not going anywhere' };
  return { cls: 'idle', text: 'Located' };
}
// send the drones to where the car is right now: at a stop while it waits there
// (the feature carries that stop's building, so the server matches the stop),
// on the road otherwise
function launchAtCar(f) {
  const live = liveVehicleFeature() || f;
  const t = scene.tracked, stop = t && t.at ? t.at : null;
  if (stop) return launch(stop.lat, stop.lng, 'building', { id: stop.building_id, name: stop.name });
  return launch(live.lat, live.lng, 'coords');
}
function setFollow(on) { scene.followVehicle(on); syncFollow(); }
function syncFollow() {
  const on = !!scene.follow;
  for (const b of document.querySelectorAll('#veh-follow, #info-follow')) b.textContent = on ? 'Unfollow' : 'Follow';
}
// a stop row: searched (with what the drones found), or the car is here (send them), or it was here
function stopRowClass(s) {
  const t = scene.tracked;
  if (s.state === 'searched') return s.outcome === 'found' ? 'found' : 'searched';
  return t && t.at && t.at.seq === s.seq ? 'here' : 'left';
}
const stopRows = (stops) => stops.map((s) => {
  const cls = stopRowClass(s);
  const status = cls === 'found' ? '★ MEERA FOUND HERE' : cls === 'searched' ? '✓ searched · no trace' : cls === 'here' ? '● the car is here' : '○ the car was here';
  const btn = cls === 'searched' || cls === 'found' ? '' : '<button class="send">Send drones</button>';
  return `<li data-seq="${s.seq}" class="${cls}"><span class="tag stopn">STOP ${s.seq}</span><div><div class="pl">${s.name}</div><div class="pa">ANPR ${s.logged_label || '—'}${s.cctv_code ? ' · ' + s.cctv_code : ''}</div><div class="ps">${status}</div></div>${btn}</li>`;
}).join('');
function bindStopRows(root, stops) {
  root.querySelectorAll('li[data-seq]').forEach((li) => {
    const s = stops.find((x) => x.seq === Number(li.dataset.seq));
    if (!s) return;
    li.onclick = () => select({ type: 'stop', ...s });
    const send = li.querySelector('.send');
    if (send) send.onclick = (e) => { e.stopPropagation(); launch(s.lat, s.lng, 'building', { id: s.building_id, name: s.name }); };
  });
}
function renderTracking() {
  const v = vehicle;
  if (!v) return;
  trackPanel.hidden = false;
  document.body.classList.add('tracking-open');
  trackHint.hidden = true;
  trackResults.hidden = true;
  trackQ.value = `${v.owner || ''} · ${v.plate || ''}`;
  const st = carState();
  vehicleCard.innerHTML = `
    <div class="veh">
      <div class="pl" id="veh-show">● ${(v.owner || '').toUpperCase()} · ${v.plate}</div>
      <div class="pa">${v.model || 'vehicle'} · tracked live</div>
      ${v.note ? `<div class="note">${v.note}</div>` : ''}
      <div class="live ${st.cls}"><span class="ldot"></span><span id="veh-where">${st.text}</span></div>
      <div class="row"><button id="veh-follow" class="ghost">Follow</button><button id="veh-search" class="danger">Send drones</button></div>
    </div>`;
  $('#veh-show').onclick = () => select({ type: 'vehicle', ...v });
  $('#veh-follow').onclick = () => setFollow(!scene.follow);
  $('#veh-search').onclick = () => launchAtCar(v);
  const shown = shownStops();
  stopsEl.innerHTML = shown.length ? stopRows(shown)
    : v.mode === 'parked' ? '<li class="none">Parked. It is not going anywhere.</li>'
    : v.mode === 'chase' ? '<li class="none">Follow the car. Every place it stops at is listed here, for the drones.</li>'
    : '<li class="none">Following. Every place it stops at is listed here.</li>';
  bindStopRows(stopsEl, shown);
  syncFollow();
  reportContext();
}

// The button beside the camera presets. The server unlocks tracking at the
// cave trace (data.config.vehicle_tracking); this page keeps it locked a
// beat longer, until the band's memo has been played -- the memo is where
// the name comes from -- and even then nothing is tracked until the
// participant types it. The memo's first play is remembered in localStorage
// ('mercy-sw06-played'), so a reload lands where the story is.
let trackingUnlocked = false;
const memoPlayed = () => store.get(key('mercy-sw06-played')) === '1';
function unlockTracking(announce) {
  data.config.vehicle_tracking = true;
  trackingUnlocked = true;
  trackBtn.classList.remove('locked');
  trackBtn.title = 'Vehicle tracking';
  if (announce) {
    trackBtn.classList.add('pulse');
    setStatus('trace', 'New tool unlocked: VEHICLE TRACKING. Search a name to follow a car.');
  }
}
function openTracking() {
  // the memo was played in another tab: this one catches up
  if (!trackingUnlocked && data.config.vehicle_tracking && memoPlayed()) unlockTracking(false);
  if (!trackingUnlocked) {
    const traced = data.config.vehicle_tracking;
    setStatus('error', traced ? 'Play the band memo first -- it names the driver.' : 'Vehicle tracking is locked: the drones have nothing to follow yet.');
    trackBtn.classList.add('shake');
    setTimeout(() => trackBtn.classList.remove('shake'), 500);
    if (traced) openMemo();
    return;
  }
  trackBtn.classList.remove('pulse');
  trackPanel.hidden = false;
  document.body.classList.add('tracking-open');
  if (!vehicle) { trackQ.value = ''; trackResults.hidden = true; trackHint.hidden = false; }
  trackQ.focus();
}
function closeTracking() { trackPanel.hidden = true; document.body.classList.remove('tracking-open'); }
trackBtn.onclick = () => (trackPanel.hidden ? openTracking() : closeTracking());
$('#track-close').onclick = closeTracking;
let trackTimer = null;
trackQ.addEventListener('input', () => {
  clearTimeout(trackTimer);
  const q = trackQ.value.trim();
  if (!q) { trackResults.hidden = true; return; }
  trackTimer = setTimeout(async () => {
    let rows = [];
    try {
      const { results: list } = await fetch(`/api/map/search?q=${encodeURIComponent(q)}`).then((r) => r.json());
      rows = list.filter((r) => r.type === 'vehicle');
    } catch (e) { rows = []; }
    trackResults.innerHTML = rows.length
      ? rows.map((r) => `<li data-key="${r.key}"><span class="tag vehicle">Car</span><div><div class="pl">${r.name}</div><div class="pa">read by the cameras tonight · click to track</div></div></li>`).join('')
      : '<li class="none">No car on file under that name.</li>';
    trackResults.hidden = false;
    trackResults.querySelectorAll('li[data-key]').forEach((li) => {
      li.onclick = async () => {
        const v = await enableTracking(li.dataset.key);
        if (v) { select({ type: 'vehicle', ...v }); setFollow(true); }
      };
    });
  }, 180);
});
trackQ.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTracking(); });

// --- MERCY's field link -------------------------------------------------------------------
// The overlay MERCY takes the stage with at the two beats the map owns: the
// cave, where it pulls the voice memo off the band and the participant hears
// Nikhil named; and the place Meera is found, where it sends the units and
// the footage comes in. One overlay, one body. A sequence takes the body
// (take() bumps a generation; a sequence that has been superseded stops at
// its next beat), types its lines in one after another, fills a progress bar
// over a set time, and ends on a card. The memo card is built once and kept
// between showings, so closing the overlay and coming back through the chip
// does not restart the audio.
const overlay = $('#mercy-overlay'), overlayBody = $('#mercy-body');
const memoChip = $('#memo-chip'), rescueChip = $('#rescue-chip');
let running = null;        // 'cave' | 'rescue' while a sequence owns the overlay
let activeRescue = null;   // the footage stage on screen: { finish }
const mercyOverlay = {
  gen: 0,
  open() { overlay.hidden = false; $('#mercy-close').focus(); },
  // closing on the footage is skipping it: the case still has to conclude
  close() { overlay.hidden = true; if (activeRescue) activeRescue.finish(); },
  // a new sequence takes the body; whatever a superseded one adds later is dropped
  take() { this.gen++; if (activeRescue) activeRescue.finish(); overlayBody.replaceChildren(); return this.gen; },
  live(g) { return g === this.gen; },
  add(el) { overlayBody.appendChild(el); overlayBody.scrollTop = overlayBody.scrollHeight; return el; },
  wait: (ms) => new Promise((res) => setTimeout(res, ms)),
  // one line, typed in at ~40 ms a character and never longer than 1.2 s
  line(text, cls = '') {
    const el = document.createElement('div');
    el.className = `mline ${cls}`.trim();
    this.add(el);
    return typeInto(el, text);
  },
  // the same line at once -- the header of a replay
  put(text, cls = '') {
    const el = document.createElement('div');
    el.className = `mline ${cls}`.trim();
    el.textContent = text;
    return this.add(el);
  },
  // a bar that fills over `ms`, its sub-label stepping through `subs` as it goes
  bar(label, ms, subs = []) {
    const el = document.createElement('div');
    el.className = 'mbar';
    el.innerHTML = '<div class="mbar-label"><span></span><span class="mbar-sub"></span></div><div class="mbar-track"><div class="mbar-fill"></div></div>';
    el.querySelector('.mbar-label span').textContent = label;
    const fill = el.querySelector('.mbar-fill'), sub = el.querySelector('.mbar-sub');
    this.add(el);
    fill.style.transition = `width ${ms}ms linear`;
    void fill.offsetWidth;   // the empty bar has to be laid out before the transition can leave it
    fill.style.width = '100%';
    subs.forEach((s, i) => setTimeout(() => { sub.textContent = s; }, Math.round((ms * i) / subs.length)));
    return new Promise((res) => setTimeout(() => { el.classList.add('done'); res(); }, ms));
  },
};
function typeInto(el, text) {
  const chars = Array.from(text);
  const per = Math.min(40, 1200 / Math.max(1, chars.length));
  el.classList.add('typing');
  return new Promise((resolve) => {
    let i = 0;
    const step = () => {
      i++;
      el.textContent = chars.slice(0, i).join('');
      if (i < chars.length) return setTimeout(step, per);
      el.classList.remove('typing');
      resolve();
    };
    step();
  });
}
$('#mercy-close').onclick = () => mercyOverlay.close();
// the overlay owns the keyboard while it is up, the same way the lightbox does
document.addEventListener('keydown', (e) => {
  if (overlay.hidden || !lightbox.hidden || e.key === 'Tab') return;
  e.stopPropagation();
  if (e.key === 'Escape') { e.preventDefault(); mercyOverlay.close(); }
}, true);

// --- the cave: the band's memo ----------------------------------------------------------------
// The trace reveals the chip and nothing else; the sequence, two seconds
// after the frames have landed, extracts the memo and hands over the player.
// Its first play is the unlock (unlockTracking): the memo is where the name
// comes from, and the participant has to hear it.
function revealMemo() {
  data.config.vehicle_tracking = true;
  if (!trackingUnlocked) trackBtn.title = 'Play the band memo first';
}
const CAVE_ITEMS = ["Meera's grey zip jacket, folded", 'PulseFit Band 3, strap cut, 3% battery'];
async function runCaveSequence(r) {
  const g = mercyOverlay.take();
  running = 'cave';
  mercyOverlay.open();
  const beat = async (ms) => { await mercyOverlay.wait(ms); return mercyOverlay.live(g); };
  await mercyOverlay.line('MERCY · ON SITE — Cave, Kettle Hill, north face', 'head');
  if (!(await beat(500))) return;
  let items = r.items;
  if (typeof items === 'string') { try { items = JSON.parse(items); } catch (e) { items = null; } }
  const found = (Array.isArray(items) ? items : []).map((it) => it && it.desc).filter((d) => typeof d === 'string' && d);
  await mercyOverlay.line('RECOVERED:', 'label');
  for (const desc of found.length ? found : CAVE_ITEMS) {
    if (!mercyOverlay.live(g)) return;
    await mercyOverlay.line(`› ${desc}`, 'item');
  }
  if (!(await beat(600))) return;
  await mercyOverlay.bar('EXTRACTING BAND MEMORY', 3500, ['mounting flash storage', '1 voice memo · 02:15 · 2:07 · never uploaded', 'decoding', 'playback recovered']);
  if (!(await beat(400))) return;
  mercyOverlay.add(memoCard());
  memoChip.hidden = false;
  running = null;
}
// The player, the transcript that follows the audio, and MERCY's line on the
// first play. Built once per page load and re-attached after that.
let memoEl = null;
function memoCard() {
  if (memoEl) return memoEl;
  const card = document.createElement('div');
  card.id = 'memo-card'; card.className = 'memo-card';
  card.innerHTML = `
    <div class="memo-head">VOICE MEMO · 02:15 · PulseFit Band 3 · SW-06</div>
    <audio id="memo-audio" controls preload="auto" src="/audio/SW-06-band-memo"></audio>
    <button id="memo-play" class="memo-play" type="button">▶ PLAY THE MEMO</button>
    <div id="memo-cues" class="cues"><div class="cue live">Loading the transcript…</div></div>`;
  const audio = card.querySelector('#memo-audio'), play = card.querySelector('#memo-play'), cuesEl = card.querySelector('#memo-cues');
  play.onclick = () => { audio.play().catch(() => {}); };
  audio.addEventListener('play', () => { play.hidden = true; });
  // the transcript: one line per cue, each written out only when the audio
  // reaches it -- the name is heard before it is read
  let cues = [];
  const reveal = () => {
    let live = -1;
    cues.forEach((c, i) => { if (c.t <= audio.currentTime) live = i; });
    Array.from(cuesEl.children).forEach((el, i) => {
      if (i <= live && !el.textContent) el.textContent = cues[i].text;
      el.classList.toggle('live', i === live);
    });
  };
  fetch('/audio/SW-06.json').then((x) => x.json()).then((j) => {
    cues = (j.cues || []).filter((c) => c && Number.isFinite(c.t) && typeof c.text === 'string');
    if (!cues.length) throw new Error('no cues');
    cuesEl.replaceChildren(...cues.map(() => { const d = document.createElement('div'); d.className = 'cue'; return d; }));
    if (j.placeholder) { const f = document.createElement('div'); f.className = 'memo-foot'; f.textContent = j.placeholder; card.appendChild(f); }
    reveal();
  }).catch(() => { cuesEl.innerHTML = '<div class="cue live">Transcript unavailable</div>'; });
  audio.addEventListener('timeupdate', reveal);
  // no recording the browser can play (nothing in public/audio, or a codec it
  // refuses): the transcript stands in for it, so the story is not stuck
  audio.addEventListener('error', () => {
    audio.hidden = true;
    play.textContent = 'READ THE TRANSCRIPT';
    play.onclick = () => { play.hidden = true; cues.forEach((c, i) => { const el = cuesEl.children[i]; if (el) el.textContent = c.text; }); audio.dispatchEvent(new Event('play')); };
    const f = document.createElement('div'); f.className = 'memo-foot';
    f.textContent = 'The recording could not be played: put SW-06-band-memo.m4a, .mp3 or .wav in city-map/public/audio/.';
    card.appendChild(f);
  });
  // the first play is the story beat: the name is out, tracking opens
  audio.addEventListener('play', () => {
    store.set(key('mercy-sw06-played'), '1');
    if (!trackingUnlocked) unlockTracking(true);
    const v = document.createElement('div');
    v.className = 'mline verdict';
    card.insertBefore(v, card.querySelector('.memo-foot'));
    typeInto(v, 'MERCY: Nikhil Rao. His plate is on the ANPR grid. Vehicle tracking is yours -- search the name.');
  }, { once: true });
  memoEl = card;
  return card;
}
// the chip, and the locked tracking button: straight to the player, the
// extraction beats skipped (after a reload there is nothing to extract)
function openMemo() {
  // a running sequence owns the overlay; the chip only brings it back
  if (!running && !(memoEl && memoEl.isConnected)) {
    mercyOverlay.take();
    mercyOverlay.put('MERCY · BAND MEMORY — Cave, Kettle Hill, north face', 'head');
    mercyOverlay.add(memoCard());
  }
  mercyOverlay.open();
}
memoChip.onclick = openMemo;

// --- the rescue --------------------------------------------------------------------------------
// She has been found. MERCY sends the units, the footage comes in (the real
// file at /video/rescue, or the drawn placeholder while there is none), and
// the case closes on a card. The console is told the moment the card is up
// (once per search: 'mercy-rescued'); the button is the participant's way out.
function revealRescue(r, name) {
  rescueChip.hidden = false;
  rescueChip.onclick = () => { if (running) return mercyOverlay.open(); runRescueSequence(r, name, true); };
}
async function runRescueSequence(r, name, replay = false) {
  const g = mercyOverlay.take();
  running = 'rescue';
  mercyOverlay.open();
  const beat = async (ms) => { await mercyOverlay.wait(ms); return mercyOverlay.live(g); };
  if (replay) {
    // the footage again, without the dispatch: she is already safe
    mercyOverlay.put(`MERCY · RESCUE FOOTAGE — ${name}`, 'head');
  } else {
    await mercyOverlay.line(`MERCY · LOCATION CONFIRMED — ${name}`, 'head');
    if (!(await beat(500))) return;
    await mercyOverlay.line('Thermal: one person, alive.');
    if (!(await beat(500))) return;
    await mercyOverlay.bar(`DISPATCHING UNITS · Police HQ → ${name}`, 3000, ['armed response, medic, negotiator', 'ETA 4 min', 'on site']);
    if (!(await beat(400))) return;
  }
  await rescueStage(name);
  if (!mercyOverlay.live(g)) return;
  showCaseSolved(r, name);
  running = null;
}
// The footage stage. Resolves when the video ends, when the placeholder runs
// out, when the participant skips, or when the overlay is closed on it.
function rescueStage(name) {
  return new Promise((resolve) => {
    const stage = document.createElement('div');
    stage.id = 'rescue-stage'; stage.className = 'rescue-stage';
    const box = document.createElement('div');
    box.className = 'rescue-box';
    const video = document.createElement('video');
    video.id = 'rescue-video'; video.controls = true; video.preload = 'auto';
    video.playsInline = true; video.setAttribute('playsinline', '');
    video.src = '/video/rescue';
    const skip = document.createElement('button');
    skip.id = 'rescue-skip'; skip.className = 'rescue-skip'; skip.type = 'button'; skip.textContent = 'Skip ›'; skip.hidden = true;
    box.appendChild(video);
    stage.append(box, skip);
    mercyOverlay.add(stage);
    let placeholder = null, done = false;
    const finish = () => {
      if (done) return;
      done = true;
      activeRescue = null;
      if (placeholder) placeholder.stop();
      try { video.pause(); } catch (e) {}
      skip.remove();
      resolve();
    };
    activeRescue = { finish };
    skip.onclick = finish;
    setTimeout(() => { if (!done) skip.hidden = false; }, 3000);
    // nothing to watch with the overlay closed: straight to the card
    if (overlay.hidden) return finish();
    // no file (the route 404s), or one the browser cannot play: the placeholder
    const fallback = () => {
      if (done || placeholder) return;
      video.remove();
      placeholder = thermalPlaceholder(box, name, finish);
    };
    video.addEventListener('ended', finish);
    video.addEventListener('error', fallback);
    video.play().catch((err) => {
      if (done || placeholder) return;
      // the browser wants a click before sound; anything else is the source
      if (err && err.name === 'NotAllowedError') {
        const btn = document.createElement('button');
        btn.id = 'rescue-play'; btn.className = 'rescue-play'; btn.type = 'button'; btn.textContent = '▶ PLAY';
        btn.onclick = () => { video.play().then(() => btn.remove()).catch(fallback); };
        box.appendChild(btn);
      } else fallback();
    });
  });
}
function showCaseSolved(r, name) {
  const card = document.createElement('div');
  card.id = 'case-solved'; card.className = 'case-solved';
  card.innerHTML = `
    <div class="cs-title">CASE SOLVED</div>
    <div class="cs-lines"><div></div><div>Nikhil Rao — detained</div><div>Arjun Kapoor — the file against you is closed</div></div>
    <button id="solved-return" class="cs-return" type="button">RETURN TO MERCY</button>`;
  card.querySelector('.cs-lines div').textContent = `Meera Kapoor — recovered alive at ${name}`;
  // the button: the console is told (again, harmlessly) and asked to take over
  card.querySelector('#solved-return').onclick = () => {
    postCaseSolved(r, name, true);
    try { window.top.postMessage({ type: 'mercy:return' }, '*'); } catch (e) {}
    mercyOverlay.close();
  };
  mercyOverlay.add(card);
  postCaseSolved(r, name, false);
}
// Tell the console the case is solved -- once per search, unless `always`
// (the button) -- and remember that it has been told.
function postCaseSolved(r, name, always) {
  const id = String(r.id);
  if (!always && store.get(key('mercy-rescued')) === id) return;
  store.set(key('mercy-rescued'), id);
  try { window.top.postMessage({ type: 'mercy:case-solved', evidence_id: 'MAP-' + r.id, stop: name }, '*'); } catch (e) {}
}
// The placeholder footage: a drone's thermal camera, drawn frame by frame for
// ~24 s -- the grain, a slow drift, the reticle sweeping the room and locking,
// her heat signature, the medic's beside it, the two carried out of frame --
// with the timecode, the feed's name and the captions a real cut would carry.
// Returns { stop }; calls onDone when the sequence runs out.
const PH = { w: 640, h: 360, dur: 24, mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' };
const PH_CAPTIONS = [[0, 'UNITS ON SITE'], [5, 'ENTRY — BACK ROOM'], [9, 'SUBJECT LOCATED · ALIVE'], [14, 'MEDIC ATTENDING'], [18, 'EXTRACTION COMPLETE'], [21, 'SUSPECT DETAINED · ON SITE']];
function thermalPlaceholder(box, name, onDone) {
  const W = PH.w, H = PH.h;
  const wrap = document.createElement('div');
  wrap.id = 'rescue-placeholder'; wrap.className = 'rescue-placeholder';
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const foot = document.createElement('div');
  foot.className = 'ph-foot';
  foot.textContent = 'PLACEHOLDER — place rescue.mp4 in city-map/public/video/ for the real footage';
  wrap.append(canvas, foot);
  box.appendChild(wrap);
  const g = canvas.getContext('2d');
  // the grain: a small tile of random greys, redrawn every other frame and scaled up
  const tile = document.createElement('canvas'); tile.width = 160; tile.height = 90;
  const tg = tile.getContext('2d'), grain = tg.createImageData(160, 90);
  const ramp = (a, b, t) => Math.max(0, Math.min(1, (t - a) / (b - a)));
  const ease = (u) => u * u * (3 - 2 * u);
  // a body: white-hot core, amber halo, out to nothing; `heat` is how bright
  const body = (x, y, rx, ry, heat) => {
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    grad.addColorStop(0, `rgba(255,255,255,${heat})`);
    grad.addColorStop(0.35, `rgba(255,232,170,${heat * 0.85})`);
    grad.addColorStop(0.7, `rgba(255,150,50,${heat * 0.4})`);
    grad.addColorStop(1, 'rgba(255,110,30,0)');
    g.save(); g.translate(x, y); g.scale(rx, ry); g.fillStyle = grad; g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill(); g.restore();
  };
  let raf = 0, t0 = 0, frame = 0, stopped = false;
  const stop = () => { stopped = true; cancelAnimationFrame(raf); };
  const draw = (now) => {
    if (stopped) return;
    if (!t0) t0 = now;
    const t = (now - t0) / 1000;
    if (t >= PH.dur) { stop(); onDone(); return; }
    frame++;
    const drift = Math.sin(t * 0.35) * 22 + t * 1.5;   // the drone holding, not quite still
    g.fillStyle = '#121923'; g.fillRect(0, 0, W, H);
    // the room: walls and furniture a shade warmer than the floor
    g.save(); g.translate(-drift, 0);
    g.fillStyle = 'rgba(70,84,104,0.35)';
    g.fillRect(40, 40, 260, 140); g.fillRect(360, 60, 380, 90); g.fillRect(120, 230, 180, 90); g.fillRect(430, 210, 300, 120);
    g.strokeStyle = 'rgba(120,140,170,0.35)'; g.lineWidth = 2;
    g.strokeRect(20, 20, 740, 320); g.beginPath(); g.moveTo(330, 20); g.lineTo(330, 340); g.stroke();
    // her: found at ~6 s, carried down and out of frame from ~14 s; the medic beside her from ~11 s
    const seen = ease(ramp(6, 7.5, t)), carry = ease(ramp(14, 21, t));
    const sx = 470 + Math.sin(t * 0.8) * 4 - carry * 60, sy = 190 + carry * 240;
    if (seen > 0) body(sx, sy, 26 + carry * 8, 40 - carry * 10, seen);
    const medic = ease(ramp(11, 12.5, t));
    if (medic > 0) body(sx - 50 - carry * 10, sy - 6 + Math.sin(t * 2) * 2, 20, 30, medic * 0.55);
    g.restore();
    if (frame % 2 === 0) {
      const d = grain.data;
      for (let i = 0; i < d.length; i += 4) { const v = 90 + Math.random() * 110; d[i] = v; d[i + 1] = v; d[i + 2] = v + 20; d[i + 3] = 255; }
      tg.putImageData(grain, 0, 0);
    }
    g.globalAlpha = 0.16; g.drawImage(tile, 0, 0, W, H); g.globalAlpha = 1;
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.75)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    // the reticle sweeps the room until she is found, then locks on her
    const lock = ease(ramp(8.5, 10, t));
    const rx = (W / 2 + Math.sin(t * 0.9) * 180) * (1 - lock) + (sx - drift) * lock;
    const ry = (H / 2 + Math.cos(t * 0.6) * 90) * (1 - lock) + (sy - 10) * lock;
    const R = 34 - lock * 8, gap = 12;
    g.strokeStyle = lock > 0.5 ? '#ffe08a' : 'rgba(143,220,255,0.9)'; g.lineWidth = 1.5;
    g.beginPath();
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      g.moveTo(rx + dx * R, ry + dy * (R - gap)); g.lineTo(rx + dx * R, ry + dy * R); g.lineTo(rx + dx * (R - gap), ry + dy * R);
    }
    g.moveTo(rx - 6, ry); g.lineTo(rx + 6, ry); g.moveTo(rx, ry - 6); g.lineTo(rx, ry + 6);
    g.stroke();
    g.font = `12px ${PH.mono}`; g.textBaseline = 'top'; g.textAlign = 'left';
    if (lock >= 1) { g.fillStyle = '#ffe08a'; g.fillText('LOCK · 36.8°C', rx + R + 8, ry - R); }
    // the timecode with a blinking REC, and the feed's name
    const ss = String(Math.floor(t)).padStart(2, '0'), ff = String(Math.floor((t % 1) * 25)).padStart(2, '0');
    const tc = `00:00:${ss}:${ff}`;
    g.fillStyle = '#e6edf3'; g.fillText(tc, 14, 12);
    if (Math.floor(t * 2) % 2 === 0) { g.fillStyle = '#ff3b30'; g.beginPath(); g.arc(14 + g.measureText(tc).width + 12, 18, 4, 0, Math.PI * 2); g.fill(); }
    g.textAlign = 'right'; g.fillStyle = '#8fdcff'; g.fillText(`THERMAL · DRONE 2 · ${String(name).toUpperCase()}`, W - 14, 12);
    // the caption bar
    const cap = PH_CAPTIONS.reduce((c, [at, text]) => (t >= at ? text : c), PH_CAPTIONS[0][1]);
    g.fillStyle = 'rgba(2,6,12,0.75)'; g.fillRect(0, H - 56, W, 30);
    g.textAlign = 'left'; g.textBaseline = 'middle'; g.font = `bold 13px ${PH.mono}`;
    g.fillStyle = '#fff'; g.fillText(cap, 14, H - 41);
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  return { stop };
}

// --- places rail ------------------------------------------------------------------------
const ORDER = ['police', 'civic', 'library', 'station', 'stadium', 'theatre', 'university', 'school', 'church', 'temple', 'market', 'fire_station', 'vet', 'auditorium', 'office', 'tech', 'industrial', 'hospital', 'bus_stop', 'cave', 'hill', 'lake', 'park'];
const placesEl = $('#places');
for (const l of [...data.landmarks].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))) {
  const li = document.createElement('li');
  li.innerHTML = `<span class="tag ${l.kind}">${KIND_LABEL[l.kind] || l.kind}</span><div><div class="pl">${l.name}</div><div class="pa">${geo.fmt(l.lat, l.lng)}</div></div>`;
  li.onclick = () => select({ type: 'landmark', ...l });
  placesEl.appendChild(li);
}

// --- search box -------------------------------------------------------------------------
const results = $('#results');
let timer;
searchBox.addEventListener('input', () => {
  clearTimeout(timer);
  const q = searchBox.value.trim();
  if (!q) { results.hidden = true; return; }
  timer = setTimeout(async () => {
    const { results: raw } = await fetch(`/api/map/search?q=${encodeURIComponent(q)}`).then((r) => r.json());
    if (!trackingUnlocked && data.config.vehicle_tracking && memoPlayed()) unlockTracking(false);
    const list = raw.filter((r) => r.type !== 'vehicle' || trackingUnlocked);   // no car is named before the memo has been heard
    results.innerHTML = list.length ? list.map((r, i) => `<li data-i="${i}" class="${r.type}"><b>${r.name}</b><span>${KIND_LABEL[r.kind] || r.type}</span></li>`).join('') : '<li class="none">Nothing found</li>';
    results.hidden = false;
    results.querySelectorAll('li[data-i]').forEach((li) => li.onclick = async () => {
      const r = list[Number(li.dataset.i)];
      results.hidden = true; searchBox.value = r.name;
      if (r.type === 'vehicle') {
        // a person's name resolves to their car: build it (once) and open its card
        const v = await enableTracking(r.key);
        if (v) { select({ type: 'vehicle', ...v }); setFollow(true); }
        return;
      }
      const full = r.type === 'landmark' ? { type: 'landmark', ...data.landmarks.find((l) => l.slug === r.key) }
        : r.type === 'building' ? { type: 'building', ...data.buildings.find((b) => b.id === Number(r.key)) }
        : r.type === 'tower' ? { type: 'tower', ...data.towers.find((t) => t.id === Number(r.key)) }
        : r.type === 'cctv' ? { type: 'cctv', ...data.cctv.find((c) => c.code === r.key) }
        : { type: 'district', ...data.districts.find((d) => d.slug === r.key), lat: r.lat, lng: r.lng };
      select(full);
    });
  }, 180);
});
document.addEventListener('click', (e) => { if (!e.target.closest('.search-wrap')) results.hidden = true; });

// --- quick jumps --------------------------------------------------------------------------
$('#jump-tower').onclick = () => select({ type: 'landmark', ...data.landmarks.find((l) => l.kind === 'police') });
$('#jump-you').onclick = () => { const b = data.buildings.find((x) => x.name === data.config.player_building); if (b) select({ type: 'you', ...b }); };
$('#jump-fit').onclick = () => scene.resetView();
$('#jump-overview').onclick = () => scene.overview();
$('#keys-toggle').onclick = () => { $('#keys').hidden = !$('#keys').hidden; };

$('#city').textContent = `${data.config.city} · ${data.buildings.length.toLocaleString()} buildings · ${data.towers.length} towers · ${data.trees.length.toLocaleString()} trees · ${data.cctv.length} cameras`;

// --- story state on load ------------------------------------------------------------------
// A reset game (docker compose down -v, reset_chase.sql) leaves last game's
// keys in this browser: what the server says has not happened, has not.
if (!data.config.vehicle_tracking) store.remove(key('mercy-sw06-played'));
if (!(data.searches || []).some((s) => outcomeOf(s) === 'found')) store.remove(key('mercy-rescued'));
if (data.config.vehicle_tracking) {
  // the cave has given up its trace: the memo is there to play (again), and
  // tracking is open only if it has been
  revealMemo();
  memoChip.hidden = false;
  if (memoPlayed()) {
    unlockTracking(false);
    // a car the participant already chose this session comes back; nobody is
    // tracked on their behalf
    let slug = null;
    try { slug = sessionStorage.getItem(key('track-slug')); } catch (e) {}
    if (slug) enableTracking(slug);
  }
}
// she has been found: the footage can be watched again, but it never plays itself
const foundSearch = (data.searches || []).find((s) => outcomeOf(s) === 'found');
if (foundSearch) revealRescue(foundSearch, foundSearch.building_name || 'the location');
// the console is told where this tab stands the moment it is ready to be used
reportContext();
