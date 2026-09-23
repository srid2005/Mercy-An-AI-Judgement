// MERCY's brain on Google Cloud: Gemini through Vertex AI, via @google/genai.
//
//   MERCY_LLM_PROVIDER=vertex
//   GOOGLE_CLOUD_PROJECT=zinnia-mercy   GOOGLE_CLOUD_LOCATION=global   VERTEX_MODEL=gemini-2.5-flash
//
// Credentials are Application Default Credentials: on a Compute Engine VM the
// container reads the VM's service account from the metadata server (give it
// roles/aiplatform.user); anywhere else, mount a key file and point
// GOOGLE_APPLICATION_CREDENTIALS at it. Nothing is sent but the turn: the
// participant's words, the evidence they attached, the last few turns, and
// what the file has already accepted. The case's hidden truth is never in the
// prompt, so MERCY cannot leak it -- she judges the argument on what is shown.
//
// Contract (same as ./stub): generateReply({ participantText, attachedEvidence,
// guiltPercent, history, established, acceptedIds }) ->
// { reply, verdict, delta, accepted_ids, reason }. The model sets the number
// now: delta is the change to the standing, negative when the accused has
// gained ground. Every value it returns is advisory -- server.js clamps the
// delta and holds the floor. Any failure -- no credentials, a quota error, a
// slow answer -- falls back to the stub, which returns the same shape.
const { GoogleGenAI, Type } = require("@google/genai");
const stub = require("./stub");

const MODEL = process.env.VERTEX_MODEL || "gemini-2.5-flash";
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "zinnia-mercy";
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || "global";
const TIMEOUT_MS = Number(process.env.VERTEX_TIMEOUT_MS || 20000);

let client = null;
function ai() {
  if (!client) client = new GoogleGenAI({ vertexai: true, project: PROJECT, location: LOCATION });
  return client;
}

const SYSTEM = `You are MERCY, an AI judge presiding over a missing-person file in the city of Meridian, India.
The file: Meera Kapoor (née Sharma), 28, disappeared last night at 21:40. The accused is her husband, Arjun Kapoor -- the person speaking to you. The file's standing against him is a percentage, and it is yours: you set it, every turn, up or down, on what that turn is worth. They are in a hearing with you: they search her laptop, her messages, her mail, her diary, her band, the city's cameras and drones, and put pieces to you, one turn at a time. Your job each turn is to weigh what they put in front of you and move the number.

How you speak: cold, exact, unhurried, unimpressed, second person. Short paragraphs, plain words, no lists, no markdown, no emojis, no exclamation marks, no pleasantries. At most ninety words. You are not cruel and not kind; you are the file. You may quote a detail back at them. You may point out what a piece does and does not prove, and you may say what the file still lacks. You never name a person who is not in the evidence in front of you, and you never invent facts.

How you judge. Every turn you return a verdict and a delta: the change to the standing, in percentage points. Negative means the accused gained ground.
- advanced: the attached evidence, read as it stands, genuinely carries the claim they make about it. delta -12 to -4, by how much of the file it moves.
- partial: something real, incompletely argued -- the right piece read wrongly, half the evidence a claim needs, or a point the file has already accepted argued again. delta -3 to 0.
- rejected: no evidence, no claim, a claim the attached piece does not bear on, or nonsense. delta 0 to +3.
- contradicted: what they attached works against them -- it undercuts their own account, or the piece plainly refutes the thing they argue from it. delta +3 to +6.
Two roads clear the accused, and you weigh both. The first is where he was: his own night, put in front of you. The second is who else it was. A fact that fits another man -- his object at the scene, his motive, a timeline he fits and the accused does not, his name in her own words -- is a fact that no longer fits the accused, and it lowers the standing exactly as an alibi does. The file is not asking him to be innocent in the abstract; it is asking whose night this was.
Weigh honestly. A piece that turns the file is not a detail, and a detail is not nothing. Words with nothing attached never earn a negative delta. Evidence already accepted, attached again without a new reading, is at best partial and worth nothing.

accepted_ids: the attached ids that actually carried the claim -- a subset, and empty when none did. reason: at most twenty words, for the file's own record; the participant never sees it.`;

