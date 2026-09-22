// One participant, one schema. Every stateful service carries an identical
// copy of this file (see /MULTIPLAYER.md):
//
//   * `middleware` reads the participant from the mercy_sid cookie (or the
//     x-mercy-player header on a keyed service-to-service call) and runs the
//     rest of the request inside an AsyncLocalStorage store, so anything
//     below -- route handlers, helpers, the pool -- knows whose game it is;
//   * `wrap(pool)` returns the object db.js exports instead of the raw pool:
//     query() and connect() check out a client, SET search_path TO the
//     participant's schema (then `template`, the pristine seed), and carry on
//     exactly as pg would, so no query in server.js has to change;
//   * `mount(app, opts)` adds the internal endpoints the lobby drives --
//     provision, deprovision, summary, stats -- behind x-internal-key;
//   * `provision` replays db/*.sql once into `template` and clones every
//     non-static table of it into `p_<id>`, then runs the service's hook.
//
// Without a participant an API request is a 401 -- unless the service runs
// with MERCY_SINGLE_PLAYER=1, which is the old single-player behaviour on
// `public` for development and for the seeds.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

const SECRET = process.env.MERCY_SESSION_SECRET || 'dev-session-secret-change-me';
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || 'dev-internal-key';
const MERCY_KEY = process.env.MERCY_API_KEY || 'dev-mercy-key';
const SINGLE_PLAYER = process.env.MERCY_SINGLE_PLAYER === '1';
const COOKIE = 'mercy_sid';
const ID_RE = /^ZIN\d{2}-\d{4}$/;

const als = new AsyncLocalStorage();

