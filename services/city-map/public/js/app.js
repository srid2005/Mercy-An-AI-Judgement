import { makeGeo, KIND_LABEL } from './geo.js';
import { BlueprintScene } from './scene3d.js';

const $ = (s) => document.querySelector(s);
const data = await fetch('/api/map/bundle').then((r) => r.json());
const geo = makeGeo(data.config, data.mountains);

const fmtTime = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const readout = $('#readout');
const info = $('#info');
const status = $('#mission');
const log = $('#search-log');
const latIn = $('#lat'), lngIn = $('#lng');
const speedBtn = $('#speed');

const hooks = {
  onHover(p) {
    readout.innerHTML = `<span>LAT ${p.lat.toFixed(5)}</span><span>LNG ${p.lng.toFixed(5)}</span><span>ELEV ${Math.round(p.elevation)} m</span>`;
  },
  onSelect(f) { select(f, false); },
  onDegrade() { $('#props-toggle').checked = false; setStatus('busy', 'Slow frames: trees, props and traffic switched off. Tick "Trees & props" to bring them back.'); },
  onContextLost() { setStatus('error', 'The graphics context was lost. Reloading the model…'); setTimeout(() => location.reload(), 1500); },
  onSearchRequest(f) {
    if (f.type === 'building' || f.type === 'you') return launch(f.lat, f.lng, 'building', f);
    if (f.type === 'district' && f.clicked) return launch(f.clicked.lat, f.clicked.lng, 'coords');
    if (f.lat !== undefined) return launch(f.lat, f.lng, 'coords');
  },
  async onScanComplete(m) {
    const body = { lat: m.lat, lng: m.lng, source: m.meta.source || 'coords' };
    if (m.meta.building && Number.isInteger(m.meta.building.id)) body.building_id = m.meta.building.id;
    let r;
    try {
      r = await fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
    } catch (e) { r = { found: false, result: 'Link to the flight dropped. Try again.' }; }
    scene.markSearch(m.lat, m.lng, !!r.found, r.radius_m || data.config.search_radius_m);
    scene.resolveMission();
    setStatus(r.found ? 'found' : 'clear', r.result);
    speedBtn.hidden = true;
    addLog({ ...r, lat: m.lat, lng: m.lng, source: body.source, building_name: m.meta.building ? m.meta.building.name : null, searched_at: r.searched_at || new Date().toISOString() });
  },
};
const scene = new BlueprintScene($('#view3d'), data, geo, hooks);
$('#labels-toggle').addEventListener('change', (e) => { scene.showLabels = e.target.checked; });
$('#cctv-toggle').addEventListener('change', (e) => { scene.setCCTV(e.target.checked); });
$('#props-toggle').addEventListener('change', (e) => { scene.setProps(e.target.checked); });

// --- info card -------------------------------------------------------------------
function select(f, fly = true) {
  if (!f) { info.hidden = true; return; }
  const elev = f.elevation_m !== undefined ? Math.round(f.elevation_m) : Math.round(geo.elevation(f.lat, f.lng));
  const rows = [];
  let title = f.name || 'Unnamed';
  let kind = KIND_LABEL[f.kind] || KIND_LABEL[f.type] || f.type;
  let searchable = true;
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
  }
  if (f.description) rows.push(['About', f.description]);
  rows.push(['Coordinates', geo.fmt(f.lat, f.lng)], ['Elevation', `${elev} m ASL`]);
  info.hidden = false;
  info.innerHTML = `
    <div class="info-head"><div><div class="info-kind">${kind}</div><h2>${title}</h2></div><button id="info-close" aria-label="Close">×</button></div>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    <div class="info-actions"><button id="info-go">Fly here</button>${searchable ? '<button id="info-search" class="danger">Send drones</button>' : ''}</div>`;
  $('#info-close').onclick = () => select(null);
  $('#info-go').onclick = () => scene.flyTo(f.lat, f.lng, 500);
  const isBuilding = f.type === 'building' || f.type === 'you';
  if (searchable) $('#info-search').onclick = () => launch(f.lat, f.lng, isBuilding ? 'building' : 'coords', isBuilding ? f : null);
  if (fly) scene.flyTo(f.lat, f.lng, f.type === 'district' ? 2800 : 600);
}

// --- launching a search ----------------------------------------------------------------
function setStatus(state, text) {
  status.dataset.state = state;
  status.textContent = text;
}
function launch(lat, lng, source, building) {
  const b = data.config.bounds;
  if (!(lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east)) { setStatus('error', 'Those coordinates are outside the model.'); return; }
  const ok = scene.launchSearch(lat, lng, { source, building: building ? { id: building.id, name: building.name } : null });
  if (!ok) { setStatus('busy', 'The flight is still out. Wait for it to report.'); return; }
  latIn.value = lat.toFixed(6); lngIn.value = lng.toFixed(6);
  setStatus('flying', `Flight up from Police HQ → ${geo.fmt(lat, lng)}${building && building.name ? ' (' + building.name + ')' : ''}. Threading between the buildings…`);
  speedBtn.hidden = false;
  info.hidden = true;
}
$('#launch').onclick = () => {
  const lat = Number(latIn.value), lng = Number(lngIn.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) { setStatus('error', 'Enter a latitude and a longitude.'); return; }
  launch(lat, lng, 'coords');
};
[latIn, lngIn].forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#launch').click(); }));
speedBtn.onclick = () => { const fast = scene.timeScale === 1; scene.setTimeScale(fast ? 4 : 1); speedBtn.textContent = fast ? '×4 ▶ normal' : '▶▶ ×4'; };

function addLog(s) {
  const li = document.createElement('li');
  li.className = s.found ? 'found' : 'clear';
  li.innerHTML = `<span class="t">${fmtTime(s.searched_at)}</span><div><div class="pl">${s.found ? '✔ ' : '✕ '}${s.building_name || geo.fmt(s.lat, s.lng)}</div><div class="pa">${s.result}</div></div>`;
  li.onclick = () => scene.flyTo(s.lat, s.lng, 400);
  log.prepend(li);
}
for (const s of data.searches || []) { addLog(s); scene.markSearch(s.lat, s.lng, s.found, data.config.search_radius_m); }

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
const searchBox = $('#search');
const results = $('#results');
let timer;
searchBox.addEventListener('input', () => {
  clearTimeout(timer);
  const q = searchBox.value.trim();
  if (!q) { results.hidden = true; return; }
  timer = setTimeout(async () => {
    const { results: list } = await fetch(`/api/map/search?q=${encodeURIComponent(q)}`).then((r) => r.json());
    results.innerHTML = list.length ? list.map((r, i) => `<li data-i="${i}"><b>${r.name}</b><span>${KIND_LABEL[r.kind] || r.type}</span></li>`).join('') : '<li class="none">Nothing found</li>';
    results.hidden = false;
    results.querySelectorAll('li[data-i]').forEach((li) => li.onclick = () => {
      const r = list[Number(li.dataset.i)];
      results.hidden = true; searchBox.value = r.name;
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