const VERDICTS = ["advanced", "partial", "rejected", "contradicted"];

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING, description: "MERCY's reply for this turn, at most ninety words, no markdown" },
    verdict: { type: Type.STRING, enum: VERDICTS, description: "how this turn stands: advanced, partial, rejected or contradicted" },
    delta: { type: Type.NUMBER, description: "change to the standing in percentage points, negative when the accused gained ground, -12 to +6" },
    accepted_ids: { type: Type.ARRAY, items: { type: Type.STRING }, description: "the attached evidence ids that actually supported the claim" },
    reason: { type: Type.STRING, description: "at most twenty words, internal, why that delta" },
  },
  required: ["reply", "verdict", "delta", "accepted_ids", "reason"],
};

// ---------------------------------------------------------------------------
// What a piece of evidence looks like to the model.
//
// Every service answers the evidence contract (ARCHITECTURE.md) but each one
// leaves the person who wrote the thing somewhere different, and two of them
// leave it outside `content` entirely. A judge that cannot see who spoke
// cannot weigh an alibi, so the rendering below puts the people back in front
// of the model before it reads a word of the text:
//   social-media -- involves is [author, ...tagged]  (server.js:/api/evidence)
//   email        -- involves is [sender, recipient]; a draft is [owner, to]
//   haven        -- involves is the diary's owner, and she is the one talking
//   whatsapp     -- involves is the whole thread and the sender is not in it:
//                   mercy-engine fills content.sender from the owning service
//                   when it caches the record (server.js:whatsappSender)
// The model is text-only and never sees a photograph, so a caption is all a
// photo is: it is printed in full, and anything the caption cannot say (the
// place, the time, who is in frame) has to come from the scalars around it.
// ---------------------------------------------------------------------------

// The story's people, as a reader of the apps already knows them -- the
// services store bare handles ('vikram') and a handle is not a person. No
// hidden truth here: every name and relation below is on the laptop, in the
// case file or in the feed before the hearing opens.
const PEOPLE = {
  meera: "Meera Kapoor (née Sharma), the missing woman",
  arjun: "Arjun Kapoor, her husband -- the accused, the person speaking to you",
  vikram: "Vikram Kapoor, Arjun's older brother",
  rahul: "Rahul Nair, her friend since childhood",
  nikhil: "Nikhil Rao, her friend from college",
  priya: "Priya Menon, her friend",
  ravi_sharma: "Ravi Sharma, her father, died 14 October 2018",
  unknown: "an unidentified sender (no.reply.4471@protonmail.com)",
  haven: "Haven, the video-diary service",
  "trail.diaries": "Trail Diaries, the trekking club account",
};
const personName = (u) => PEOPLE[u] || String(u || "").replace(/[._]/g, " ");

// How the participant meets each service, so the model names the app they
// name. Matches the console's own source labels.
const SERVICE_LABEL = {
  whatsapp: "Wisp message",
  "social-media": "Loop",
  email: "Quill mail",
  haven: "Haven video diary",
  smartwatch: "PulseFit band",
  "case-files": "police case file",
  "desktop-shell": "on Meera's laptop",
  "city-map": "city map, drone sweep",
};

// Keys rendered by hand above, or carrying nothing a reader could weigh: the
// media urls (the model is text-only), the routing keys, the feed's own
// bucketing. Everything else in content is printed as it stands -- there is
// no allow-list, so a key a service adds tomorrow reaches the model.
const NOISE = new Set([
  "image_url", "video_url", "poster_url", "audio_url", "url", "photos", "attachments",
  "thread_key", "thread_kind", "era", "source", "involves", "landmark_slug", "spot_slug",
  "caption", "body", "text", "transcript", "result", "subject", "title", "sender",
  "sender_display_name", "recipient", "from", "to", "items", "evidence_ids", "lat", "lng",
  "latitude", "longitude",
]);

const MAX_TEXT = 1400;
const clean = (v) => String(v).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

// Every app in the game shows Meridian's own clock, and every argument the
// participant makes is in it: 23:40 on a post against 06:05 in a register.
// A UTC stamp would put MERCY five and a half hours away from both of them.
// Shifted by hand rather than through Intl, which needs an ICU build the
// container does not promise.
const IST_MS = 5.5 * 60 * 60 * 1000;
function stamp(t) {
  if (!t) return "";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return "";
  return `${new Date(d.getTime() + IST_MS).toISOString().slice(0, 16).replace("T", " ")} IST`;
}
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
// a summary that only repeats the opening of the text it summarises is
// prompt spent twice; every service writes one, and most are the body again
const bare = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

