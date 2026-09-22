// mercy-engine -- the judge.
//
// Owns none of the story's evidence; every other service does. What this
// service owns: what the participant has actually found (discovered_
// evidence), the argument itself (transcript), which pieces of evidence
// have actually been used in an argument MERCY accepted (accepted_
// evidence), and the running verdict (case_state), moved only by the
// checkpoint script in db/init.sql -- and, once, by the rescue (/api/rescue),
// which is how the map ends the game.
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
const GAME_MINUTES = Number(process.env.GAME_MINUTES) || 25;
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

// Cache-through resolver. evidence_cache is pre-seeded with CASE- rows;
// everything else lands here the first time anyone (a discovery event, or
// the chat's own ID lookup) asks for it.
async function resolveEvidence(evidenceId) {
  const cached = await pool.query("SELECT * FROM evidence_cache WHERE evidence_id = $1", [evidenceId]);
  if (cached.rows.length) return rowToRecord(cached.rows[0]);

  const record = await fetchFromOwner(evidenceId);
  if (!record) return null;

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
     RETURNING guilt_percent, started_at,
       GREATEST(0, EXTRACT(EPOCH FROM (LEAST(updated_at, COALESCE(deadline, updated_at)) - started_at)))::int AS elapsed_s`,
  );
  if (!rows.length) return;
  const hit = (await pool.query("SELECT count(*)::int AS n FROM checkpoints WHERE hit = true")).rows[0].n;
  const body = {
    id,
    outcome,
    guilt_percent: Number(rows[0].guilt_percent),
    checkpoints_hit: hit,
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
  const checkpoints = (await pool.query("SELECT code, sort_order, label, guilt_after, hit, hit_at FROM checkpoints ORDER BY sort_order")).rows;
  res.json({
    guilt_percent: Number(state.guilt_percent),
    concluded: state.concluded,
    outcome: state.outcome,
    ...clockOf(state),
    // un-hit checkpoints are returned blank -- the participant can see the
    // shape of what's left (how many beats remain) without the content
    // being spoiled by the state endpoint itself.
    checkpoints: checkpoints.map((c) => (c.hit ? { sort_order: c.sort_order, label: c.label, guilt_after: Number(c.guilt_after), hit: true, hit_at: c.hit_at } : { sort_order: c.sort_order, hit: false })),
    gates: await openGates(),
  });
});

app.get("/api/transcript", async (req, res) => {
  const { rows } = await pool.query("SELECT role, body, evidence_ids, checkpoint_hit, created_at FROM transcript ORDER BY id ASC");
  res.json({ count: rows.length, transcript: rows });
});

// ---------------------------------------------------------------------------
// The argument itself.
// ---------------------------------------------------------------------------
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

  // the model also sees the last turns and the beats the file has already
  // accepted -- context, not answers: the hidden truth is never in the prompt
  const [history, established] = await Promise.all([
    pool.query("SELECT role, body FROM transcript ORDER BY id DESC LIMIT 9").then((r) => r.rows.slice(1).reverse()),
    pool.query("SELECT label FROM checkpoints WHERE hit = true ORDER BY sort_order").then((r) => r.rows.map((c) => c.label)),
  ]);
  let { reply, coherent } = await llm.generateReply({
    participantText: text || "",
    attachedEvidence: attached,
    guiltPercent: Number(state.guilt_percent),
    history,
    established,
  });

  // the model took its time: the clock may have run out, or the map may have
  // closed the file, while it was thinking -- nothing below may overwrite that
  await expireIfDue();
  const again = await readState();
  if (again.concluded || again.outcome) {
    return res.status(409).json({ error: again.outcome === "timeout" ? "time is up" : "the case is closed" });
  }

  if (coherent && ids.length) {
    await Promise.all(ids.map((id) => pool.query("INSERT INTO accepted_evidence (evidence_id) VALUES ($1) ON CONFLICT DO NOTHING", [id])));
  }

  // the next un-hit checkpoint, in order, fires the moment the accepted set
  // covers its required ids -- so a checkpoint can't fire out of sequence
  // even if its evidence happened to be accepted earlier for another reason.
  let checkpointHit = null;
  let solved = false;
  const next = (await pool.query("SELECT * FROM checkpoints WHERE hit = false ORDER BY sort_order LIMIT 1")).rows[0];
  if (next) {
    const accepted = (await pool.query("SELECT evidence_id FROM accepted_evidence")).rows.map((r) => r.evidence_id);
    const acceptedSet = new Set(accepted);
    // MAP-FOUND is synthetic: true once any accepted drone-search result
    // actually located her, since which search id that was isn't knowable
    // ahead of time (see db/init.sql on the 'located' checkpoint).
    const foundASearch = (
      await pool.query(
        "SELECT 1 FROM evidence_cache WHERE service = 'city-map' AND (content->>'found')::boolean = true AND evidence_id = ANY($1) LIMIT 1",
        [accepted],
      )
    ).rows.length > 0;
    if (foundASearch) acceptedSet.add("MAP-FOUND");
    if (next.required_ids.every((id) => acceptedSet.has(id))) {
      await pool.query("UPDATE checkpoints SET hit = true, hit_at = now() WHERE code = $1", [next.code]);
      const isLast = (await pool.query("SELECT count(*)::int AS n FROM checkpoints WHERE hit = false")).rows[0].n === 0;
      // the last beat closes the file: 'solved', the same outcome as the rescue
      await pool.query(
        "UPDATE case_state SET guilt_percent = $1, concluded = $2, outcome = CASE WHEN $2::boolean THEN 'solved' ELSE outcome END, updated_at = now() WHERE id = 1",
        [next.guilt_after, isLast],
      );
      checkpointHit = next.code;
      solved = isLast;
      // MERCY's own line for the beat rides on the same turn, as its own
      // paragraph after the model's reply -- into the transcript too, so a
      // reload reads the same way.
      if (next.reaction) reply = reply + "\n\n" + next.reaction;
    }
  }

  await pool.query("INSERT INTO transcript (role, body, evidence_ids, checkpoint_hit) VALUES ('mercy', $1, $2, $3)", [reply, [], checkpointHit]);
  // after the closing line is in the transcript, so the lobby's next look
  // at the summary reads a finished file
  if (solved) await reportOutcome("solved");

  const fresh = (await pool.query("SELECT guilt_percent, concluded FROM case_state WHERE id = 1")).rows[0];
  res.json({ reply, guilt_percent: Number(fresh.guilt_percent), checkpoint_hit: checkpointHit, concluded: fresh.concluded });
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
    await client.query("UPDATE checkpoints SET hit = true, hit_at = now() WHERE code = 'located'");
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
  res.json({ missing_since: record.timestamp });
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
