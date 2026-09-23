// The desk (/admin) -- the event run from one screen. Four tabs, each
// refreshed every five seconds while it is the one showing: the
// participants (with the engine's and the map's live numbers next to the
// register's), the leaderboard, the stack's resources, and the event's
// controls with the log under them. The clocks tick every second on their
// own, from the deadlines the last refresh brought.
(function () {
  'use strict';

  const LOBBY_PORT = 3030;
  const B = window.MercyBoard;
  const esc = B.escapeHtml;
  const el = (id) => document.getElementById(id);

  let tab = 'participants';
  let players = []; // the last GET /api/admin/players
  let search = '';
  let busy = false; // one refresh at a time; a slow one is not stacked on

  // ------------------------------------------------------------------ api
  async function api(path, method, body) {
    const r = await fetch(path, {
      method: method || 'GET',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin', cache: 'no-store',
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) { showLogin(); }
    if (!r.ok) { const err = new Error(data.error || `request failed (${r.status})`); err.status = r.status; err.body = data; throw err; }
    return data;
  }
  function showToast(msg, bad) {
    const t = el('toast');
    t.textContent = msg;
    t.classList.toggle('bad', !!bad);
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => (t.hidden = true), bad ? 6000 : 3600);
  }

  // -------------------------------------------------------------- formats
  const pad = (n) => String(n).padStart(2, '0');
  const fmtClock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const fmtStamp = (iso) => (iso ? fmtClock(new Date(iso)) : '');
  function fmtBytes(n) {
    if (n == null || !Number.isFinite(Number(n))) return '-';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = Number(n), i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
  }
  function fmtUptime(s) {
    if (s == null) return '-';
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m`;
  }
  function ago(iso) {
    if (!iso) return '';
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
  }
  const pct = (a, b) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);
  const bar = (p, hot) => `<div class="bar"><i class="${hot ? 'hot' : ''}" style="--p: ${p}%"></i></div>`;

  // ------------------------------------------------------------- the door
  function showLogin() {
    el('login').classList.add('active');
    el('desk').hidden = true;
    setTimeout(() => el('password').focus(), 50);
  }
  function showDesk() {
    el('login').classList.remove('active');
    el('desk').hidden = false;
    refresh();
  }
  el('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = el('login-error'), btn = el('login-btn');
    err.textContent = '';
    btn.disabled = true;
    try {
      await api('/api/admin/login', 'POST', { password: el('password').value });
      el('password').value = '';
      showDesk();
    } catch (ex) {
      err.textContent = ex.status === 401 ? 'Wrong password.' : ex.message;
    } finally {
      btn.disabled = false;
    }
  });
  el('logout-btn').addEventListener('click', async () => {
    try { await api('/api/admin/logout', 'POST', {}); } catch (e) { /* the cookie is gone either way */ }
    showLogin();
  });

  // ----------------------------------------------------------------- tabs
  document.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => setTab(btn.dataset.tab)));
  function setTab(name) {
    tab = name;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('active', s.id === `tab-${name}`));
    try { localStorage.setItem('mercy-admin-tab', name); } catch (e) { /* private mode */ }
    refresh();
  }
  async function refresh() {
    if (busy || el('desk').hidden) return;
    busy = true;
    try {
      if (tab === 'participants') await loadPlayers();
      else if (tab === 'leaderboard') await loadBoard();
      else if (tab === 'resources') await loadResources();
      else if (tab === 'event') await loadEvents();
    } catch (e) {
      if (e.status !== 401) showToast(e.message, true);
    } finally {
      busy = false;
    }
  }

  // --------------------------------------------------------- participants
  async function loadPlayers() {
    players = await api('/api/admin/players');
    renderPlayers();
    el('players-note').textContent = `updated ${fmtClock(new Date())}`;
  }
  function renderCounts() {
    const n = (f) => players.filter(f).length;
    el('n-total').textContent = players.length;
    el('n-new').textContent = n((p) => !p.started_at && !p.outcome);
    el('n-playing').textContent = n((p) => p.started_at && !p.outcome);
    el('n-finished').textContent = n((p) => p.outcome);
    el('n-solved').textContent = n((p) => p.outcome === 'solved');
    el('n-timeout').textContent = n((p) => p.outcome === 'timeout');
    el('n-left').textContent = n((p) => p.outcome === 'left');
  }
  // What the row shows is the register's column, overridden by the live
  // number when the engine or the map answered: guilt, the hint cost,
  // checkpoints and the chase move during a game, the register only learns
  // the end of it. The hint cost shows 0 until the engine reports otherwise.
  function renderPlayers() {
    renderCounts();
    const q = search.trim().toLowerCase();
    const rows = q ? players.filter((p) => p.zinnia_id.toLowerCase().includes(q) || String(p.name).toLowerCase().includes(q)) : players;
    const body = el('players');
    if (!rows.length) { body.innerHTML = `<tr class="empty"><td colspan="13">${players.length ? 'nobody matches' : 'nobody on the list yet -- add them on the right'}</td></tr>`; return; }
    body.innerHTML = rows.map((p) => {
      const L = p.live || {};
      const state = B.stateOf(p);
      const guilt = L.guilt_percent != null ? L.guilt_percent : p.final_guilt;
      const hintCost = L.hint_cost != null ? L.hint_cost : p.hint_cost;
      const hits = L.checkpoints_hit != null ? L.checkpoints_hit : p.checkpoints_hit;
      const total = L.checkpoints_total || 7;
      const playing = state === 'playing';
      const chase = p.provisioned_at
        ? `sos <b>${L.sos_swept == null ? '-' : L.sos_swept}</b> · trace <b class="${L.trace ? 'ok' : ''}">${L.trace ? 'yes' : '-'}</b> · stops <b>${L.stops_searched == null ? '-' : L.stops_searched}</b> · found <b class="${L.found ? 'ok' : ''}">${L.found ? 'yes' : '-'}</b>`
        : '<span class="dim">not provisioned</span>';
      return `<tr class="${playing ? 'playing' : ''}" data-id="${esc(p.zinnia_id)}">
        <td class="id">${esc(p.zinnia_id)}</td>
        <td class="name">${esc(p.name)}${L.last_activity ? `<span class="idle">active ${ago(L.last_activity)}</span>` : ''}</td>
        <td>${B.pill(state)}</td>
        <td class="mono">${p.started_at ? fmtStamp(p.started_at) : '<span class="dim">-</span>'}</td>
        <td class="num left" ${playing && p.deadline ? `data-deadline="${esc(p.deadline)}"` : ''}>${playing && p.deadline ? '' : p.outcome ? B.fmtTime(p.elapsed_s) : '<span class="dim">-</span>'}</td>
        <td class="num">${guilt == null ? '<span class="dim">-</span>' : `${B.fmtGuilt(guilt)}%`}</td>
        <td class="num">${hintCost == null ? '<span class="dim">-</span>' : hintCost}</td>
        <td class="num">${hits == null ? '<span class="dim">-</span>' : `${hits}/${total}`}</td>
        <td class="num">${L.discovered == null ? '<span class="dim">-</span>' : L.discovered}</td>
        <td class="num">${L.searches == null ? '<span class="dim">-</span>' : L.searches}</td>
        <td class="chase">${chase}</td>
        <td class="num">${p.restarts || 0}</td>
        <td class="actions">
          <button class="btn ghost small" type="button" data-act="restart" data-id="${esc(p.zinnia_id)}" data-name="${esc(p.name)}">RESTART</button>
          <button class="btn ghost small" type="button" data-act="delete" data-id="${esc(p.zinnia_id)}" data-name="${esc(p.name)}">DELETE</button>
        </td>
      </tr>`;
    }).join('');
    tickTimes();
  }
  // the live countdowns, from the deadlines the last refresh brought
  function tickTimes() {
    const now = Date.now();
    document.querySelectorAll('td.left[data-deadline]').forEach((td) => {
      const left = (new Date(td.dataset.deadline).getTime() - now) / 1000;
      td.textContent = left <= 0 ? 'TIME UP' : B.fmtTime(left);
      td.classList.toggle('low', left > 0 && left < 120);
    });
    const t = fmtClock(new Date());
    el('clock').textContent = t;
    el('clock-top').textContent = t;
  }
  el('search').addEventListener('input', (e) => { search = e.target.value; renderPlayers(); });
  el('players').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const { act, id, name } = btn.dataset;
    if (act === 'restart') {
      if (!window.confirm(`Restart ${id} (${name})?\n\nTheir game is dropped from every service and rebuilt; their clock and outcome are cleared. They go through the lobby again.`)) return;
      btn.disabled = true;
      try { await api(`/api/admin/players/${encodeURIComponent(id)}/restart`, 'POST', {}); showToast(`${id} RESTARTED`); } catch (ex) { showToast(ex.message, true); }
      await loadPlayers();
    } else if (act === 'delete') {
      if (!window.confirm(`Delete ${id} (${name})?\n\nTheir game is dropped from every service and they leave the list.`)) return;
      btn.disabled = true;
      try { await api(`/api/admin/players/${encodeURIComponent(id)}`, 'DELETE'); showToast(`${id} DELETED`); } catch (ex) { showToast(ex.message, true); }
      await loadPlayers();
    }
  });
  el('create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = el('new-id').value.trim().toUpperCase(), name = el('new-name').value.trim();
    try {
      const r = await api('/api/admin/players', 'POST', { zinnia_id: id, name });
      showToast(r.created ? `${id} ADDED` : `${id} UPDATED`);
      el('new-id').value = '';
      el('new-name').value = '';
      el('new-id').focus();
      await loadPlayers();
    } catch (ex) {
      showToast(ex.message, true);
    }
  });
  el('bulk-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = el('bulk').value;
    if (!text.trim()) return;
    try {
      const r = await api('/api/admin/players', 'POST', { bulk: text });
      const lines = [`${r.created} created, ${r.updated} updated, ${r.rejected.length} rejected`];
      for (const x of r.rejected) lines.push(`<span class="bad">${esc(x.reason)}</span>: ${esc(x.line)}`);
      el('bulk-result').innerHTML = lines.join('\n');
      showToast(`${r.created} CREATED · ${r.updated} UPDATED`);
      if (!r.rejected.length) el('bulk').value = '';
      await loadPlayers();
    } catch (ex) {
      showToast(ex.message, true);
    }
  });

  // ---------------------------------------------------------- leaderboard
  async function loadBoard() {
    const { rows } = await api('/api/leaderboard');
    B.renderRows(el('board'), rows, { top: 3 });
    el('board-note').textContent = `updated ${fmtClock(new Date())}`;
  }

  // ------------------------------------------------------------ resources
  async function loadResources() {
    const r = await api('/api/admin/resources');
    const h = r.host || {};
    el('h-cpus').textContent = h.cpu_count == null ? '-' : h.cpu_count;
    el('h-load').textContent = Array.isArray(h.load) ? h.load.map((x) => Number(x).toFixed(2)).join(' / ') : '-';
    const memUsed = (h.mem_total || 0) - (h.mem_free || 0);
    el('h-mem').textContent = h.mem_total ? `${fmtBytes(memUsed)} of ${fmtBytes(h.mem_total)}` : '-';
    el('h-mem-bar').style.setProperty('--p', `${pct(memUsed, h.mem_total)}%`);
    el('h-mem-bar').classList.toggle('hot', pct(memUsed, h.mem_total) > 90);
    if (h.disk && h.disk.total) {
      const used = h.disk.total - h.disk.free;
      el('h-disk').textContent = `${fmtBytes(used)} of ${fmtBytes(h.disk.total)}`;
      el('h-disk-bar').style.setProperty('--p', `${pct(used, h.disk.total)}%`);
      el('h-disk-bar').classList.toggle('hot', pct(used, h.disk.total) > 90);
    } else {
      el('h-disk').textContent = 'n/a';
      el('h-disk-bar').style.setProperty('--p', '0%');
    }
    el('h-uptime').textContent = fmtUptime(h.uptime_s);
    el('h-docker').textContent = r.docker ? 'socket mounted' : 'no socket';
    el('r-total').textContent = (r.players || {}).total || 0;
    el('r-playing').textContent = (r.players || {}).playing || 0;
    el('r-finished').textContent = (r.players || {}).finished || 0;
    el('r-solved').textContent = (r.players || {}).solved || 0;

    const cs = r.containers || [];
    el('containers-note').textContent = cs.length ? `${cs.length} containers` : (r.docker ? 'none found for this project' : 'mount /var/run/docker.sock to see them');
    el('containers').innerHTML = cs.length ? cs.map((c) => `<tr>
        <td class="mono">${esc(c.service || '-')}</td>
        <td class="dim mono">${esc(c.name)}</td>
        <td><span class="state ${esc(c.state)}">${esc(c.state).toUpperCase()}</span> <span class="dim">${esc(c.status || '')}</span></td>
        <td class="num">${c.cpu_pct == null ? '-' : `${c.cpu_pct.toFixed(1)}%`}</td>
        <td>${c.cpu_pct == null ? '' : bar(Math.min(100, c.cpu_pct), c.cpu_pct > 80)}</td>
        <td class="num">${c.mem_usage == null ? '-' : `${fmtBytes(c.mem_usage)}${c.mem_limit ? ` / ${fmtBytes(c.mem_limit)}` : ''}`}</td>
        <td>${c.mem_usage == null || !c.mem_limit ? '' : bar(pct(c.mem_usage, c.mem_limit), pct(c.mem_usage, c.mem_limit) > 85)}</td>
      </tr>`).join('') : '<tr class="empty"><td colspan="7">no containers to show</td></tr>';

    const ss = r.services || [];
    el('services').innerHTML = ss.length ? ss.map((s) => (s.error
      ? `<tr><td class="mono">${esc(s.service)}</td><td colspan="8" class="err">${esc(s.error)}</td></tr>`
      : `<tr>
        <td class="mono">${esc(s.service)}</td>
        <td class="num">${esc(s.db_size || '-')}</td>
        <td class="num">${s.connections == null ? '-' : s.connections}</td>
        <td class="num">${s.pool ? `${s.pool.total}/${s.pool.idle}/${s.pool.waiting}` : '-'}</td>
        <td class="num">${s.player_schemas == null ? '-' : s.player_schemas}</td>
        <td class="num">${s.requests_last_minute == null ? '-' : s.requests_last_minute}</td>
        <td class="num">${s.requests_total == null ? '-' : s.requests_total}</td>
        <td>${s.template ? '<span class="state running">READY</span>' : '<span class="state created">NOT YET</span>'}</td>
        <td>${s.single_player ? '<span class="state exited">SINGLE PLAYER</span>' : '<span class="state running">EVENT</span>'}</td>
      </tr>`)).join('') : '<tr class="empty"><td colspan="9">no services configured</td></tr>';
    el('res-note').textContent = `updated ${fmtClock(new Date())}`;
    if (r.game_minutes) el('game-minutes').textContent = `${r.game_minutes} MINUTES A GAME`;
  }

  // ---------------------------------------------------------------- event
  el('share-url').textContent = `http://${location.hostname}:${LOBBY_PORT}/`;
  el('share-url').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(el('share-url').textContent); showToast('URL COPIED'); } catch (e) { /* no clipboard here; it is on screen anyway */ }
  });
  async function loadEvents() {
    const { events } = await api('/api/admin/events');
    el('events').innerHTML = (events || []).map((ev) => `<div class="ev">
        <span class="t">${fmtStamp(ev.at)}</span>
        <span class="k ${/fail/.test(ev.kind) ? 'bad' : ''}">${esc(ev.kind)}</span>
        <span class="d">${esc(ev.detail || '')}</span>
      </div>`).join('');
    el('events-note').textContent = `the last ${(events || []).length} · updated ${fmtClock(new Date())}`;
  }
  async function control(btn, label, fn) {
    btn.disabled = true;
    const was = btn.textContent;
    btn.textContent = `${label}…`;
    try { await fn(); } catch (ex) { showToast(ex.message, true); } finally { btn.disabled = false; btn.textContent = was; }
    loadEvents().catch(() => {});
  }
  el('btn-prepare').addEventListener('click', () => control(el('btn-prepare'), 'SEEDING', async () => {
    const r = await api('/api/admin/prepare', 'POST', {});
    showToast(`TEMPLATES READY: ${r.ok.join(', ')}`);
  }));
  el('btn-restart-services').addEventListener('click', () => {
    if (!window.confirm('Restart every app container?\n\nParticipants mid-game see errors for ten seconds or so; their games survive (the databases are not touched).')) return;
    control(el('btn-restart-services'), 'RESTARTING', async () => {
      const r = await api('/api/admin/restart-services', 'POST', {});
      showToast(r.restarted.length ? `RESTARTED: ${r.restarted.join(', ')}` : 'NOTHING RESTARTED', !r.restarted.length);
    });
  });
  el('btn-reset').addEventListener('click', () => {
    const word = window.prompt('This drops EVERY participant\'s game in every service and every template. The list of participants stays.\n\nType RESET to confirm.');
    if (word !== 'RESET') { if (word != null) showToast('NOT RESET -- you did not type RESET', true); return; }
    control(el('btn-reset'), 'RESETTING', async () => {
      const r = await api('/api/admin/reset-event', 'POST', { confirm: 'RESET' });
      showToast(`EVENT RESET · ${r.players_cleared} PLAYERS CLEARED`);
    });
  });

  // --------------------------------------------------------------- start
  (async () => {
    try { tab = localStorage.getItem('mercy-admin-tab') || tab; } catch (e) { /* private mode */ }
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('active', s.id === `tab-${tab}`));
    try {
      await api('/api/admin/events');
      showDesk();
    } catch (e) {
      showLogin();
    }
    setInterval(refresh, 5000);
    setInterval(tickTimes, 1000);
  })();
})();
