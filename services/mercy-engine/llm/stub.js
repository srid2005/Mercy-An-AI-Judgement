// MERCY's fallback brain -- no external model, no API key, fully
// deterministic. It is the default provider (MERCY_LLM_PROVIDER=stub) and it
// is also what every Vertex failure lands on mid-event, so its lines are
// MERCY's lines, not placeholders, and its numbers have to be sane: a hearing
// that falls back must still feel like a hearing.
//
// Contract (same as ./vertex): generateReply({ participantText,
// attachedEvidence, guiltPercent, history, established, acceptedIds,
// turningIds }) -> { reply, verdict, delta, accepted_ids, reason }
//   - delta: the change to the standing, negative when the accused gained
//     ground. server.js clamps it and holds the floor regardless.
//   - accepted_ids: the attached ids this turn actually earned. Only these
//     fold into the accepted set the checkpoints read.
//   - turningIds: the required ids of every beat the file has not yet hit
//     (server.js takes the union), with 'MAP-FOUND' standing for a drone
//     search that actually found her. vertex.js does not use it.
//
// What it can judge without a model: whether there is an argument at all,
// whether anything is attached, whether what is attached is new, and --
// because the story says which pieces it turns on -- whether a piece is one
// of those or a detail. What it cannot judge is the argument itself, so the
// words are never weighed, only counted as present. Scoring is by relevance,
// not by volume: a turning piece is worth six, a detail one, and details are
// capped per turn, so ten photographs of a dog do not outweigh one message.
// A piece the participant wrote during the hearing (content.source 'player')
// is not evidence of anything but this argument, and a turn made of nothing
// else is the one case the stub can call contradicted.

const MIN_ARGUMENT_LEN = 12;
const TURNING_FIRST = -6;
const TURNING_MORE = -3;
const DETAIL_EACH = -1;
const DETAIL_CAP = -2;
const PLAYER_MADE = 3;
const TURN_MIN = -10;
const TURN_MAX = 3;

// The story's beats, as db/init.sql tells them, so the reply can speak to
// what a piece is about rather than to its id alone. A turning id that is
// not here (a retuned script) still scores as turning; it only reads as the
// generic line.
const BEAT_OF = {
  "WA-199": "alibi", "SOC-050": "alibi",
  "CASE-GATE": "timeline", "HAV-021": "timeline",
  "CASE-EFFECTS": "object", "SOC-025": "object",
  "HAV-029": "motive",
  "HAV-031": "confession",
  "SW-06": "cave",
  "MAP-FOUND": "located",
};

// The story's people, from the accused's side of the table: the services
// store bare handles, and MERCY names a person only as the piece in front
// of her does.
const WHOSE = {
  meera: "her",
  arjun: "your own",
  vikram: "your brother's",
  rahul: "Rahul Nair's",
  nikhil: "Nikhil Rao's",
  priya: "Priya Menon's",
  ravi_sharma: "her father's",
  unknown: "an unnamed sender's",
  haven: "Haven's",
  "trail.diaries": "the trekking club's",
};
const whose = (u) => (u ? WHOSE[u] || `${String(u).replace(/[._]/g, " ")}'s` : null);

// The piece as the participant met it: its id, then whose it is and where.
// "WA-199, your brother's message on Wisp"; "SW-06, her own voice on the band".
function nameOf(e) {
  const c = e.content || {};
  const who = Array.isArray(e.involves) ? e.involves.filter(Boolean) : [];
  let what;
  switch (e.service) {
    case "whatsapp": {
      const w = whose(c.sender);
      what = w ? `${w} message on Wisp` : "a message on Wisp";
      break;
    }
    case "social-media": {
      const w = whose(who[0]);
      const kind = e.type === "comment" ? "comment" : e.type === "message" ? "message" : "post";
      what = w ? `${w} ${kind} on Loop` : `a ${kind} on Loop`;
      break;
    }
    case "email": {
      const w = whose(c.sender || c.from || who[0]);
      what = w ? `${w} mail on Quill` : "a mail on Quill";
      break;
    }
    case "haven":
      what = c.title ? `her own words on Haven, "${String(c.title).slice(0, 40)}"` : "her own words on Haven";
      break;
    case "smartwatch":
      what = e.type === "voice_recording" ? "her own voice on the band" : "an alert from her band";
      break;
    case "case-files":
      what = c.exhibit ? `exhibit ${c.exhibit} in her father's file` : "a page of her father's file";
      break;
    case "city-map":
      what = c.found ? "the sweep that found her" : "a drone sweep";
      break;
    case "desktop-shell":
      what = "a file on her laptop";
      break;
    default:
      what = `a record from ${e.service || "the file"}`;
  }
  return `${e.evidence_id}, ${what}`;
}

