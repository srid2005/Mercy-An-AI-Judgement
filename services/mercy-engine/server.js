// mercy-engine -- the judge.
//
// Owns none of the story's evidence; every other service does. What this
// service owns: what the participant has actually found (discovered_
// evidence), the argument itself (transcript), which pieces of evidence
// have actually been used in an argument MERCY accepted (accepted_
// evidence), and the running verdict (case_state), which MERCY herself moves
// on every turn of /api/argue -- and, once, the rescue (/api/rescue), which
// is how the map ends the game. The checkpoints in db/init.sql are the
// story's beats, not the meter: they open gates, say their line and close
// the file, and the number is the judge's.
//
// For the event every participant has all of that in a schema of their own
// (see /MULTIPLAYER.md): tenant.js picks the schema from the mercy_sid
// cookie and the pool below is its proxy, so nothing a route does has to
// know. The engine also keeps each participant's clock -- the lobby starts
// it, the deadline closes the file -- and tells the lobby how the file
// closed, once, for the leaderboard.
const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");
const llm = require("./llm");
const tenant = require("./tenant");

const PORT = process.env.PORT || 4010;
const MERCY_API_KEY = process.env.MERCY_API_KEY || "dev-mercy-key";
// the lobby, over the docker network, for the outcome report; and the
// length of a game when the lobby's start does not say
const LOBBY_URL = process.env.LOBBY_URL || "http://mercy-lobby:3030";
const GAME_MINUTES = Number(process.env.GAME_MINUTES) || 60;
// the raw pool is what tenant provisions with (schemas, no search path);
// every query in this file goes through the proxy, which sets the
// participant's search_path on each checkout
const rawPool = new Pool({ connectionString: process.env.DATABASE_URL });
const pool = tenant.wrap(rawPool);

// Where to resolve each evidence prefix. CASE- has no live service (the
// case file is a PDF, not a container) so it's seeded straight into
// evidence_cache in db/init.sql. MAP- has no evidence endpoint by design
// (see services/city-map/server.js) -- a drone search is something MERCY
// itself did, not evidence found on someone's device -- so it's synthesised
// on demand from city-map's public search log instead of fetched as
// evidence.
const SERVICE_BASE = {
  SOC: process.env.SOCIAL_MEDIA_URL || "http://social-media:4001",
  EML: process.env.EMAIL_URL || "http://email:4002",
  WA: process.env.WHATSAPP_URL || "http://whatsapp:4003",
  HAV: process.env.HAVEN_URL || "http://haven:4008",
};
const CITY_MAP_URL = process.env.CITY_MAP_URL || "http://city-map:4011";

// A second map, deliberately separate from SERVICE_BASE above: that one is
// how this container reaches another container over the docker network.
// This one is how the participant's own browser reaches it -- used only to
// turn a service's own relative image_url/video_url ("/videos/x.mp4") into
// something the console (a different origin) can actually load.
const PUBLIC_BASE = {
  SOC: process.env.SOCIAL_MEDIA_PUBLIC_URL || "http://localhost:4001",
  EML: process.env.EMAIL_PUBLIC_URL || "http://localhost:4002",
  WA: process.env.WHATSAPP_PUBLIC_URL || "http://localhost:4003",
  HAV: process.env.HAVEN_PUBLIC_URL || "http://localhost:4008",
  CASE: process.env.MERCY_ENGINE_PUBLIC_URL || "http://localhost:4010", // this container's own /case-photos
  MAP: process.env.CITY_MAP_PUBLIC_URL || "http://localhost:4011", // the drone photos city-map serves per search
};

function absolutizeUrls(record) {
  const base = PUBLIC_BASE[prefixOf(record.evidence_id)];
  if (!base || !record.content) return record;
  const fix = (u) => (typeof u === "string" && u.startsWith("/") ? base + u : u);
  const content = { ...record.content };
  ["image_url", "video_url", "poster_url"].forEach((k) => {
    if (content[k]) content[k] = fix(content[k]);
  });
  if (Array.isArray(content.attachments)) content.attachments = content.attachments.map((a) => ({ ...a, url: fix(a.url) }));
  // a drone search's contact sheet: same relative-to-absolute rewrite, per frame
  if (Array.isArray(content.photos)) content.photos = content.photos.map((p) => ({ ...p, url: fix(p.url) }));
  return { ...record, content };
}

const app = express();
app.set("x-service", "mercy-engine");
// before any route: a rejected async handler must be that request's 500,
// not the process's end -- fifty participants share this Node
tenant.guardApp(app);
app.use(express.json());
// the console calls this service from another origin with the cookie, and
// a browser refuses '*' next to credentials: reflect whichever origin asks
app.use(cors({ origin: true, credentials: true }));
app.use(tenant.middleware);
app.use("/case-photos", express.static(path.join(__dirname, "public/case-photos")));

const prefixOf = (evidenceId) => (evidenceId.match(/^([A-Z]+)-/) || [])[1];

// The headers on every call to another service: the key it already
// expects, plus whose game this is, so the owner answers from that
// participant's schema (its tenant.js honours x-mercy-player only next to
// a valid key). No participant -- single-player -- sends the key alone.
function ownerHeaders() {
  const headers = { "x-mercy-key": MERCY_API_KEY };
  const id = tenant.currentId();
  if (id) headers["x-mercy-player"] = id;
  return headers;
}

