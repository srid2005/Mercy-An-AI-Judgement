// MERCY lobby -- the event's front door (see /MULTIPLAYER.md). Two faces:
//
//   * the participant's: log in with a Zinnia ID, watch the intro and the
//     briefing, accept, and be sent to the console with the mercy_sid cookie
//     every service honours; later, /done (their result) and /leaderboard;
//   * the admin's (/admin): create participants, watch them live, restart
//     or delete one, prepare the templates, reset the event, restart the app
//     containers over the Docker socket, read the stack's resources.
//
// The lobby owns one small database (players, admin_events) shared by the
// whole event -- it is not split per participant like the game services --
// and drives those services through their /api/internal endpoints with
// x-internal-key. The clock lives in mercy-engine; the lobby asks it to
// start and is told the outcome.
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const tenant = require('./tenant');
const { pool } = require('./db');

const PORT = process.env.PORT || 3030;
const SECRET = process.env.MERCY_SESSION_SECRET || 'dev-session-secret-change-me';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'mercy-admin';
const GAME_MINUTES = Number(process.env.GAME_MINUTES) > 0 ? Number(process.env.GAME_MINUTES) : 60;
const CONSOLE_PORT = process.env.CONSOLE_PORT || 3020;
const COMPOSE_PROJECT = process.env.COMPOSE_PROJECT || '';
const DOCKER_SOCK = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const DOCKER_API = '/v1.43';
const ADMIN_COOKIE = 'mercy_admin';
const OUTCOMES = new Set(['solved', 'timeout', 'left']);
// The engine's script has seven checkpoints; the admin table shows x/7
// until the engine's summary says otherwise.
const CHECKPOINTS_TOTAL = 7;
// The containers "restart services" may touch: the app services only --
// never a database (its volume is the event) and never the lobby itself
// (it would be restarting the process answering the request).
const RESTARTABLE = ['social-media', 'email', 'whatsapp', 'haven', 'city-map', 'mercy-engine', 'desktop-shell', 'mercy-console'];
// How long the lobby waits on a service. Provisioning replays the seeds
// into `template` the first time -- city-map's is big -- so it gets minutes;
// a summary is one query and gets two seconds, or the admin table stalls.
const T_PROVISION = 180000, T_START = 10000, T_SUMMARY = 2000;

