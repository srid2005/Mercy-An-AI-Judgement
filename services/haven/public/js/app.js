const token = localStorage.getItem('hav_token');
if (!token) {
  window.location.href = '/index.html';
}

const authHeaders = { Authorization: `Bearer ${token}` };
const mainEl = document.getElementById('main');

let me = null;
let entries = [];
let filter = { year: null, tag: null };

const MOOD = {
  happy: ['😊', 'Happy'],
  calm: ['🙂', 'Calm'],
  tired: ['😴', 'Tired'],
  heavy: ['💔', 'Heavy'],
  reflective: ['🌙', 'Reflective'],
  anxious: ['😟', 'Anxious'],
  afraid: ['😨', 'Afraid'],
};

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtDuration(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtDate(iso, withTime = false) {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  if (!withTime) return date;
  return `${date}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

function monthKey(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

async function api(path) {
  const res = await fetch(path, { headers: authHeaders });
  if (res.status === 401) {
    localStorage.removeItem('hav_token');
    window.location.href = '/index.html';
    throw new Error('unauthorized');
  }
  return res.json();
}

function moodChip(mood) {
  const [emoji, label] = MOOD[mood] || ['', mood];
  return `<span class="mood-chip mood-${mood}">${emoji} ${label}</span>`;
}

// ---------------------------------------------------------------------
// sidebar
// ---------------------------------------------------------------------

function renderSidebar() {
  const years = [...new Set(entries.map((e) => new Date(e.recorded_at).getFullYear()))].sort((a, b) => b - a);
  const counts = {};
  entries.forEach((e) => {
    const y = new Date(e.recorded_at).getFullYear();
    counts[y] = (counts[y] || 0) + 1;
  });
  document.getElementById('year-nav').innerHTML = [
    `<div class="side-item ${filter.year === null ? 'active' : ''}" data-year="all"><span>All entries</span><span class="count">${entries.length}</span></div>`,
    ...years.map((y) => `<div class="side-item ${filter.year === y ? 'active' : ''}" data-year="${y}"><span>${y}</span><span class="count">${counts[y]}</span></div>`),
  ].join('');
  document.querySelectorAll('[data-year]').forEach((el) => {
    el.addEventListener('click', () => {
      filter.year = el.dataset.year === 'all' ? null : Number(el.dataset.year);
      window.location.hash = '#/';
      renderGrid();
      renderSidebar();
    });
  });

  const tagCounts = {};
  entries.forEach((e) => e.tags.forEach((t) => (tagCounts[t] = (tagCounts[t] || 0) + 1)));
  const tags = Object.keys(tagCounts).sort((a, b) => tagCounts[b] - tagCounts[a]);
  document.getElementById('tag-nav').innerHTML = tags
    .map((t) => `<button class="tag ${filter.tag === t ? 'active' : ''}" data-tag="${t}">#${escapeHtml(t)}</button>`)
    .join('');
  document.querySelectorAll('[data-tag]').forEach((el) => {
    el.addEventListener('click', () => {
      filter.tag = filter.tag === el.dataset.tag ? null : el.dataset.tag;
      window.location.hash = '#/';
      renderGrid();
      renderSidebar();
    });
  });

  const used = (me.storage.total_gb * me.storage.used_pct) / 100;
  document.getElementById('storage-card').innerHTML = `
    <div class="storage-title">Storage</div>
    <div class="storage-bar"><div style="width:${me.storage.used_pct}%"></div></div>
    <div class="storage-text">${used.toFixed(1)} GB of ${me.storage.total_gb} GB used</div>
    <button class="link" type="button">Upgrade to Haven Plus</button>`;
  document.getElementById('storage-pill').textContent = `${me.storage.used_pct}% used`;
}

// ---------------------------------------------------------------------
// grid
// ---------------------------------------------------------------------

function cardHtml(e) {
  return `
    <a class="card" href="#/entry/${e.evidence_id}">
      <div class="thumb">
        <img src="${e.poster_url}" alt="" loading="lazy" />
        <span class="play">▶</span>
        <span class="duration">${fmtDuration(e.duration_seconds)}</span>
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(e.title)}</div>
        <div class="card-meta">${fmtDate(e.recorded_at)}</div>
        <div class="card-foot">${moodChip(e.mood)}<span class="evidence-badge">${e.evidence_id}</span></div>
      </div>
    </a>`;
}

function renderGrid() {
  let list = entries;
  if (filter.year !== null) list = list.filter((e) => new Date(e.recorded_at).getFullYear() === filter.year);
  if (filter.tag) list = list.filter((e) => e.tags.includes(filter.tag));

  if (!list.length) {
    mainEl.innerHTML = '<div class="empty">No entries here yet.</div>';
    return;
  }

  const groups = [];
  list.forEach((e) => {
    const key = monthKey(e.recorded_at);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, items: [] };
      groups.push(g);
    }
    g.items.push(e);
  });

  const heading = filter.tag ? `#${escapeHtml(filter.tag)}` : filter.year !== null ? String(filter.year) : 'All entries';
  mainEl.innerHTML = `
    <div class="page-head">
      <h1>${heading}</h1>
      <div class="page-sub">${list.length} recording${list.length === 1 ? '' : 's'}</div>
    </div>
    ${groups
      .map(
        (g) => `
      <section class="month">
        <h2>${g.key}</h2>
        <div class="grid">${g.items.map(cardHtml).join('')}</div>
      </section>`
      )
      .join('')}`;
}