// --- identity ------------------------------------------------------------------------------
function normalizeId(raw) {
  const id = String(raw || '').trim().toUpperCase();
  return ID_RE.test(id) ? id : null;
}
function schemaFor(id) {
  return 'p_' + id.toLowerCase().replace(/[^a-z0-9]/g, '_');
}
function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
// the cookie value: <id>.<issued ms>.<hmac>
function issueToken(id) {
  const payload = `${id}.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}
function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const payload = `${parts[0]}.${parts[1]}`;
  const expect = sign(payload);
  const got = parts[2];
  if (expect.length !== got.length || !crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(got))) return null;
  return normalizeId(parts[0]);
}
function cookieHeader(id) {
  // host-only (no Domain), every port of the host sees it; a year, renewed on login
  return `${COOKIE}=${issueToken(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${365 * 24 * 3600}`;
}
function clearCookieHeader() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
function readCookie(req) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function keyed(req) {
  return req.headers['x-internal-key'] === INTERNAL_KEY || req.headers['x-mercy-key'] === MERCY_KEY;
}
// who this request is for: the header on a keyed call wins, else the cookie
function playerOf(req) {
  if (keyed(req) && req.headers['x-mercy-player']) return normalizeId(req.headers['x-mercy-player']);
  return verifyToken(readCookie(req));
}

// --- the request context ----------------------------------------------------------------------
const stats = { started: Date.now(), requests: 0, byPlayer: new Map(), minute: [] };
function count(id) {
  stats.requests++;
  if (id) stats.byPlayer.set(id, (stats.byPlayer.get(id) || 0) + 1);
  const now = Date.now();
  stats.minute.push(now);
  while (stats.minute.length && stats.minute[0] < now - 60000) stats.minute.shift();
}
function current() {
  return als.getStore() || null;
}
function currentId() {
  const s = current();
  return s ? s.id : null;
}
// Whether a participant's schema exists. Postgres ignores a schema that is
// missing from search_path, so a valid cookie for a participant the admin has
// deleted (or is restarting) would otherwise read and write `template` -- the
// seed everyone after them is cloned from. Known names are cached; a miss is
// re-checked, so a schema provisioned by another process is still honoured.
const known = new Set();
let provisionPool = null;
async function schemaExists(schema) {
  if (known.has(schema)) return true;
  if (!provisionPool) return true;   // mount() not called: nothing to check against
  const { rows } = await provisionPool.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [schema]);
  if (rows.length) known.add(schema);
  return rows.length > 0;
}
// Express middleware. Static files and /api/health never need a participant;
// /api/internal/* runs with none (the lobby's calls); everything else under
// /api needs one, or MERCY_SINGLE_PLAYER.
function middleware(req, res, next) {
  const id = playerOf(req);
  const isApi = req.path.startsWith('/api/');
  const open = req.path === '/api/health' || req.path.startsWith('/api/internal/');
  if (isApi) count(id);
  if (id) {
    const schema = schemaFor(id);
    return schemaExists(schema).then((ok) => {
      if (ok) return als.run({ id, schema }, next);
      if (!isApi || open) return next();
      res.status(401).json({ error: 'no participant session', login: true });
    }, next);
  }
  if (!isApi || open || SINGLE_PLAYER) return next();
  res.status(401).json({ error: 'no participant session', login: true });
}
// run fn as a given participant (the lobby's provisioning hook, tests)
function runAs(id, fn) {
  return als.run({ id, schema: schemaFor(id) }, fn);
}

// --- keeping the process up ---------------------------------------------------------------------
// Express 4 does not catch a rejected async handler, and Node 20 exits the
// process on an unhandled rejection: one bad query would take a service down
// for every participant. guardApp() wraps every route handler so a rejection
// becomes a 500 for that one request; the process hook is the last resort.
function guardApp(app) {
  for (const m of ['get', 'post', 'put', 'patch', 'delete', 'all']) {
    const orig = app[m].bind(app);
    app[m] = function (p, ...fns) {
      if (m === 'get' && fns.length === 0) return orig(p);   // app.get('setting') is a getter
      return orig(p, ...fns.map((fn) => (typeof fn === 'function' && fn.length < 4
        ? (req, res, next) => { try { const r = fn(req, res, next); if (r && typeof r.catch === 'function') r.catch(next); } catch (e) { next(e); } }
        : fn)));
    };
  }
  // the error middleware: registered on first use, kept last by express's order of app.use
  app.tenantErrorHandler = (err, req, res, next) => {
    console.error(`[${app.get('x-service') || 'service'}] ${req.method} ${req.path}:`, err && err.message ? err.message : err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'server error', detail: err && err.message ? err.message : String(err) });
  };
}
process.on('unhandledRejection', (err) => { console.error('[tenant] unhandled rejection:', err && err.message ? err.message : err); });

// --- the pool proxy ----------------------------------------------------------------------------
function quoteIdent(s) {
  return '"' + String(s).replace(/"/g, '""') + '"';
}
function searchPath() {
  const s = current();
  if (s) return `${quoteIdent(s.schema)}, template`;
  return 'public';
}
function wrap(pool) {
  const raw = pool;
  return {
    raw,
    async query(text, values) {
      const client = await raw.connect();
      try {
        await client.query(`SET search_path TO ${searchPath()}`);
        return await client.query(text, values);
      } finally {
        client.release();
      }
    },
    async connect() {
      const client = await raw.connect();
      await client.query(`SET search_path TO ${searchPath()}`);
      // pg reuses connections: the path must not follow the client to its next owner
      const release = client.release.bind(client);
      client.release = (err) => { client.query('RESET search_path').catch(() => {}).finally(() => release(err)); };
      return client;
    },
    on: (...a) => raw.on(...a),
    end: () => raw.end(),
  };
}

// --- provisioning ------------------------------------------------------------------------------
// opts: { pool (raw pg Pool), sqlDir, staticTables: [...], afterProvision(client, schema), summary(id) }
let templateReady = null;
async function ensureTemplate(raw, sqlDir) {
  if (templateReady) return templateReady;
  templateReady = (async () => {
    const client = await raw.connect();
    try {
      const { rows } = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = 'template'");
      if (rows.length) return;
      // only the seeds: a migration script with its own BEGIN/COMMIT belongs in scripts/, not here
      const files = fs.readdirSync(sqlDir).filter((f) => f.endsWith('.sql') && !/^migrate/i.test(f)).sort();
      await client.query('BEGIN');
      await client.query('CREATE SCHEMA template');
      await client.query('SET LOCAL search_path TO template');
      for (const f of files) {
        await client.query(fs.readFileSync(path.join(sqlDir, f), 'utf8'));
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      templateReady = null;
      throw err;
    } finally {
      client.release();
    }
  })();
  return templateReady;
}
async function provision(opts, id) {
  const raw = opts.pool;
  await ensureTemplate(raw, opts.sqlDir);
  const schema = schemaFor(id);
  const client = await raw.connect();
  try {
    const exists = (await client.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [schema])).rows.length > 0;
    if (exists) { known.add(schema); return { id, schema, created: false }; }
    const skip = new Set(opts.staticTables || []);
    const { rows: tables } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'template' ORDER BY tablename");
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
    for (const { tablename } of tables) {
      if (skip.has(tablename)) continue;
      const src = `template.${quoteIdent(tablename)}`, dst = `${quoteIdent(schema)}.${quoteIdent(tablename)}`;
      await client.query(`CREATE TABLE ${dst} (LIKE ${src} INCLUDING ALL)`);
      await client.query(`INSERT INTO ${dst} SELECT * FROM ${src}`);
      // A SERIAL column keeps its DEFAULT nextval() on template's sequence (shared,
      // already past the seeded rows, ids unique across participants). An
      // IDENTITY column gets a sequence of its own from INCLUDING ALL, starting
      // at 1: pg_get_serial_sequence names it only in that case -- move it on.
      const { rows: ids } = await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND is_identity = 'YES'",
        [schema, tablename]
      );
      for (const { column_name } of ids) {
        const seq = (await client.query('SELECT pg_get_serial_sequence($1, $2) AS s', [`${quoteIdent(schema)}.${quoteIdent(tablename)}`, column_name])).rows[0].s;
        if (seq) await client.query(`SELECT setval('${seq.replace(/'/g, "''")}', COALESCE((SELECT max(${quoteIdent(column_name)}) FROM ${dst}), 0) + 1, false)`);
      }
    }
    await client.query(`SET LOCAL search_path TO ${quoteIdent(schema)}, template`);
    if (opts.afterProvision) await opts.afterProvision(client, schema);
    await client.query('COMMIT');
    known.add(schema);
    return { id, schema, created: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
async function deprovision(opts, id) {
  const schema = schemaFor(id);
  known.delete(schema);
  await opts.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
  return { id, schema, dropped: true };
}
// the event reset: every participant's schema and the template itself, so
// the next provision replays the seeds -- whose story clock is anchored to
// "last night" relative to the day they run -- on the day of the event
async function reset(opts) {
  known.clear();
  const players = await listPlayers(opts);
  for (const schema of players) await opts.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
  await opts.pool.query('DROP SCHEMA IF EXISTS template CASCADE');
  templateReady = null;
  return { dropped: players.length, template: true };
}
async function listPlayers(opts) {
  const { rows } = await opts.pool.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'p\\_%' ORDER BY nspname");
  return rows.map((r) => r.nspname);
}
async function dbStats(opts) {
  const raw = opts.pool;
  const size = (await raw.query('SELECT pg_size_pretty(pg_database_size(current_database())) AS pretty, pg_database_size(current_database()) AS bytes')).rows[0];
  const conns = (await raw.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()')).rows[0].n;
  const schemas = (await listPlayers(opts)).length;
  return {
    db_size: size.pretty, db_bytes: Number(size.bytes), connections: conns, pool: { total: raw.totalCount, idle: raw.idleCount, waiting: raw.waitingCount },
    player_schemas: schemas, requests_total: stats.requests, requests_last_minute: stats.minute.length, since: new Date(stats.started).toISOString(),
    single_player: SINGLE_PLAYER, template: !!templateReady,
  };
}

// the internal endpoints, all behind x-internal-key
function mount(app, opts) {
  provisionPool = opts.pool;
  const guard = (req, res, next) => (req.headers['x-internal-key'] === INTERNAL_KEY ? next() : res.status(403).json({ error: 'missing or invalid x-internal-key' }));
  app.post('/api/internal/players', guard, async (req, res) => {
    const id = normalizeId((req.body || {}).id);
    if (!id) return res.status(400).json({ error: 'a Zinnia ID like ZIN26-0158 is required' });
    try { res.json(await provision(opts, id)); } catch (err) { console.error(`[${opts.service}] provision ${id}:`, err.message); res.status(500).json({ error: err.message }); }
  });
  app.delete('/api/internal/players/:id', guard, async (req, res) => {
    const id = normalizeId(req.params.id);
    if (!id) return res.status(400).json({ error: 'bad id' });
    try { res.json(await deprovision(opts, id)); } catch (err) { res.status(500).json({ error: err.message }); }
  });
  app.get('/api/internal/players', guard, async (req, res) => {
    try { res.json({ players: await listPlayers(opts) }); } catch (err) { res.status(500).json({ error: err.message }); }
  });
  app.get('/api/internal/players/:id/summary', guard, async (req, res) => {
    const id = normalizeId(req.params.id);
    if (!id) return res.status(400).json({ error: 'bad id' });
    const exists = (await opts.pool.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [schemaFor(id)])).rows.length > 0;
    if (!exists) return res.status(404).json({ error: 'not provisioned' });
    if (!opts.summary) return res.json({ id, provisioned: true });
    try { res.json({ id, provisioned: true, ...(await runAs(id, () => opts.summary(id))) }); } catch (err) { res.status(500).json({ error: err.message }); }
  });
  app.post('/api/internal/template', guard, async (req, res) => {
    try { await ensureTemplate(opts.pool, opts.sqlDir); res.json({ template: true }); } catch (err) { res.status(500).json({ error: err.message }); }
  });
  app.post('/api/internal/reset', guard, async (req, res) => {
    try { res.json(await reset(opts)); } catch (err) { res.status(500).json({ error: err.message }); }
  });
  app.get('/api/internal/stats', guard, async (req, res) => {
    try { res.json({ service: opts.service, ...(await dbStats(opts)) }); } catch (err) { res.status(500).json({ error: err.message }); }
  });
}

module.exports = {
  COOKIE, ID_RE, SINGLE_PLAYER, INTERNAL_KEY,
  normalizeId, schemaFor, issueToken, verifyToken, cookieHeader, clearCookieHeader, playerOf,
  middleware, runAs, current, currentId, wrap, quoteIdent, guardApp,
  ensureTemplate, provision, deprovision, reset, listPlayers, dbStats, mount,
};