// --- the services -----------------------------------------------------------------------
// SERVICE_URLS: name=url pairs, as the lobby reaches them inside the network.
function services() {
  const raw = process.env.SERVICE_URLS
    || 'social-media=http://localhost:4001,email=http://localhost:4002,whatsapp=http://localhost:4003,haven=http://localhost:4008,city-map=http://localhost:4011,mercy-engine=http://localhost:4010';
  const out = {};
  for (const pair of raw.split(',')) {
    const i = pair.indexOf('=');
    if (i < 0) continue;
    const name = pair.slice(0, i).trim(), url = pair.slice(i + 1).trim().replace(/\/+$/, '');
    if (name && url) out[name] = url;
  }
  return out;
}
async function callService(name, method, p, body, timeoutMs) {
  const base = services()[name];
  if (!base) throw new Error(`${name}: not in SERVICE_URLS`);
  let res;
  try {
    res = await fetch(base + p, {
      method,
      headers: { 'x-internal-key': tenant.INTERNAL_KEY, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs || T_START),
    });
  } catch (err) {
    throw new Error(`${name}: ${err.name === 'TimeoutError' ? 'timed out' : err.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`${name}: ${data.error || res.statusText || res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}
// The same call to every service at once. Nothing short-circuits: a service
// that is down is reported by name next to the ones that answered.
async function fanOut(method, p, body, timeoutMs) {
  const names = Object.keys(services());
  const settled = await Promise.allSettled(names.map((n) => callService(n, method, p, body, timeoutMs)));
  const ok = [], failed = [];
  settled.forEach((r, i) => (r.status === 'fulfilled' ? ok.push(names[i]) : failed.push({ name: names[i], error: r.reason.message })));
  return { ok, failed };
}
const provisionAll = (id) => fanOut('POST', '/api/internal/players', { id }, T_PROVISION);
const deprovisionAll = (id) => fanOut('DELETE', `/api/internal/players/${encodeURIComponent(id)}`, null, T_PROVISION);
const startClock = (id) => callService('mercy-engine', 'POST', `/api/internal/players/${encodeURIComponent(id)}/start`, { minutes: GAME_MINUTES }, T_START);
// a participant's live summary from one service; null when it is down or
// they are not provisioned there (404), because the admin table must render
async function summaryOf(name, id) {
  try {
    return await callService(name, 'GET', `/api/internal/players/${encodeURIComponent(id)}/summary`, null, T_SUMMARY);
  } catch (err) {
    return null;
  }
}
// The host the participant reached us on, without the port: every URL we
// hand them (the console, the reset pages) is another port of that host.
function hostOf(req) {
  const raw = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  try {
    return new URL(`http://${raw}`).hostname;
  } catch (err) {
    return 'localhost';
  }
}
function consoleUrl(req) {
  return `http://${hostOf(req)}:${CONSOLE_PORT}/`;
}

// --- the register ----------------------------------------------------------------------------
async function logEvent(kind, detail) {
  try {
    await pool.query('INSERT INTO admin_events (kind, detail) VALUES ($1, $2)', [kind, detail == null ? null : String(detail)]);
  } catch (err) {
    console.error('[mercy-lobby] admin_events:', err.message);
  }
}
const statusOf = (row) => (row.outcome ? 'finished' : row.started_at ? 'playing' : 'new');
async function playerRow(id) {
  const { rows } = await pool.query('SELECT * FROM players WHERE zinnia_id = $1', [id]);
  return rows[0] || null;
}
// The leaderboard's order: whoever closed the file; then the hint budget
// they had left, highest first -- points are what a participant spends to
// be told where to look, so a rescue nobody had to be walked through beats
// one that was -- and only then the clock. Both of those keys are read off
// a closed file alone: a game still running holds its untouched 100, which
// would seat it above everyone who actually finished, and the register's
// copy is stale until the outcome report anyway. Under them the old order
// stands -- where they left the needle, lowest first, then how far down the
// script they got -- and it is still what sorts the participants at the
// desk, who trail at the bottom on NULLS LAST. Nobody is hidden: names are
// public at the event.
const LEADERBOARD_SQL = `
  SELECT zinnia_id, name, outcome, elapsed_s, final_guilt, checkpoints_hit, points, started_at,
         (row_number() OVER (ORDER BY COALESCE(outcome = 'solved', false) DESC,
                                     CASE WHEN outcome IS NOT NULL THEN points END DESC NULLS LAST,
                                     CASE WHEN outcome = 'solved' THEN elapsed_s END ASC NULLS LAST,
                                     final_guilt ASC NULLS LAST,
                                     checkpoints_hit DESC NULLS LAST,
                                     started_at ASC NULLS LAST, name ASC))::int AS rank
  FROM players ORDER BY rank`;
async function leaderboard() {
  const { rows } = await pool.query(LEADERBOARD_SQL);
  return rows.map((r) => ({ ...r, final_guilt: r.final_guilt == null ? null : Number(r.final_guilt) }));
}
const numGuilt = (row) => (row && row.final_guilt != null ? Number(row.final_guilt) : null);

// --- cookies ---------------------------------------------------------------------------------
function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch (err) { /* a cookie we did not set */ }
  }
  return out;
}
// the participant: the mercy_sid cookie the lobby itself set at login
function participant(req, res, next) {
  const id = tenant.verifyToken(cookies(req)[tenant.COOKIE]);
  if (!id) return res.status(401).json({ error: 'no participant session', login: true });
  req.playerId = id;
  next();
}
// The admin: mercy_admin = admin.<issued>.<hmac>, signed the way mercy_sid
// is (HMAC-SHA256, the session secret) but over the password too, so
// changing ADMIN_PASSWORD logs every admin panel out.
function adminSign(payload) {
  return crypto.createHmac('sha256', SECRET).update(`${payload}.${ADMIN_PASSWORD}`).digest('base64url');
}
function adminCookieHeader() {
  const payload = `admin.${Date.now()}`;
  return `${ADMIN_COOKIE}=${payload}.${adminSign(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${12 * 3600}`;
}
const clearAdminCookieHeader = () => `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest(), hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function adminOk(req) {
  const token = cookies(req)[ADMIN_COOKIE];
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'admin') return false;
  const issued = Number(parts[1]);
  if (!Number.isFinite(issued) || Date.now() - issued > 12 * 3600 * 1000) return false;
  return safeEqual(adminSign(`${parts[0]}.${parts[1]}`), parts[2]);
}
function admin(req, res, next) {
  if (!adminOk(req)) return res.status(401).json({ error: 'admin login required', login: true });
  next();
}
const internal = (req, res, next) => (req.headers['x-internal-key'] === tenant.INTERNAL_KEY ? next() : res.status(403).json({ error: 'missing or invalid x-internal-key' }));

// --- the Docker Engine API ----------------------------------------------------------------------
// Over the unix socket compose mounts (docker-compose.yml). Absent socket:
// the resources page shows no containers and "restart services" answers 503.
function dockerRequest(method, p, body) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(DOCKER_SOCK)) {
      const err = new Error(`the Docker socket is not mounted at ${DOCKER_SOCK}`);
      err.code = 'NO_SOCKET';
      return reject(err);
    }
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      socketPath: DOCKER_SOCK, path: DOCKER_API + p, method,
      headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {},
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (err) { data = { raw: text }; }
        if (res.statusCode >= 400) return reject(new Error(`docker ${method} ${p}: ${res.statusCode} ${(data && data.message) || text}`));
        resolve(data);
      });
    });
    req.setTimeout(8000, () => req.destroy(new Error(`docker ${method} ${p}: timed out`)));
    req.on('error', (err) => reject(new Error(`docker ${method} ${p}: ${err.message}`)));
    if (payload) req.write(payload);
    req.end();
  });
}
// The stack's containers: those labelled with our compose project, or --
// when that label matches nothing, because the checkout was renamed -- any
// container carrying a compose service label at all.
async function stackContainers() {
  const query = (filters) => dockerRequest('GET', `/containers/json?all=1&filters=${encodeURIComponent(JSON.stringify(filters))}`);
  // only this project's containers: a wrong COMPOSE_PROJECT shows an empty list, never someone else's stack
  const list = COMPOSE_PROJECT ? await query({ label: [`com.docker.compose.project=${COMPOSE_PROJECT}`] }) : [];
  return list.map((c) => ({
    id: c.Id, name: (c.Names && c.Names[0] ? c.Names[0] : c.Id.slice(0, 12)).replace(/^\//, ''),
    service: (c.Labels && c.Labels['com.docker.compose.service']) || null, state: c.State, status: c.Status,
  }));
}
// CPU% the way `docker stats` computes it, from the two samples a
// stream=false read carries; memory less the page cache, cgroup v1 or v2.
function containerUsage(s) {
  const cpu = s.cpu_stats || {}, pre = s.precpu_stats || {}, mem = s.memory_stats || {};
  const cpuDelta = ((cpu.cpu_usage || {}).total_usage || 0) - ((pre.cpu_usage || {}).total_usage || 0);
  const sysDelta = (cpu.system_cpu_usage || 0) - (pre.system_cpu_usage || 0);
  const ncpu = cpu.online_cpus || ((cpu.cpu_usage || {}).percpu_usage || []).length || 1;
  const cpu_pct = cpuDelta > 0 && sysDelta > 0 ? Math.round((cpuDelta / sysDelta) * ncpu * 1000) / 10 : 0;
  const cache = (mem.stats && (mem.stats.cache != null ? mem.stats.cache : mem.stats.inactive_file)) || 0;
  return { cpu_pct, mem_usage: Math.max(0, (mem.usage || 0) - cache), mem_limit: mem.limit || null };
}

// --- the app -----------------------------------------------------------------------------------
const app = express();
app.set('x-service', 'mercy-lobby');
tenant.guardApp(app);
// Only the stack's own front-ends (other ports of the host we were reached
// on) may call the API with credentials from the browser; anyone else gets
// no CORS headers at all, which keeps the admin endpoints off-limits to a
// page from elsewhere. The lobby's own pages are same-origin anyway.
app.use(cors((req, cb) => {
  let ok = false;
  try { ok = !!req.headers.origin && new URL(req.headers.origin).hostname === hostOf(req); } catch (err) { ok = false; }
  cb(null, { origin: ok, credentials: true });
}));
app.use(express.json({ limit: '256kb' }));
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use(express.static(path.join(__dirname, 'public')));
// the pages, at their event addresses (index.html is / through the static above)
const page = (file) => (req, res) => res.sendFile(path.join(__dirname, 'public', file));
app.get('/done', page('done.html'));
app.get('/leaderboard', page('leaderboard.html'));
app.get('/admin', page('admin.html'));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'mercy-lobby' }));

// ---------------------------------------------------------------------------
// The participant.
// ---------------------------------------------------------------------------
app.post('/api/login', async (req, res) => {
  const id = tenant.normalizeId((req.body || {}).zinnia_id);
  if (!id) return res.status(400).json({ error: 'Enter a Zinnia ID like ZIN26-0158.' });
  const row = await playerRow(id);
  if (!row) return res.status(404).json({ error: 'This Zinnia ID is not on the list. Ask the desk.' });
  // A finished participant may come back for /done, but their game is not
  // rebuilt for it: the outcome stands.
  if (!row.outcome) {
    const { failed } = await provisionAll(id);
    if (failed.length) {
      const names = failed.map((f) => f.name).join(', ');
      await logEvent('provision_failed', `${id}: ${failed.map((f) => f.error).join('; ')}`);
      return res.status(502).json({ error: `Your game could not be set up (${names}). Ask the desk.`, failed: failed.map((f) => f.name) });
    }
    await pool.query('UPDATE players SET provisioned_at = COALESCE(provisioned_at, now()) WHERE zinnia_id = $1', [id]);
  }
  await logEvent('login', `${id} (${row.name}) ${statusOf(row)}`);
  res.set('Set-Cookie', tenant.cookieHeader(id));
  res.json({ id, name: row.name, status: statusOf(row), minutes: GAME_MINUTES });
});

// "Accept & continue": the engine starts the clock (idempotent -- a clock
// already running is not restarted) and the lobby remembers what it said.
app.post('/api/start', participant, async (req, res) => {
  const id = req.playerId;
  const row = await playerRow(id);
  if (!row) return res.status(404).json({ error: 'This Zinnia ID is no longer on the list. Ask the desk.', login: true });
  if (row.outcome) return res.status(409).json({ error: 'This game is over.', outcome: row.outcome });
  let clock;
  try {
    clock = await startClock(id);
  } catch (err) {
    await logEvent('start_failed', `${id}: ${err.message}`);
    return res.status(502).json({ error: 'The clock could not be started. Ask the desk.', detail: err.message });
  }
  const startedAt = clock.started_at || new Date().toISOString();
  const deadline = clock.deadline || new Date(new Date(startedAt).getTime() + GAME_MINUTES * 60000).toISOString();
  await pool.query('UPDATE players SET started_at = COALESCE(started_at, $2), deadline = COALESCE(deadline, $3) WHERE zinnia_id = $1', [id, startedAt, deadline]);
  if (!row.started_at) await logEvent('start', `${id} (${row.name}) deadline ${deadline}`);
  res.json({ started_at: startedAt, deadline, console_url: consoleUrl(req) });
});

app.get('/api/me', participant, async (req, res) => {
  const id = req.playerId;
  const [row, board, live] = await Promise.all([playerRow(id), leaderboard(), summaryOf('mercy-engine', id)]);
  if (!row) return res.status(404).json({ error: 'This Zinnia ID is no longer on the list.', login: true });
  const mine = board.find((r) => r.zinnia_id === id);
  const final = numGuilt(row);
  res.json({
    id, name: row.name, status: statusOf(row),
    started_at: row.started_at, deadline: row.deadline, ended_at: row.ended_at,
    outcome: row.outcome, elapsed_s: row.elapsed_s,
    // the standing: final once the file is closed, else whatever the engine
    // says right now, else unknown (the engine is down or they never started)
    guilt_percent: final != null ? final : live && live.guilt_percent != null ? Number(live.guilt_percent) : null,
    final_guilt: final,
    checkpoints_hit: row.checkpoints_hit != null ? row.checkpoints_hit : live && live.checkpoints_hit != null ? live.checkpoints_hit : null,
    checkpoints_total: (live && live.checkpoints_total) || CHECKPOINTS_TOTAL,
    restarts: row.restarts, rank: mine ? mine.rank : null, players: board.length,
    console_url: consoleUrl(req),
  });
});

app.get('/api/leaderboard', async (req, res) => {
  res.json({ rows: await leaderboard() });
});

app.post('/api/logout', (req, res) => {
  res.set('Set-Cookie', tenant.clearCookieHeader());
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// The engine reports how a game ended. The first report stands -- the
// engine may say it twice, timeout after left -- except that a rescue
// closes the file whatever was written before it.
// ---------------------------------------------------------------------------
app.post('/api/internal/outcome', internal, async (req, res) => {
  const b = req.body || {};
  const id = tenant.normalizeId(b.id);
  if (!id) return res.status(400).json({ error: 'a Zinnia ID like ZIN26-0158 is required' });
  if (!OUTCOMES.has(b.outcome)) return res.status(400).json({ error: "outcome must be 'solved', 'timeout' or 'left'" });
  const row = await playerRow(id);
  if (!row) return res.status(404).json({ error: 'unknown participant' });
  if (row.outcome && !(b.outcome === 'solved' && row.outcome !== 'solved')) {
    return res.json({ ok: true, outcome: row.outcome, kept: true });
  }
  // a null from the engine (a file closed before the clock ever started) stays
  // null -- Number(null) is 0, and 0 seconds would top the board
  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const guilt = num(b.guilt_percent) == null ? null : Math.min(100, Math.max(0, num(b.guilt_percent)));
  const hits = Number.isInteger(num(b.checkpoints_hit)) ? num(b.checkpoints_hit) : null;
  const elapsed = num(b.elapsed_s) != null ? Math.round(num(b.elapsed_s)) : (row.started_at ? Math.round((Date.now() - new Date(row.started_at).getTime()) / 1000) : null);
  // The hint budget they finished with. It is a ranking key, so it is never
  // a debt however the engine's arithmetic went; an engine that does not
  // report it at all leaves the row's 100 rather than nulling the column.
  const points = num(b.points) == null ? null : Math.max(0, Math.round(num(b.points)));
  await pool.query(
    'UPDATE players SET outcome = $2, final_guilt = $3, checkpoints_hit = $4, elapsed_s = $5, points = COALESCE($6, points), ended_at = now() WHERE zinnia_id = $1',
    [id, b.outcome, guilt, hits, elapsed, points]
  );
  await logEvent('outcome', `${id} (${row.name}) ${b.outcome} guilt ${guilt == null ? '?' : guilt.toFixed(1)}% checkpoints ${hits == null ? '?' : hits} points ${points == null ? '?' : points} elapsed ${elapsed == null ? '?' : elapsed}s`);
  res.json({ ok: true, outcome: b.outcome, kept: false });
});

// ---------------------------------------------------------------------------
// The admin.
// ---------------------------------------------------------------------------
app.post('/api/admin/login', async (req, res) => {
  const password = String((req.body || {}).password || '');
  if (!password || !safeEqual(password, ADMIN_PASSWORD)) return res.status(401).json({ error: 'wrong password' });
  await logEvent('admin_login', hostOf(req));
  res.set('Set-Cookie', adminCookieHeader());
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => {
  res.set('Set-Cookie', clearAdminCookieHeader());
  res.json({ ok: true });
});

// Every row, with what the engine and the map know right now. The two
// summaries per participant run in parallel with a short timeout each, so a
// service that is down costs the table two seconds and empty columns, not
// a hang; an unprovisioned participant is not asked about at all.
app.get('/api/admin/players', admin, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM players ORDER BY created_at, zinnia_id');
  const live = await Promise.all(rows.map(async (row) => {
    if (!row.provisioned_at) return { engine: null, map: null };
    const [engine, map] = await Promise.all([summaryOf('mercy-engine', row.zinnia_id), summaryOf('city-map', row.zinnia_id)]);
    return { engine, map };
  }));
  const pick = (o, k) => (o && o[k] !== undefined ? o[k] : null);
  res.json(rows.map((row, i) => {
    const { engine, map } = live[i];
    return {
      ...row, final_guilt: numGuilt(row), status: statusOf(row),
      live: {
        guilt_percent: pick(engine, 'guilt_percent') == null ? null : Number(engine.guilt_percent), concluded: pick(engine, 'concluded'), outcome: pick(engine, 'outcome'),
        // the budget as it is being spent; the register's column is only the
        // number the outcome report left behind
        points: pick(engine, 'points') == null ? null : Number(engine.points),
        time_left_s: pick(engine, 'time_left_s'), checkpoints_hit: pick(engine, 'checkpoints_hit'), checkpoints_total: pick(engine, 'checkpoints_total'),
        discovered: pick(engine, 'discovered'), transcript_turns: pick(engine, 'transcript_turns'), last_activity: pick(engine, 'last_activity'),
        searches: pick(map, 'searches'), sos_swept: pick(map, 'sos_swept'), trace: pick(map, 'trace'), stops_searched: pick(map, 'stops_searched'), found: pick(map, 'found'),
      },
    };
  }));
});

// One participant, or many pasted in: "ZIN26-0158, Name" per line, the id
// and the name split by a comma, a tab or a space. A known id gets its name
// updated. Nothing is provisioned here -- that happens when they log in.
function parseBulk(text) {
  const entries = [], rejected = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(ZIN\d{2}-\d{4})(?:\s*[,;\t]\s*|\s+)(.+)$/i);
    if (!m) { rejected.push({ line, reason: tenant.ID_RE.test(line.toUpperCase()) ? 'no name' : 'not "ZIN26-0158, Name"' }); continue; }
    entries.push({ zinnia_id: m[1].toUpperCase(), name: m[2].trim().replace(/^["']|["']$/g, '').trim() });
  }
  return { entries, rejected };
}
app.post('/api/admin/players', admin, async (req, res) => {
  const b = req.body || {};
  let entries = [], rejected = [];
  if (b.bulk != null) {
    ({ entries, rejected } = parseBulk(b.bulk));
  } else {
    const id = tenant.normalizeId(b.zinnia_id), name = String(b.name || '').trim();
    if (!id) return res.status(400).json({ error: 'a Zinnia ID like ZIN26-0158 is required' });
    if (!name) return res.status(400).json({ error: 'a name is required' });
    entries.push({ zinnia_id: id, name });
  }
  let created = 0, updated = 0;
  for (const e of entries) {
    if (!e.name) { rejected.push({ line: e.zinnia_id, reason: 'no name' }); continue; }
    const { rows } = await pool.query(
      'INSERT INTO players (zinnia_id, name) VALUES ($1, $2) ON CONFLICT (zinnia_id) DO UPDATE SET name = EXCLUDED.name RETURNING (xmax = 0) AS inserted',
      [e.zinnia_id, e.name.slice(0, 80)]
    );
    if (rows[0].inserted) created++; else updated++;
  }
  if (created || updated) await logEvent('players_added', `${created} created, ${updated} updated${rejected.length ? `, ${rejected.length} rejected` : ''}`);
  res.json({ created, updated, rejected });
});

// A fresh game for one participant: every service drops and rebuilds their
// schema, the register forgets their clock and outcome, their cookie stays
// valid -- they go through the lobby again and accept a new clock.
app.post('/api/admin/players/:id/restart', admin, async (req, res) => {
  const id = tenant.normalizeId(req.params.id);
  if (!id) return res.status(400).json({ error: 'bad id' });
  const row = await playerRow(id);
  if (!row) return res.status(404).json({ error: 'unknown participant' });
  const down = await deprovisionAll(id);
  const up = down.failed.length ? { ok: [], failed: [] } : await provisionAll(id);
  const failed = [...down.failed, ...up.failed];
  if (failed.length) {
    await logEvent('restart_failed', `${id}: ${failed.map((f) => f.error).join('; ')}`);
    return res.status(502).json({ error: `restart incomplete: ${failed.map((f) => f.name).join(', ')}`, failed });
  }
  const { rows } = await pool.query(
    `UPDATE players SET provisioned_at = now(), started_at = NULL, deadline = NULL, ended_at = NULL, outcome = NULL,
       final_guilt = NULL, checkpoints_hit = NULL, elapsed_s = NULL, points = 100, restarts = restarts + 1
     WHERE zinnia_id = $1 RETURNING *`, [id]);
  await logEvent('restart', `${id} (${row.name}) restart #${rows[0].restarts}`);
  res.json({ ok: true, player: { ...rows[0], final_guilt: null, status: 'new' } });
});