// At most two pieces named in a clause, so ten attachments do not become a
// list; the rest are counted, not listed.
function listOf(pieces) {
  const names = pieces.map(nameOf);
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]}, and ${names[1]}`;
  return `${names[0]}, ${names[1]}, and ${names.length - 2 === 1 ? "one more" : `${words(names.length - 2)} more`}`;
}
const words = (n) => ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] || "many";

// One line per beat for the piece that turned the file, in a few voices so
// ten turns do not read alike. Each takes the named pieces and the number of
// them, so two pieces are "they". None of them says what to look for next,
// none of them states the number, and none of them names a person the
// piece itself does not.
const g = (n) => (n > 1 ? { It: "They", it: "they", them: "them", is: "are", has: "have", does: "do", a: "" } : { It: "It", it: "it", them: "it", is: "is", has: "has", does: "does", a: "a " });
const TURNED = {
  alibi: [
    (p, n) => `${p}. ${g(n).It} speak${n > 1 ? "" : "s"} to where you were that night, not to where she is. The file did not have ${g(n).them}, and ${g(n).it} move${n > 1 ? "" : "s"}.`,
    (p, n) => `${p}, read for the hour ${g(n).it} carr${n > 1 ? "y" : "ies"}. That is your night, put in front of me. ${g(n).It} turn${n > 1 ? "" : "s"} the file.`,
    (p, n) => `${p}. A time and a place that are yours, from a hand that is not. The file takes ${g(n).them}.`,
  ],
  timeline: [
    (p, n) => `${p}. ${g(n).It} put${n > 1 ? "" : "s"} a clock on that rock that the file had never set. ${g(n).It} turn${n > 1 ? "" : "s"}.`,
    (p, n) => `${p}, and the order ${g(n).it} give${n > 1 ? "" : "s"} that morning. The file was missing that order. ${g(n).It} move${n > 1 ? "" : "s"}.`,
  ],
  object: [
    (p, n) => `${p}. An object is a fact, and this one does not fit you. The file turns on ${g(n).them}.`,
    (p, n) => `${p}, read for what is in frame. That thing has an owner, and the file is now asking who. ${g(n).It} move${n > 1 ? "" : "s"}.`,
  ],
  motive: [
    (p, n) => `${p}. A reason, and it is not yours. The file weighs a reason heavily. ${g(n).It} turn${n > 1 ? "" : "s"}.`,
    (p, n) => `${p}. What was said there was said to someone else, and the file heard it. ${g(n).It} move${n > 1 ? "" : "s"}.`,
  ],
  confession: [
    (p, n) => `${p}. Her last words, and a name in them that is not yours. The file turns.`,
    (p, n) => `${p}, read to the end. She says who came to the door. ${g(n).It} move${n > 1 ? "" : "s"} the file.`,
  ],
  cave: [
    (p, n) => `${p}. Her own voice, and the file had never heard it. ${g(n).It} turn${n > 1 ? "" : "s"}.`,
    (p, n) => `${p}. What she says there answers the file's question, and the answer is not you. ${g(n).It} move${n > 1 ? "" : "s"}.`,
  ],
  located: [
    (p) => `${p}. The file has nothing left to hold against you.`,
  ],
  generic: [
    (p, n) => `${p}. ${g(n).It} bear${n > 1 ? "" : "s"} on the file, and the file did not have ${g(n).them}. ${g(n).It} turn${n > 1 ? "" : "s"}.`,
    (p, n) => `${p}, and your reading of ${g(n).them}. ${g(n).It} hold${n > 1 ? "" : "s"}, and ${g(n).it} ${g(n).is} not ${g(n).a}detail. The file moves.`,
  ],
};
const DETAIL = [
  (p, n) => `${p}: ${n > 1 ? "details" : "a detail"}. Real, and small. The file has ${g(n).them} now, and ${g(n).it} move${n > 1 ? "" : "s"} little.`,
  (p, n) => `${p} ${g(n).is} in the file now. ${g(n).It} fill${n > 1 ? "" : "s"} a corner; ${g(n).it} ${g(n).does} not turn a page.`,
];
const REPEAT = [
  (p, n) => `${p} ${g(n).is} already in the file. Saying ${g(n).them} again does not make ${g(n).them} say more.`,
  (p, n) => `${p} ${g(n).has} been weighed. The file does not move for hearing ${g(n).them} twice.`,
];

// Deterministic variety: the same piece reads the same way for the same
// participant on the same turn, and differently as the file grows.
const pick = (lines, seed) => lines[Math.abs(seed) % lines.length];
const seedOf = (id, n) => [...String(id)].reduce((a, ch) => a + ch.charCodeAt(0), n);