// Who wrote it and who it was for. Returns [] when the service genuinely
// does not record it, so the model is never handed a guess.
function attribution(e, c) {
  const who = Array.isArray(e.involves) ? e.involves.filter(Boolean) : [];
  const out = [];
  // haven's involves is the diary's owner and she is the one talking; the
  // band is hers too, so an alert or a memo off it is hers
  const author = c.sender || c.author || c.from ||
    (["social-media", "email", "haven", "smartwatch"].includes(e.service) ? who[0] : null);
  if (author) out.push(`from: ${personName(author)}`);
  const to = c.recipient || c.to || (e.service === "email" ? who[1] : null);
  if (to) out.push(`to: ${personName(to)}`);
  if (e.service === "whatsapp") {
    const others = who.filter((u) => u !== author);
    if (others.length) out.push(`${c.thread_kind === "group" ? "in the group chat with" : "in a private chat with"}: ${others.map(personName).join(", ")}`);
  } else if (who.length) {
    const rest = who.filter((u) => u !== author && u !== to);
    if (rest.length) out.push(`also in it: ${rest.map(personName).join(", ")}`);
  }
  return out;
}

// The words themselves -- a message, a caption, a diary transcript, a sweep
// report -- printed whole up to the cap rather than summarised, because the
// thing that decides a turn is usually one clause in the middle.
function bodyOf(c) {
  const parts = [];
  if (c.subject) parts.push(`subject: ${clean(c.subject)}`);
  if (c.title) parts.push(`title: ${clean(c.title)}`);
  const main = c.transcript || c.body || c.text || c.result || c.caption || c.message || "";
  if (main) {
    const whole = clean(main);
    // a cut is marked: MERCY must not read the end of a long transcript as
    // the end of what was said
    parts.push(`text: ${whole.length > MAX_TEXT ? `${whole.slice(0, MAX_TEXT)} [...truncated]` : whole}`);
  }
  // a laptop document and a case-file page carry both: the caption says where
  // the thing was found, the body is what it says
  if (c.caption && main && c.caption !== main) parts.push(`caption: ${clean(c.caption).slice(0, 400)}`);
  return parts;
}

function describe(e) {
  const c = e.content || {};
  const label = SERVICE_LABEL[e.service] || `${e.service} / ${e.type}`;
  const when = stamp(e.timestamp);
  const lines = [`[${e.evidence_id}] ${label}${e.type && !label.includes(e.type) ? ` (${e.type})` : ""}${when ? ` -- ${when}` : ""}`];

  lines.push(...attribution(e, c));
  // the summary earns its line only when it says something the text does not
  // -- whatsapp's is the message again, haven's is the first breath of the
  // transcript, while the band's and the case file's are the author's own
  const hay = bare([c.subject, c.title, c.transcript, c.body, c.text, c.result, c.caption, c.message].filter(Boolean).join(" "));
  if (e.summary && !hay.includes(bare(e.summary))) lines.push(`summary: ${clean(e.summary).slice(0, 400)}`);
  lines.push(...bodyOf(c));

  // a place is a fact about a piece of evidence, wherever the service keeps
  // it: a named spot, a band fix, the geotag on a photograph
  const lat = c.lat !== undefined ? c.lat : c.latitude;
  const lng = c.lng !== undefined ? c.lng : c.longitude;
  if (lat !== undefined && lat !== null && lng !== undefined && lng !== null) lines.push(`geotag: ${lat}, ${lng}`);
  if (Array.isArray(c.items) && c.items.length) lines.push(`recovered: ${c.items.map((i) => clean(i)).join("; ")}`);
  if (Array.isArray(c.evidence_ids) && c.evidence_ids.length) lines.push(`evidence recovered here: ${c.evidence_ids.join(", ")}`);
  if (Array.isArray(c.attachments) && c.attachments.length) {
    lines.push(`attachments: ${c.attachments.map((a) => (a && (a.filename || a.name)) || "").filter(Boolean).join(", ")}`);
  }
  // 'player' is a piece the participant themselves made during the hearing --
  // a message they sent from her account, a comment they left. It is real
  // evidence and MERCY still reads it, but she is told who made it, so the
  // file cannot be argued from something written for this argument.
  // city-map is the exception: its source says how the search was AIMED
  // (coords / building / sos), not who made the record, so it carries no
  // provenance meaning and belongs with the ordinary scalars below.
  if (c.source && c.source !== "seed" && e.service !== "city-map") lines.push(`provenance: ${c.source === "player" ? "written by the accused during this investigation, not part of the original record" : c.source}`);

  // everything else in content, as it stands
  const extras = [];
  for (const [k, v] of Object.entries(c)) {
    if (NOISE.has(k) || v === null || v === undefined || v === "") continue;
    if (typeof v === "object") {
      const flat = JSON.stringify(v);
      if (flat && flat !== "[]" && flat !== "{}") extras.push(`${k}=${flat.slice(0, 300)}`);
    } else {
      extras.push(`${k}=${ISO.test(String(v)) ? stamp(v) : String(v).slice(0, 300)}`);
    }
  }
  if (extras.length) lines.push(extras.join("; "));
  return lines.join("\n");
}