app.delete('/api/admin/players/:id', admin, async (req, res) => {
  const id = tenant.normalizeId(req.params.id);
  if (!id) return res.status(400).json({ error: 'bad id' });
  const row = await playerRow(id);
  if (!row) return res.status(404).json({ error: 'unknown participant' });
  // always: a login that failed half-way leaves schemas behind and no provisioned_at
  const { failed } = await deprovisionAll(id);
  if (failed.length) {
    await logEvent('delete_failed', `${id}: ${failed.map((f) => f.error).join('; ')}`);
    return res.status(502).json({ error: `their game could not be dropped from: ${failed.map((f) => f.name).join(', ')}`, failed });
  }
  await pool.query('DELETE FROM players WHERE zinnia_id = $1', [id]);
  await logEvent('delete', `${id} (${row.name})`);
  res.json({ ok: true });
});

// Seed every service's template now, while the room is still empty, so the
// first login does not pay for the replay.
app.post('/api/admin/prepare', admin, async (req, res) => {
  const r = await fanOut('POST', '/api/internal/template', null, T_PROVISION);
  await logEvent('prepare', r.failed.length ? `failed: ${r.failed.map((f) => `${f.name} (${f.error})`).join(', ')}` : `templates ready: ${r.ok.join(', ')}`);
  res.status(r.failed.length ? 502 : 200).json(r);
});