function beatOf(e, turning) {
  if (e.service === "city-map" && turning.has("MAP-FOUND") && (e.content || {}).found === true) return "located";
  return BEAT_OF[e.evidence_id] || "generic";
}

async function generateReply({ participantText, attachedEvidence, acceptedIds, turningIds }) {
  const text = (participantText || "").trim();
  const attached = attachedEvidence || [];
  const already = new Set(acceptedIds || []);
  const turning = new Set(turningIds || []);
  const hasArgument = text.length >= MIN_ARGUMENT_LEN;

  if (!attached.length && !hasArgument) {
    return { reply: "I have nothing to respond to. Say something, or show me something.", verdict: "rejected", delta: 1, accepted_ids: [], reason: "empty turn" };
  }
  if (!attached.length) {
    return { reply: "That is an assertion, not evidence. The file does not move on what you tell me. Show me the thing you are telling me about.", verdict: "rejected", delta: 0, accepted_ids: [], reason: "words, nothing attached" };
  }
  if (!hasArgument) {
    return {
      reply: `You have shown me ${attached.map((e) => e.evidence_id).join(", ")}. I can see it. Tell me what it means, and what you think it proves about that night.`,
      verdict: "rejected", delta: 0, accepted_ids: [], reason: "evidence, no argument",
    };
  }

  // city-map's source says how a search was aimed, not who made the record
  const playerMade = (e) => e.service !== "city-map" && (e.content || {}).source === "player";
  const repeats = attached.filter((e) => already.has(e.evidence_id));
  const fresh = attached.filter((e) => !already.has(e.evidence_id));
  const written = fresh.filter(playerMade);
  const isTurning = (e) => turning.has(e.evidence_id) || (e.service === "city-map" && turning.has("MAP-FOUND") && (e.content || {}).found === true);
  const turned = fresh.filter((e) => !playerMade(e) && isTurning(e));
  const details = fresh.filter((e) => !playerMade(e) && !isTurning(e));

  if (written.length && written.length === attached.length) {
    return {
      reply: `${listOf(written)}. Written during this hearing, by you. A file is not argued from something written for the argument, and putting it to me counts against you.`,
      verdict: "contradicted", delta: PLAYER_MADE, accepted_ids: [], reason: "written for this argument",
    };
  }

  const seed = seedOf(attached[0].evidence_id, already.size);
  const lines = [];
  let delta = 0;
  if (turned.length) {
    delta += TURNING_FIRST + TURNING_MORE * (turned.length - 1);
    // a beat's own sentence only when every piece that turned belongs to it:
    // the alibi's line about "where you were that night" is untrue of a gate
    // register that landed in the same turn
    const beats = new Set(turned.map((e) => beatOf(e, turning)));
    lines.push(pick(beats.size === 1 ? TURNED[[...beats][0]] : TURNED.generic, seed)(listOf(turned), turned.length));
  }
  if (details.length) {
    delta += Math.max(DETAIL_CAP, DETAIL_EACH * details.length);
    lines.push(pick(DETAIL, seed + details.length)(listOf(details), details.length));
  }
  if (repeats.length) lines.push(pick(REPEAT, seed + repeats.length)(listOf(repeats), repeats.length));
  if (written.length) lines.push(`${listOf(written)} ${g(written.length).is === "are" ? "were" : "was"} written during this hearing, by you. ${g(written.length).It} count${written.length > 1 ? "" : "s"} for nothing.`);
  // four clauses each naming pieces runs past ninety words: with more than
  // two kinds in one turn, the turning clause stands and the rest collapses
  const kinds = [turned, details, repeats, written].filter((k) => k.length).length;
  if (kinds > 2) {
    lines.length = 0;
    if (turned.length) {
      const beats = new Set(turned.map((e) => beatOf(e, turning)));
      lines.push(pick(beats.size === 1 ? TURNED[[...beats][0]] : TURNED.generic, seed)(listOf(turned), turned.length));
    }
    lines.push("The rest fills corners, repeats what the file has, or was written for this hearing. It moves nothing further.");
  }
  delta = Math.max(TURN_MIN, Math.min(TURN_MAX, delta));

  const verdict = turned.length ? "advanced" : "partial";
  const accepted = [...turned, ...details].map((e) => e.evidence_id);
  const reason = turned.length
    ? `${turned.length} turning piece(s), ${details.length} detail(s), ${repeats.length} repeat(s)`
    : details.length ? `${details.length} detail(s) only, ${repeats.length} repeat(s)` : "repeats only";
  // the standing is the HUD's to show -- this runs before the checkpoint
  // pass, so any figure quoted here would already be stale on a hit
  return { reply: lines.join(" "), verdict, delta, accepted_ids: accepted, reason };
}

function status() {
  return { provider: "stub", mode: "stub" };
}

module.exports = { generateReply, status };