// ---------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------

async function renderEntry(id) {
  mainEl.innerHTML = '<div class="loading">Loading…</div>';
  const e = await api(`/api/entries/${id}`);
  if (e.error) {
    mainEl.innerHTML = '<div class="empty">That recording isn\'t here.</div>';
    return;
  }
  const paragraphs = e.transcript.split(/\n\s*\n/).map((p) => `<p>${escapeHtml(p.trim())}</p>`).join('');

  mainEl.innerHTML = `
    <div class="entry">
      <div class="entry-toolbar">
        <a class="back-btn" href="#/" title="Back">←</a>
        <div class="entry-nav">
          ${e.prev ? `<a href="#/entry/${e.prev.evidence_id}" title="${escapeHtml(e.prev.title)}">‹ Older</a>` : '<span class="disabled">‹ Older</span>'}
          ${e.next ? `<a href="#/entry/${e.next.evidence_id}" title="${escapeHtml(e.next.title)}">Newer ›</a>` : '<span class="disabled">Newer ›</span>'}
        </div>
      </div>
      <div class="player">
        <video controls preload="metadata" poster="${e.poster_url}" src="${e.video_url}"></video>
      </div>
      <div class="entry-head">
        <h1>${escapeHtml(e.title)}</h1>
        <div class="entry-meta">
          <span>${fmtDate(e.recorded_at, true)}</span>
          <span>·</span>
          <span>${fmtDuration(e.duration_seconds)}</span>
          <span>·</span>
          ${moodChip(e.mood)}
        </div>
        <div class="entry-tags">${e.tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}</div>
      </div>
      <div class="transcript">
        <div class="transcript-title">Transcript <span class="auto">auto-generated</span></div>
        ${paragraphs}
      </div>
      <div class="entry-foot">
        <span class="backup">☁ Backed up ${fmtDate(e.backed_up_at, true)} from ${escapeHtml(e.device)}</span>
        <span class="evidence-badge">${e.evidence_id}</span>
      </div>
    </div>`;
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------
// routing
// ---------------------------------------------------------------------

function route() {
  const hash = window.location.hash || '#/';
  const m = hash.match(/^#\/entry\/(HAV-\d{3})$/);
  if (m) return renderEntry(m[1]);
  return renderGrid();
}

(async function init() {
  me = await api('/api/me');
  document.getElementById('nav-avatar').src = me.avatar_url;
  document.getElementById('nav-avatar').addEventListener('click', () => {
    localStorage.removeItem('hav_token');
    window.location.href = '/index.html';
  });
  document.getElementById('menu-btn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
  });

  entries = (await api('/api/entries')).entries;
  renderSidebar();
  window.addEventListener('hashchange', route);
  route();
})();