// The event reset: every participant schema and every template are dropped
// (the seeds' story clock re-anchors to the day of the next provision), and
// every row's game columns are cleared. The rows stay: the list is the
// event's, the games are not. The body must say so in as many words.
app.post('/api/admin/reset-event', admin, async (req, res) => {
  if ((req.body || {}).confirm !== 'RESET') return res.status(400).json({ error: "send { confirm: 'RESET' }" });
  const r = await fanOut('POST', '/api/internal/reset', null, T_PROVISION);
  if (r.failed.length) {
    await logEvent('reset_event_failed', `services reset: ${r.ok.join(', ') || 'none'}; failed: ${r.failed.map((f) => `${f.name} (${f.error})`).join(', ')}; the register was left as it is`);
    return res.status(502).json({ ...r, players_cleared: 0 });
  }
  const { rowCount } = await pool.query(
    `UPDATE players SET provisioned_at = NULL, started_at = NULL, deadline = NULL, ended_at = NULL, outcome = NULL,
       final_guilt = NULL, checkpoints_hit = NULL, elapsed_s = NULL, points = 100, restarts = 0`);
  await logEvent('reset_event', `${rowCount} players cleared; services reset: ${r.ok.join(', ') || 'none'}${r.failed.length ? `; failed: ${r.failed.map((f) => `${f.name} (${f.error})`).join(', ')}` : ''}`);
  res.status(r.failed.length ? 502 : 200).json({ ...r, players_cleared: rowCount });
});