// Fetch one record from the service that owns it, in the evidence-contract
// shape (see ARCHITECTURE.md). Returns null if the id doesn't resolve to
// anything real -- an invalid id, or a valid id the owning service doesn't
// have (typo, or it belongs to filler content that was never given an
// evidence_id in the first place).
async function fetchFromOwner(evidenceId) {
  const prefix = prefixOf(evidenceId);
  if (prefix === "MAP") return fetchSearchAsEvidence(evidenceId);
  const base = SERVICE_BASE[prefix];
  if (!base) return null;
  try {
    const r = await fetch(`${base}/api/evidence/${encodeURIComponent(evidenceId)}`, {
      headers: ownerHeaders(),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    console.error(`[mercy-engine] fetch ${evidenceId} from ${base} failed:`, e.message);
    return null;
  }
}

// A drone search isn't evidence someone left behind -- it's something the
// participant did, from the console's own City Map tab -- but they should
// still be able to cite one in an argument the same way they cite anything
// else, so MERCY wraps each entry in searches.id as MAP-<id> on request.
// A search has one of four outcomes ('clear' / 'clue' / 'trace' / 'found');
// only 'found' carries found=true, which is what the MAP-FOUND predicate in
// /api/argue reads. The cave sweep is 'trace' (jacket + band, nobody), so
// it can never end the game on its own.
async function fetchSearchAsEvidence(evidenceId) {
  const m = evidenceId.match(/^MAP-(\d+)$/);
  if (!m) return null;
  try {
    // the search log is the participant's own: the map keeps one per schema
    const r = await fetch(`${CITY_MAP_URL}/api/searches`, { headers: ownerHeaders() });
    if (!r.ok) return null;
    const { searches } = await r.json();
    const s = (searches || []).find((x) => String(x.id) === m[1]);
    if (!s) return null;
    // The drone photos city-map attached to the search (aerial / thermal /
    // ground / detail frames, resolved from its photos.json). Kept as
    // {url, kind, caption} only -- the prompts and stock notes in the
    // manifest are the author's, not the participant's. Their urls are
    // relative to city-map; absolutizeUrls rewrites them on the way out.
    const photos = (Array.isArray(s.photos) ? s.photos : [])
      .map((p) => ({ url: typeof p.url === "string" ? p.url : p.file ? `/photos/${p.file}` : null, kind: p.kind || null, caption: p.caption || "" }))
      .filter((p) => p.url);
    const content = {
      lat: s.lat,
      lng: s.lng,
      source: s.source,
      found: s.found,
      outcome: s.outcome,
      spot_slug: s.spot_slug,
      items: s.items,
      evidence_ids: s.evidence_ids,
      result: s.result,
    };
    if (photos.length) {
      content.photos = photos;
      content.image_url = photos[0].url; // the picker's thumbnail, same as every other service
    }
    return {
      evidence_id: evidenceId,
      service: "city-map",
      type: "drone_search",
      timestamp: s.searched_at,
      summary: s.result,
      involves: [],
      content,
    };
  } catch (e) {
    console.error(`[mercy-engine] fetch ${evidenceId} from city-map failed:`, e.message);
    return null;
  }
}

// Who sent a Wisp message. Every other service leaves the author somewhere
// in the evidence record -- first in `involves` (social-media, haven), or
// first of a [sender, recipient] pair (email) -- but whatsapp's `involves`
// is the whole thread and its content carries only the body, so a message
// arrives at MERCY unattributable: WA-199 is the alibi's keystone and she
// cannot tell whether Meera wrote it or Vikram did. The sender is on the
// owning service, on the thread the console reads, so fetch it once and keep
// it in the cached content (llm/vertex.js:attribution reads content.sender).
// The thread is addressed by key for a group and by the other participant
// for a direct chat, which is why this tries several: a candidate counts
// only if the thread it returns actually contains this message. Never
// throws and never blocks a record -- an unreachable whatsapp gives MERCY
// the message without the name, which is where we were before.
async function whatsappSender(record) {
  const base = SERVICE_BASE.WA;
  const c = record.content || {};
  if (!base || record.service !== "whatsapp" || c.sender) return record;
  const candidates = [c.thread_key, ...(record.involves || [])].filter(Boolean);
  for (const key of candidates) {
    try {
      // no deadline here would let a sick owner service hold the whole turn
      // open: the catch below returns the record unattributed, which is the
      // right failure -- MERCY sees one piece without a sender, not a timeout.
      const r = await fetch(`${base}/api/chats/${encodeURIComponent(key)}`, { headers: ownerHeaders(), signal: AbortSignal.timeout(3000) });
      if (!r.ok) continue;
      const { thread } = await r.json();
      const m = (thread || []).find((x) => x.evidence_id === record.evidence_id);
      if (!m || !m.sender) continue;
      return { ...record, content: { ...c, sender: m.sender, sender_display_name: m.sender_display_name || null } };
    } catch (e) {
      console.error(`[mercy-engine] sender lookup for ${record.evidence_id} via ${key} failed:`, e.message);
    }
  }
  return record;
}

// Cache-through resolver. evidence_cache is pre-seeded with CASE- rows;
// everything else lands here the first time anyone (a discovery event, or
// the chat's own ID lookup) asks for it.
async function resolveEvidence(evidenceId) {
  const cached = await pool.query("SELECT * FROM evidence_cache WHERE evidence_id = $1", [evidenceId]);
  if (cached.rows.length) {
    const row = rowToRecord(cached.rows[0]);
    // a row cached before the sender was ever asked for -- fill it in place,
    // once, rather than leaving that participant's MERCY blind for the game
    if (row.service === "whatsapp" && !(row.content || {}).sender) {
      const named = await whatsappSender(row);
      if ((named.content || {}).sender) {
        await pool.query("UPDATE evidence_cache SET content = $2 WHERE evidence_id = $1", [named.evidence_id, named.content]);
        return named;
      }
    }
    return row;
  }

  const fetched = await fetchFromOwner(evidenceId);
  if (!fetched) return null;
  const record = await whatsappSender(fetched);

  await pool.query(
    `INSERT INTO evidence_cache (evidence_id, service, type, timestamp, summary, involves, content)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (evidence_id) DO UPDATE SET content = EXCLUDED.content, summary = EXCLUDED.summary`,
    [record.evidence_id, record.service, record.type, record.timestamp || null, record.summary, record.involves || [], record.content || {}],
  );
  return record;
}

const rowToRecord = (row) => ({
  evidence_id: row.evidence_id,
  service: row.service,
  type: row.type,
  timestamp: row.timestamp,
  summary: row.summary,
  involves: row.involves,
  content: row.content,
});

// ---------------------------------------------------------------------------
// Discovery -- the only way an evidence id ever becomes visible to the
// participant. Called by the console whenever an app reports (via
// window.top.postMessage) that a specific piece of evidence was opened.
// ---------------------------------------------------------------------------
app.post("/api/discovered", async (req, res) => {
  const { evidence_id } = req.body || {};
  if (!evidence_id) return res.status(400).json({ error: "evidence_id is required" });

  const record = await resolveEvidence(evidence_id);
  if (!record) return res.status(404).json({ error: "not in evidence" });

  await pool.query("INSERT INTO discovered_evidence (evidence_id) VALUES ($1) ON CONFLICT DO NOTHING", [evidence_id]);
  res.json(absolutizeUrls(record));
});

// The "+ Evidence" picker calls this on every keystroke, with or without
// ?q=. One filter, matching the id or the words -- but the JOIN against
// discovered_evidence is unconditional, so there is no query string that
// can make this return something not yet found. It's not a rule the UI has
// to remember to enforce; the undiscovered rows are never in this result
// set to begin with, matched or not.
app.get("/api/discovered", async (req, res) => {
  const q = (req.query.q || "").trim();
  const { rows } = await pool.query(
    `SELECT c.* FROM evidence_cache c
     JOIN discovered_evidence d ON d.evidence_id = c.evidence_id
     WHERE $1 = '' OR c.evidence_id ILIKE '%' || $1 || '%' OR c.summary ILIKE '%' || $1 || '%'
     ORDER BY d.discovered_at ASC`,
    [q],
  );
  res.json({ count: rows.length, evidence: rows.map(rowToRecord).map(absolutizeUrls) });
});

// The chat's "+ Evidence, enter an id" field. Deliberately gated on
// discovery, not on validity -- a well-formed id for something the
// participant hasn't found yet returns the same 404 as a typo, so this
// field can't be used to fish for what exists.
app.get("/api/evidence/:evidenceId", async (req, res) => {
  const seen = await pool.query("SELECT 1 FROM discovered_evidence WHERE evidence_id = $1", [req.params.evidenceId]);
  if (!seen.rows.length) return res.status(404).json({ error: "not in evidence" });
  const record = await resolveEvidence(req.params.evidenceId);
  if (!record) return res.status(404).json({ error: "not in evidence" });
  res.json(absolutizeUrls(record));
});

// ---------------------------------------------------------------------------
// The verdict.
// ---------------------------------------------------------------------------

// Gates: things a checkpoint opens when it fires (checkpoints.unlocks). The
// list is fixed, and every gate is always reported, open or not, so the
// shape of /api/state never changes with progress and nothing about the
// un-hit beats leaks -- only that the SOS trail is released, never where.
// The console pushes these to the laptop (mercy:gates); the map derives its
// own unlock from its own searches and needs nothing from here.
const GATES = ["sos_released"];
async function openGates() {
  const { rows } = await pool.query("SELECT DISTINCT unnest(unlocks) AS gate FROM checkpoints WHERE hit = true");
  const open = new Set(rows.map((r) => r.gate));
  return Object.fromEntries(GATES.map((g) => [g, open.has(g)]));
}

// ---------------------------------------------------------------------------
// The clock. The lobby starts it (/api/internal/players/:id/start) and the
// file closes one of three ways -- 'solved' by the rescue or the last
// checkpoint, 'timeout' by the deadline, 'left' by the participant -- each
// written to case_state.outcome exactly once, with concluded, and each told
// to the lobby once for the leaderboard.
// ---------------------------------------------------------------------------
const readState = async () => (await pool.query("SELECT * FROM case_state WHERE id = 1")).rows[0];

// The clock as the console and the lobby read it. `expired` is the clock
// having run out on an open file: a case solved or left before the
// deadline never expires, however long its result stays on screen. Once
// the file is closed the count stops where it was -- updated_at is written
// by every way of concluding and by nothing after -- so a summary read an
// hour later still says how much time the participant had left.
function clockOf(state) {
  const deadline = state.deadline ? new Date(state.deadline).getTime() : null;
  const at = state.concluded && state.updated_at ? new Date(state.updated_at).getTime() : Date.now();
  const time_left_s = deadline === null ? null : Math.max(0, Math.ceil((deadline - at) / 1000));
  const expired = state.outcome === "timeout" || (time_left_s === 0 && !state.concluded && !state.outcome);
  return { started_at: state.started_at || null, deadline: state.deadline || null, time_left_s, expired };
}

// The deadline, applied lazily: nothing runs on a timer, the next read of
// the state (the console polls it) or the next argument closes the file.
// One conditional UPDATE, so two requests racing past the deadline write
// one closing line between them. Returns whether this call was the one.
async function expireIfDue() {
  const { rows } = await pool.query(
    `UPDATE case_state SET outcome = 'timeout', concluded = true, updated_at = now()
     WHERE id = 1 AND deadline IS NOT NULL AND now() > deadline AND outcome IS NULL AND concluded = false
     RETURNING guilt_percent`,
  );
  if (!rows.length) return false;
  await pool.query("INSERT INTO transcript (role, body) VALUES ('mercy', $1)", [`Time. The file closes as it stands: ${Number(rows[0].guilt_percent)}%.`]);
  await reportOutcome("timeout");
  return true;
}

// Tell the lobby how the file closed -- once. reported_at is the claim:
// the conditional UPDATE means two requests concluding at once send one
// report, and a report the lobby never took (down, or not up yet) gives
// the claim back so the next read of /api/me or /api/state tries again.
// Never throws: the game must not depend on the lobby being reachable.
async function reportOutcome(outcome) {
  const id = tenant.currentId();
  if (!id) return console.error(`[mercy-engine] outcome ${outcome} not reported: no participant (single-player)`);
  const { rows } = await pool.query(
    `UPDATE case_state SET reported_at = now() WHERE id = 1 AND reported_at IS NULL
     RETURNING guilt_percent, started_at, points, hints_used,
       GREATEST(0, EXTRACT(EPOCH FROM (LEAST(updated_at, COALESCE(deadline, updated_at)) - started_at)))::int AS elapsed_s`,
  );
  if (!rows.length) return;
  const hit = (await pool.query("SELECT count(*)::int AS n FROM checkpoints WHERE hit = true")).rows[0].n;
  const body = {
    id,
    outcome,
    guilt_percent: Number(rows[0].guilt_percent),
    checkpoints_hit: hit,
    // what is left of the hint budget, and what it took: the leaderboard
    // ranks solved files by the points still in hand, then by time
    points: rows[0].points,
    hints_used: rows[0].hints_used,
    elapsed_s: rows[0].started_at ? rows[0].elapsed_s : null,
  };
  try {
    const r = await fetch(`${LOBBY_URL}/api/internal/outcome`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-key": tenant.INTERNAL_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) return;
    console.error(`[mercy-engine] outcome ${outcome} for ${id}: lobby answered ${r.status}`);
  } catch (e) {
    console.error(`[mercy-engine] outcome ${outcome} for ${id}: lobby unreachable:`, e.message);
  }
  await pool.query("UPDATE case_state SET reported_at = NULL WHERE id = 1").catch(() => {});
}

// a closed file whose report the lobby never took: send it again
async function reportIfPending(state) {
  if (state.outcome && !state.reported_at) await reportOutcome(state.outcome);
}

// The lobby's "Accept & continue": start this participant's clock. Runs as
// that participant, so the write lands in their schema. Idempotent -- a
// clock already running is not restarted, the reload of a lobby page
// cannot buy anyone more time -- and the deadline is the database's now()
// so expireIfDue compares like with like.
const internalOnly = (req, res, next) => (req.headers["x-internal-key"] === tenant.INTERNAL_KEY ? next() : res.status(403).json({ error: "missing or invalid x-internal-key" }));
app.post("/api/internal/players/:id/start", internalOnly, async (req, res) => {
  const id = tenant.normalizeId(req.params.id);
  if (!id) return res.status(400).json({ error: "bad id" });
  const provisioned = (await rawPool.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [tenant.schemaFor(id)])).rows.length > 0;
  if (!provisioned) return res.status(404).json({ error: "not provisioned" });
  const minutes = Number((req.body || {}).minutes) || GAME_MINUTES;
  const clock = await tenant.runAs(id, async () => {
    await pool.query("UPDATE case_state SET started_at = now(), deadline = now() + $1::float8 * interval '1 minute', updated_at = now() WHERE id = 1 AND started_at IS NULL", [minutes]);
    return (await pool.query("SELECT started_at, deadline FROM case_state WHERE id = 1")).rows[0];
  });
  res.json({ started_at: clock.started_at, deadline: clock.deadline });
});

// The participant, as the console sees them: who, the clock, and how the
// file stands. `name` is the lobby's to know, not this service's.
app.get("/api/me", async (req, res) => {
  await expireIfDue();
  const state = await readState();
  await reportIfPending(state);
  res.json({
    id: tenant.currentId(),
    name: null,
    ...clockOf(state),
    concluded: state.concluded,
    outcome: state.outcome,
    guilt_percent: Number(state.guilt_percent),
  });
});

// "Leave the case": the file stands where it is, and it stands against
// them. The deadline is checked first -- a click after the clock ran out
// is a timeout, not a choice. Idempotent: a closed file answers with how
// it closed and writes nothing.
app.post("/api/leave", async (req, res) => {
  await expireIfDue();
  const { rows } = await pool.query(
    `UPDATE case_state SET outcome = 'left', concluded = true, updated_at = now()
     WHERE id = 1 AND outcome IS NULL AND concluded = false
     RETURNING guilt_percent`,
  );
  if (rows.length) {
    await pool.query("INSERT INTO transcript (role, body) VALUES ('mercy', $1)", [`You have left the file. It stands at ${Number(rows[0].guilt_percent)}% and it stands against you.`]);
    await reportOutcome("left");
  }
  const state = await readState();
  res.json({ outcome: state.outcome, guilt_percent: Number(state.guilt_percent) });
});

app.get("/api/state", async (req, res) => {
  await expireIfDue();
  const state = await readState();
  await reportIfPending(state);
  const checkpoints = (await pool.query("SELECT code, sort_order, label, guilt_after, guilt_at_hit, hit, hit_at FROM checkpoints ORDER BY sort_order")).rows;
  res.json({
    guilt_percent: Number(state.guilt_percent),
    concluded: state.concluded,
    outcome: state.outcome,
    points: state.points,
    hints_used: state.hints_used,
    // which beat a hint would be bought against right now. The console prices
    // a tier before it asks, so it needs this to tell "you already own this
    // one" from "this one is for the beat you have since moved on to" -- the
    // same tier is a different hint, and a different charge, once the file
    // advances. Never the missing ids: that would hand over free what the
    // tiers are priced for.
    hint_target: (await stuckOn())?.code || null,
    ...clockOf(state),
    // un-hit checkpoints are returned blank -- the participant can see the
    // shape of what's left (how many beats remain) without the content
    // being spoiled by the state endpoint itself. guilt_after is what the
    // standing actually was when the beat fired, not the old script's
    // number: MERCY moves the meter now, so the beat list has to read back
    // the same as the meter did at the time.
    checkpoints: checkpoints.map((c) => (c.hit ? { sort_order: c.sort_order, label: c.label, guilt_after: Number(c.guilt_at_hit === null ? c.guilt_after : c.guilt_at_hit), hit: true, hit_at: c.hit_at } : { sort_order: c.sort_order, hit: false })),
    gates: await openGates(),
  });
});

app.get("/api/transcript", async (req, res) => {
  // verdict and delta ride along so a reloaded hearing reads back the same
  // moves the participant watched the meter make
  const { rows } = await pool.query("SELECT role, body, evidence_ids, checkpoint_hit, verdict, delta, created_at FROM transcript ORDER BY id ASC");
  res.json({ count: rows.length, transcript: rows.map((r) => ({ ...r, delta: r.delta === null ? null : Number(r.delta) })) });
});

// ---------------------------------------------------------------------------
// The argument itself.
//
// MERCY owns the number. Every turn she returns a verdict and a delta and the
// standing moves by it, up or down -- the checkpoints below are story beats
// now, not the meter. The model is not trusted with any of that, so the
// guards here are absolute and run on every turn whichever provider answered:
//   * the delta is clamped to [-12, +6];
//   * a turn with nothing attached can never move the file the accused's way;
//   * only 'contradicted' -- evidence that turns on the person who brought
//     it -- may cost more than three points;
//   * the standing stays inside [0, 100], and above a floor of 2.0 until she
//     has actually been found. Nobody talks their way to zero.
// ---------------------------------------------------------------------------
const DELTA_MIN = -12;
const DELTA_MAX = 6;
const REJECTED_MAX = 3;      // the most a turn can cost without being contradicted
const GUILT_FLOOR = 2.0;     // while 'located' has not fired
const round1 = (n) => Math.round(n * 10) / 10;

function guardDelta(delta, verdict, hasEvidence) {
  let d = Number.isFinite(Number(delta)) ? Number(delta) : 0;
  d = Math.max(DELTA_MIN, Math.min(DELTA_MAX, d));
  if (!hasEvidence && d < 0) d = 0;
  if (verdict !== "contradicted" && d > REJECTED_MAX) d = REJECTED_MAX;
  return round1(d);
}

// The accepted set as the beats read it: every id the file has taken, plus
// MAP-FOUND once one of those is a drone search that actually located her --
// which search id that is can't be known ahead of time (see db/init.sql on
// the 'located' checkpoint).
async function acceptedSetFor(accepted) {
  const set = new Set(accepted);
  if (!accepted.length) return set;
  const found = await pool.query(
    "SELECT 1 FROM evidence_cache WHERE service = 'city-map' AND (content->>'found')::boolean = true AND evidence_id = ANY($1) LIMIT 1",
    [accepted],
  );
  if (found.rows.length) set.add("MAP-FOUND");
  return set;
}

// Fire every beat the accepted set now covers, oldest first. All of them are
// tested, not only the next one: sort_order is the story's order, not a gate
// on the participant's, and a piece argued early for another reason has to
// land its beat when the rest of that beat finally arrives.
async function fireCheckpoints() {
  const pending = (await pool.query("SELECT * FROM checkpoints WHERE hit = false ORDER BY sort_order")).rows;
  if (!pending.length) return { hits: [], located: false };
  const accepted = (await pool.query("SELECT evidence_id FROM accepted_evidence")).rows.map((r) => r.evidence_id);
  const set = await acceptedSetFor(accepted);
  const hits = pending.filter((c) => c.required_ids.every((id) => set.has(id)));
  if (hits.length) await pool.query("UPDATE checkpoints SET hit = true, hit_at = now() WHERE code = ANY($1)", [hits.map((c) => c.code)]);
  return { hits, located: hits.some((c) => c.code === "located") };
}

app.post("/api/argue", async (req, res) => {
  const { text, evidence_ids } = req.body || {};
  const ids = Array.isArray(evidence_ids) ? evidence_ids.filter(Boolean) : [];
  if (!text?.trim() && ids.length === 0) return res.status(400).json({ error: "say something, or attach something" });

  // the deadline first: an argument sent after it is refused as time, not
  // as a closed case, so the console can say which
  await expireIfDue();
  const state = await readState();
  if (state.outcome === "timeout") return res.status(409).json({ error: "time is up" });
  if (state.concluded) return res.status(409).json({ error: "the case is closed" });

  // every attached id must actually have been discovered -- the client
  // builds its tray from discovered evidence, but never trust the client.
  if (ids.length) {
    const found = await pool.query("SELECT evidence_id FROM discovered_evidence WHERE evidence_id = ANY($1)", [ids]);
    if (found.rows.length !== ids.length) return res.status(400).json({ error: "one or more attached ids have not been discovered" });
  }
  const attached = await Promise.all(ids.map(resolveEvidence));

  await pool.query("INSERT INTO transcript (role, body, evidence_ids) VALUES ('participant', $1, $2)", [text || "", ids]);

  // the model also sees the last turns (with what was attached to each), the
  // beats the file has already accepted and the ids behind them, and where
  // the standing is -- context, not answers: the hidden truth is never in
  // the prompt. Without the accepted ids a participant ten turns in reads
  // to the model exactly like a participant on turn one.
  const [history, established, acceptedIds] = await Promise.all([
    pool.query("SELECT role, body, evidence_ids FROM transcript ORDER BY id DESC LIMIT 9").then((r) => r.rows.slice(1).reverse()),
    pool.query("SELECT label FROM checkpoints WHERE hit = true ORDER BY sort_order").then((r) => r.rows.map((c) => c.label)),
    pool.query("SELECT evidence_id FROM accepted_evidence ORDER BY accepted_at").then((r) => r.rows.map((a) => a.evidence_id)),
  ]);
  let { reply, verdict, delta, accepted_ids: acceptedNow } = await llm.generateReply({
    participantText: text || "",
    attachedEvidence: attached,
    guiltPercent: Number(state.guilt_percent),
    history,
    established,
    acceptedIds,
  });

  // the model took its time: the clock may have run out, or the map may have
  // closed the file, while it was thinking -- nothing below may overwrite that
  await expireIfDue();
  const again = await readState();
  if (again.concluded || again.outcome) {
    return res.status(409).json({ error: again.outcome === "timeout" ? "time is up" : "the case is closed" });
  }

  // Only the pieces that actually carried the claim fold into the accepted
  // set: the right piece attached beside the wrong argument still proves
  // nothing, and the beats below read this set, not what was attached.
  const acceptedTurn = (acceptedNow || []).filter((id) => ids.includes(id));
  if (acceptedTurn.length) {
    await Promise.all(acceptedTurn.map((id) => pool.query("INSERT INTO accepted_evidence (evidence_id) VALUES ($1) ON CONFLICT DO NOTHING", [id])));
  }

  // the beats first, then the number: whether she has been found decides
  // whether the floor is still under the standing this turn
  const { hits, located } = await fireCheckpoints();

  const before = Number(again.guilt_percent);
  const guarded = guardDelta(delta, verdict, ids.length > 0);
  // Finding her is the only thing that takes the file to zero, and it takes
  // it there outright -- the same ending the rescue writes from the map's
  // side. Everything else lands between the floor and a hundred.
  const guilt = located ? 0.0 : Math.min(100, Math.max(GUILT_FLOOR, round1(before + guarded)));
  const moved = round1(guilt - before);
  await pool.query(
    "UPDATE case_state SET guilt_percent = $1, concluded = $2, outcome = CASE WHEN $2::boolean THEN 'solved' ELSE outcome END, updated_at = now() WHERE id = 1",
    [guilt, located],
  );

  let checkpointHit = null;
  if (hits.length) {
    // what the meter actually read when each beat fired, so /api/state's
    // beat list and the meter never disagree on a reload
    await pool.query("UPDATE checkpoints SET guilt_at_hit = $1 WHERE code = ANY($2)", [guilt, hits.map((c) => c.code)]);
    checkpointHit = hits[hits.length - 1].code;
    // MERCY's own line for each beat rides on the same turn, as its own
    // paragraph after the model's reply -- into the transcript too, so a
    // reload reads the same way.
    for (const c of hits) if (c.reaction) reply = reply + "\n\n" + c.reaction;
  }

  await pool.query(
    "INSERT INTO transcript (role, body, evidence_ids, checkpoint_hit, verdict, delta) VALUES ('mercy', $1, $2, $3, $4, $5)",
    [reply, [], checkpointHit, verdict, moved],
  );
  // after the closing line is in the transcript, so the lobby's next look
  // at the summary reads a finished file
  if (located) await reportOutcome("solved");

  const fresh = (await pool.query("SELECT guilt_percent, concluded, points FROM case_state WHERE id = 1")).rows[0];
  res.json({
    reply,
    guilt_percent: Number(fresh.guilt_percent),
    delta: moved,
    verdict,
    accepted_ids: acceptedTurn,
    points: fresh.points,
    checkpoint_hit: checkpointHit,
    concluded: fresh.concluded,
  });
});

// ---------------------------------------------------------------------------
// Hints. A hundred points per participant, priced by how much of the work
// the hint does for them: tier 1 (5) names the app or the part of the city,
// tier 2 (10) says what to look for once they are there, tier 3 (20) names
// the piece and its id. What is left of the budget ranks the leaderboard
// under 'solved', so the price is real.
//
// The target is not the participant's to choose: it is wherever they are
// actually stuck -- the next un-hit beat, minus the required ids the file
// has already accepted. Of what is left, a piece they have not even found
// outranks one they have found and not argued, because those are two
// different kinds of stuck and only one of them is answered by being told
// where to look; the other is told so in the body.
//
// That is one of two questions the desk answers. The other is where the
// participant is standing right now: the console reports the screen they are
// on (mercy:context) and sends it with every press of its Hint button, and a
// screen with a chain written for it (context_hints) answers that screen
// instead -- the next unbought step of it, so pressing again escalates rather
// than repeats. The two are priced the same, charged apart, and ordered:
// screen first, beat second, and a chain that has been spent falls through to
// the beat, because a hint button that can say nothing is a dead end.
//
// A hint informs and does nothing else. It opens no tab, reveals no panel and
// touches nothing on any screen: the answer is the participant's to walk to,
// and a step that walked them there would be selling the door rather than the
// key to it. That is why the response carries words and a price and no
// instruction, and why the deepest step of a gate chain says where the code is
// written down rather than what it is.
// ---------------------------------------------------------------------------
const HINT_COST = { 1: 5, 2: 10, 3: 20 };
const ARGUE_IT =
  "Every piece this beat needs is already in your evidence index. What is missing is not the finding. It is the argument: attach it in the hearing and tell me what it proves.";

async function stuckOn() {
  const next = (await pool.query("SELECT code, required_ids FROM checkpoints WHERE hit = false ORDER BY sort_order LIMIT 1")).rows[0];
  if (!next) return null;
  const accepted = (await pool.query("SELECT evidence_id FROM accepted_evidence")).rows.map((r) => r.evidence_id);
  const set = await acceptedSetFor(accepted);
  const missing = next.required_ids.filter((id) => !set.has(id));
  if (!missing.length) return { code: next.code, missing, allDiscovered: false };
  // MAP-FOUND is not a record anyone can open, so it is never discovered --
  // which is right: a participant who has not found her is stuck on finding
  // her, not on arguing her.
  const seen = (await pool.query("SELECT evidence_id FROM discovered_evidence WHERE evidence_id = ANY($1)", [missing])).rows.map((r) => r.evidence_id);
  return { code: next.code, missing, allDiscovered: seen.length === missing.length };
}

// Where the participant is standing, as the console reports it: a fixed
// vocabulary of screen keys, with `detail` naming the app inside 'laptop-app'
// or what is in flight over the map. Nothing here trusts the strings -- a
// screen nobody wrote a chain for simply has no chain, and the press becomes
// an ordinary beat request.
function contextOf(body) {
  const clean = (v, max) => (typeof v === "string" ? v.trim().toLowerCase().slice(0, max) : "");
  return { screen: clean(body.context, 40), detail: clean(body.detail, 80) };
}

// The chain for a screen: the exact screen-and-detail pair when one is
// written, otherwise the screen's own. A detail nobody has words for -- a
// coordinate string under 'map-search', Settings under 'laptop-app' -- is
// still a participant standing on a screen we do have.
async function chainFor(screen, detail) {
  if (!screen) return null;
  const rows = (
    await pool.query(
      "SELECT detail, step, body FROM context_hints WHERE screen = $1 AND detail IN ($2, '') ORDER BY step",
      [screen, detail],
    )
  ).rows;
  const exact = detail ? rows.filter((r) => r.detail === detail) : [];
  const steps = exact.length ? exact : rows.filter((r) => r.detail === "");
  if (!steps.length) return null;
  // what has already been bought against this exact chain: a press escalates
  // to the next step they do not own, never re-sells the one they do
  const taken = (await pool.query("SELECT step FROM context_hints_taken WHERE screen = $1 AND detail = $2", [screen, steps[0].detail])).rows.map((r) => r.step);
  return { screen, detail: steps[0].detail, steps, next: steps.find((s) => !taken.includes(s.step)) || null };
}

// The cheapest tier of this beat the participant does not already own. The nav
// button sends no tier and still has to be answered; once all three are bought
// the last one comes back again for nothing, because the button is never
// allowed to be a dead end.
async function nextBeatTier(code) {
  const taken = (await pool.query("SELECT tier FROM hints_taken WHERE checkpoint_code = $1", [code])).rows.map((r) => r.tier);
  return [1, 2, 3].find((t) => !taken.includes(t)) || 3;
}

// The charge, once, against whichever ledger keys these words. The same words
// asked for twice are the same knowledge, and the second time they are free.
// One transaction with the state row locked, so a double click cannot buy them
// twice or overdraw the purse.
async function chargeOnce(ledger, cost) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = (await client.query("SELECT points FROM case_state WHERE id = 1 FOR UPDATE")).rows[0];
    if ((await client.query(ledger.select, ledger.key)).rows.length) {
      await client.query("COMMIT");
      return { charged: 0, pointsLeft: cur.points };
    }
    if (cur.points < cost) {
      await client.query("ROLLBACK");
      return { short: true, pointsLeft: cur.points };
    }
    await client.query(ledger.insert, [...ledger.key, cost]);
    const left = (await client.query("UPDATE case_state SET points = GREATEST(0, points - $1), hints_used = hints_used + 1 WHERE id = 1 RETURNING points", [cost])).rows[0].points;
    await client.query("COMMIT");
    return { charged: cost, pointsLeft: left };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

app.post("/api/hint", async (req, res) => {
  const body = req.body || {};
  // tier is optional now: the nav button sends none and lets the desk pick the
  // next step itself. Sent explicitly it means exactly what it meant in v2 --
  // that tier of the beat they are stuck on, context or no context -- because
  // the three priced buttons in the hint desk still ask for it by name.
  const asked = body.tier === undefined || body.tier === null || body.tier === "" ? null : Number(body.tier);
  if (asked !== null && !HINT_COST[asked]) return res.status(400).json({ error: "tier must be 1, 2 or 3" });
  const { screen, detail } = contextOf(body);

  await expireIfDue();
  const state = await readState();
  if (state.outcome === "timeout") return res.status(409).json({ error: "time is up" });
  if (state.concluded) return res.status(409).json({ error: "the case is closed" });

  // The screen first. A chain with a step left answers where they are
  // standing; a chain they have spent falls past this and the beat answers.
  const chain = asked === null ? await chainFor(screen, detail) : null;
  if (chain && chain.next) {
    const step = chain.next;
    const paid = await chargeOnce(
      {
        select: "SELECT 1 FROM context_hints_taken WHERE screen = $1 AND detail = $2 AND step = $3",
        insert: "INSERT INTO context_hints_taken (screen, detail, step, cost) VALUES ($1, $2, $3, $4)",
        key: [chain.screen, chain.detail, step.step],
      },
      HINT_COST[step.step],
    );
    if (paid.short) return res.status(402).json({ error: "not enough points", points_left: paid.pointsLeft });
    return res.json({
      hint: step.body,
      // the console keys its own record of what this participant owns on
      // `tier`, and a step is what a tier is here
      tier: step.step,
      cost: paid.charged,
      points_left: paid.pointsLeft,
      target: `${chain.screen}${chain.detail ? ":" + chain.detail : ""}/step${step.step}`,
      step: step.step,
      steps_total: chain.steps.length,
      kind: "context",
    });
  }

  const stuck = await stuckOn();
  if (!stuck) return res.status(409).json({ error: "there is nothing left to point you at" });
  const tier = asked === null ? await nextBeatTier(stuck.code) : asked;
  // read the words before taking the money: a tier with no row is a seeding
  // fault, and nobody pays for it
  const row = (await pool.query("SELECT body FROM hints WHERE checkpoint_code = $1 AND tier = $2", [stuck.code, tier])).rows[0];
  if (!row) return res.status(409).json({ error: "no hint at that tier" });
  const hint = stuck.allDiscovered ? `${row.body}\n\n${ARGUE_IT}` : row.body;

  const paid = await chargeOnce(
    {
      select: "SELECT 1 FROM hints_taken WHERE checkpoint_code = $1 AND tier = $2",
      insert: "INSERT INTO hints_taken (checkpoint_code, tier, cost) VALUES ($1, $2, $3)",
      key: [stuck.code, tier],
    },
    HINT_COST[tier],
  );
  if (paid.short) return res.status(402).json({ error: "not enough points", points_left: paid.pointsLeft });
  res.json({
    hint,
    tier,
    cost: paid.charged,
    points_left: paid.pointsLeft,
    target: `${stuck.code}/tier${tier}`,
    step: tier,
    steps_total: 3,
    kind: "beat",
  });
});

// ---------------------------------------------------------------------------
// The rescue -- the map's ending. Once a drone search at one of Nikhil's
// stops actually finds her, the map runs the rescue itself and posts
// mercy:case-solved to the console, which calls this with that search's
// MAP-<id>. It concludes the case outright: the participant does not have
// to come back to the hearing and argue MAP-FOUND for the 'located' beat
// to fire -- she has been found, and MERCY says so. Everything that beat
// would have done happens here, in the same order (accept the evidence,
// hit the checkpoint, move the verdict, write MERCY's line), except the
// verdict goes to 0.0 rather than the checkpoint's guilt_after: a recovered
// victim is not a three-percent doubt. Any earlier beats the participant
// skipped stay un-hit; the record shows what was argued, not what wasn't.
// Idempotent: a call after the case is closed (a reload replaying the
// message) answers with the state and writes nothing, no new turn -- and
// that includes a file the deadline closed while the footage played: the
// clock is checked first, so a find that arrives late is a timeout on
// every screen, not a solve on one and a timeout on another.
// ---------------------------------------------------------------------------
app.post("/api/rescue", async (req, res) => {
  const { evidence_id } = req.body || {};
  if (!evidence_id) return res.status(400).json({ error: "evidence_id is required" });

  await expireIfDue();
  const record = await resolveEvidence(evidence_id);
  const found = record && record.content ? record.content.found : null;
  if (!record || record.service !== "city-map" || !(found === true || found === "true")) {
    return res.status(400).json({ error: "that search did not find her" });
  }

  // one transaction, the state row locked: the map may post the message
  // twice (its card, then the button), and a case must never end up closed
  // without its closing line
  const reply = rescueLine(record);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const state = (await client.query("SELECT * FROM case_state WHERE id = 1 FOR UPDATE")).rows[0];
    if (state.concluded) {
      await client.query("COMMIT");
      return res.json({ concluded: true, guilt_percent: Number(state.guilt_percent), reply: null, checkpoint_hit: null });
    }
    // the search is the participant's own, shown on their screen: discovered
    // as well as accepted, so the index and the accepted set stay consistent
    await client.query("INSERT INTO discovered_evidence (evidence_id) VALUES ($1) ON CONFLICT DO NOTHING", [evidence_id]);
    for (const id of [evidence_id, "SW-06"]) await client.query("INSERT INTO accepted_evidence (evidence_id) VALUES ($1) ON CONFLICT DO NOTHING", [id]);
    await client.query("UPDATE checkpoints SET hit = true, hit_at = now(), guilt_at_hit = 0.0 WHERE code = 'located'");
    await client.query("UPDATE case_state SET guilt_percent = 0.0, concluded = true, outcome = 'solved', updated_at = now() WHERE id = 1");
    await client.query("INSERT INTO transcript (role, body, evidence_ids, checkpoint_hit) VALUES ('mercy', $1, $2, 'located')", [reply, []]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  // outside the transaction: the lobby is told about a file that is closed,
  // and its being down cannot hold the row lock open
  await reportOutcome("solved");
  res.json({ concluded: true, guilt_percent: 0, reply, checkpoint_hit: "located" });
});

// MERCY's closing line, composed from the search that found her. city-map
// writes every found result place-first ("Harrow Mills, Unit 4." and then
// the thermal read), so the first sentence is where the units went in; a
// record with no usable result gets the line without the place.
function rescueLine(record) {
  const result = String((record.content && record.content.result) || "").trim();
  const m = result.match(/^(.+?[.!?])(\s|$)/);
  const place = m && m[1].length <= 120 ? m[1].replace(/[.!?]$/, "").replace(/^(A|An|The) /, (a) => a.toLowerCase()) : "";
  const onSite = place ? `Units are on site: ${place}.` : "Units are on site.";
  return `${onSite} She is alive -- where he left her, and nowhere you have been. Nikhil Rao is in custody, taken at the kerb beside his car. The file against you is closed.`;
}

// The case header the console shows before anything is discovered. Every
// app re-anchors its seed so the night Meera was taken is "1 day before
// seeding", so the date has to come from the data, not a constant: HAV-031
// is the final recording, made minutes before she was taken. Only the
// timestamp leaves this endpoint -- the entry itself stays discovery-gated.
app.get("/api/case", async (req, res) => {
  // one indexed read of the participant's evidence_cache per call: correct
  // across an event reset (the templates re-seed to a new "last night")
  const record = await resolveEvidence("HAV-031");
  if (!record || !record.timestamp) return res.status(503).json({ error: "haven not reachable yet" });
  // the hint budget rides along: the console draws the header before it has
  // asked for the state, and the points counter is part of that header
  const state = await readState();
  res.json({ missing_since: record.timestamp, points: state.points, hints_used: state.hints_used });
});
app.get("/api/health", (req, res) => res.json({ ok: true, service: "mercy-engine" }));

// ---------------------------------------------------------------------------
// The lobby's side: provision / drop / summarise a participant, reset the
// event (tenant.js). db/ is in the image for the template replay. Nothing
// here is static -- every table is the participant's own, evidence_cache
// included: MAP-<id>, SOC-, EML- ids repeat across participants with
// different content behind them, so a shared cache would hand one
// participant another's drone search.
// ---------------------------------------------------------------------------
tenant.mount(app, {
  service: "mercy-engine",
  pool: rawPool,
  sqlDir: path.join(__dirname, "db"),
  staticTables: [],
  // the admin panel's live row for one participant; runs as them, so the
  // deadline is applied here too -- a participant who walked away from the
  // console still times out, and the lobby still hears of it
  summary: async () => {
    await expireIfDue();
    const state = await readState();
    await reportIfPending(state);
    const beats = (await pool.query("SELECT (count(*) FILTER (WHERE hit))::int AS hit, count(*)::int AS total FROM checkpoints")).rows[0];
    const discovered = (await pool.query("SELECT count(*)::int AS n FROM discovered_evidence")).rows[0].n;
    const turns = (await pool.query("SELECT count(*)::int AS n, max(created_at) AS last FROM transcript")).rows[0];
    return {
      guilt_percent: Number(state.guilt_percent),
      concluded: state.concluded,
      outcome: state.outcome,
      points: state.points,
      hints_used: state.hints_used,
      ...clockOf(state),
      checkpoints_hit: beats.hit,
      checkpoints_total: beats.total,
      discovered,
      transcript_turns: turns.n,
      last_activity: turns.last,
    };
  },
});
// after every route, so a rejected handler ends as that request's 500
app.use(app.tenantErrorHandler);

app.listen(PORT, () => {
  console.log(`[mercy-engine] listening on :${PORT} (llm provider: ${process.env.MERCY_LLM_PROVIDER || "stub"})`);
});