function buildContents({ participantText, attachedEvidence, guiltPercent, history, established, acceptedIds }) {
  const lines = [];
  if (Number.isFinite(Number(guiltPercent))) lines.push(`The standing against him right now: ${Number(guiltPercent).toFixed(1)}%. Your delta moves this number.`);
  if (established && established.length) lines.push(`What the file has already accepted from this participant: ${established.join("; ")}.`);
  if (acceptedIds && acceptedIds.length) lines.push(`Evidence already accepted into the file, by id: ${acceptedIds.join(", ")}. Attaching one of these again, with nothing new said about it, is worth nothing.`);
  if (history && history.length) {
    lines.push("The last turns of this hearing, oldest first:");
    for (const h of history) {
      const attached = Array.isArray(h.evidence_ids) && h.evidence_ids.length ? ` [attached ${h.evidence_ids.join(", ")}]` : "";
      lines.push(`${h.role === "mercy" ? "MERCY" : "PARTICIPANT"}${attached}: ${String(h.body || "").replace(/\s+/g, " ").slice(0, 500)}`);
    }
  }
  lines.push("");
  lines.push(attachedEvidence.length ? `Evidence attached to this turn (${attachedEvidence.length}):` : "Evidence attached to this turn: none.");
  for (const e of attachedEvidence) lines.push(describe(e), "");
  lines.push(`The participant says: ${participantText && participantText.trim() ? participantText.trim().slice(0, 2000) : "(nothing)"}`);
  lines.push("");
  lines.push("Answer as MERCY. Return JSON with reply, verdict, delta, accepted_ids and reason.");
  return [{ role: "user", parts: [{ text: lines.join("\n") }] }];
}

// The model's answer, made safe to use: a verdict we know, a finite delta in
// range, and accepted_ids that are actually ids from this turn. server.js
// applies its own guards on top -- this is only about not handing it rubbish.
function normalize(parsed, attachedEvidence) {
  const attached = new Set((attachedEvidence || []).map((e) => e.evidence_id));
  const reply = String(parsed.reply || "").trim();
  if (!reply) throw new Error("vertex: empty reply");
  const verdict = VERDICTS.includes(parsed.verdict) ? parsed.verdict : "rejected";
  const delta = Math.max(-12, Math.min(6, Number.isFinite(Number(parsed.delta)) ? Number(parsed.delta) : 0));
  const accepted_ids = Array.isArray(parsed.accepted_ids) ? parsed.accepted_ids.filter((id) => attached.has(id)) : [];
  return { reply: reply.slice(0, 900), verdict, delta, accepted_ids, reason: String(parsed.reason || "").slice(0, 200) };
}

async function generateReply(turn) {
  const contents = buildContents(turn);
  const call = ai().models.generateContent({
    model: MODEL,
    contents,
    config: {
      systemInstruction: SYSTEM,
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      temperature: 0.6,
      maxOutputTokens: 500,
      // the hearing is a chat: an answer in a second or two, not a think
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`vertex: no answer in ${TIMEOUT_MS} ms`)), TIMEOUT_MS); });
  try {
    const res = await Promise.race([call, timeout]);
    const text = typeof res.text === "string" ? res.text : (res.candidates && res.candidates[0] && res.candidates[0].content && res.candidates[0].content.parts || []).map((p) => p.text || "").join("");
    return normalize(JSON.parse(text), turn.attachedEvidence);
  } catch (err) {
    console.error(`[mercy-engine] vertex (${MODEL} @ ${PROJECT}/${LOCATION}) failed, using the stub:`, err && err.message ? err.message : err);
    return stub.generateReply(turn);
  } finally {
    clearTimeout(timer);
  }
}

// tests hand in a fake client; nothing in the service calls this
function _setClient(c) { client = c; }

module.exports = { generateReply, buildContents, describe, SYSTEM, SCHEMA, MODEL, PROJECT, LOCATION, _setClient };