// Restart the app containers (or the named ones) through the Docker socket.
app.post('/api/admin/restart-services', admin, async (req, res) => {
  const wanted = Array.isArray((req.body || {}).names) && req.body.names.length ? req.body.names.map(String) : RESTARTABLE;
  const names = wanted.filter((n) => RESTARTABLE.includes(n));
  if (!names.length) return res.status(400).json({ error: `names must be among: ${RESTARTABLE.join(', ')}` });
  let containers;
  try {
    containers = (await stackContainers()).filter((c) => names.includes(c.service));
  } catch (err) {
    return res.status(503).json({ error: err.message });
  }
  const restarted = [], failed = [];
  await Promise.all(containers.map(async (c) => {
    try { await dockerRequest('POST', `/containers/${c.id}/restart?t=5`); restarted.push(c.service); } catch (err) { failed.push({ name: c.service, error: err.message }); }
  }));
  await logEvent('restart_services', `${restarted.join(', ') || 'none'}${failed.length ? `; failed: ${failed.map((f) => f.name).join(', ')}` : ''}`);
  res.json({ restarted, failed });
});

// The stack's resources: the host as seen from inside this container, every
// container's CPU and memory, each service's database and request rates,
// and the room's headcount.
app.get('/api/admin/resources', admin, async (req, res) => {
  let disk = null;
  try {
    const s = fs.statfsSync('/');
    disk = { total: s.bsize * s.blocks, free: s.bsize * s.bavail };
  } catch (err) { disk = null; }
  const host = { cpu_count: os.cpus().length, load: os.loadavg(), mem_total: os.totalmem(), mem_free: os.freemem(), uptime_s: Math.round(os.uptime()), disk };

  let containers = [];
  try {
    const list = await stackContainers();
    containers = await Promise.all(list.map(async (c) => {
      const base = { name: c.name, service: c.service, state: c.state, status: c.status, cpu_pct: null, mem_usage: null, mem_limit: null };
      if (c.state !== 'running') return base;
      try { return { ...base, ...containerUsage(await dockerRequest('GET', `/containers/${c.id}/stats?stream=false`)) }; } catch (err) { return base; }
    }));
    containers.sort((a, b) => String(a.service || a.name).localeCompare(String(b.service || b.name)));
  } catch (err) {
    containers = [];
  }

  const names = Object.keys(services());
  const stats = await Promise.all(names.map(async (name) => {
    try { return { service: name, ...(await callService(name, 'GET', '/api/internal/stats', null, T_SUMMARY)) }; } catch (err) { return { service: name, error: err.message }; }
  }));

  const { rows } = await pool.query(`
    SELECT count(*)::int AS total,
           (count(*) FILTER (WHERE started_at IS NOT NULL AND outcome IS NULL))::int AS playing,
           (count(*) FILTER (WHERE outcome IS NOT NULL))::int AS finished,
           (count(*) FILTER (WHERE outcome = 'solved'))::int AS solved
    FROM players`);
  res.json({ host, containers, services: stats, players: rows[0], docker: fs.existsSync(DOCKER_SOCK), game_minutes: GAME_MINUTES });
});

app.get('/api/admin/events', admin, async (req, res) => {
  const { rows } = await pool.query('SELECT id, at, kind, detail FROM admin_events ORDER BY id DESC LIMIT 200');
  res.json({ events: rows });
});

app.use(app.tenantErrorHandler);

// The register's tables, should the database volume predate db/init.sql
// (Postgres only runs the initdb folder on an empty volume).
async function ensureSchema() {
  const { rows } = await pool.query("SELECT to_regclass('public.players') AS t");
  if (rows[0].t) return;
  await pool.query(fs.readFileSync(path.join(__dirname, 'db', 'init.sql'), 'utf8'));
  console.log('[mercy-lobby] created the register tables');
}
ensureSchema().catch((err) => console.error('[mercy-lobby] schema check:', err.message));

app.listen(PORT, () => {
  console.log(`[mercy-lobby] listening on :${PORT} -- ${Object.keys(services()).length} services, ${GAME_MINUTES} minutes a game, docker socket ${fs.existsSync(DOCKER_SOCK) ? 'mounted' : 'absent'}`);
});
