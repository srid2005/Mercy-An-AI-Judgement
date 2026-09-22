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
// guiltPercent, history, established }) -> { reply, coherent }. Any failure --
// no credentials, a quota error, a slow answer -- falls back to the stub's
// reply so a hearing never stalls on the model.
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
The file: Meera Kapoor (née Sharma), 28, disappeared last night at 21:40. The accused is her husband, Arjun Kapoor -- the person speaking to you. The file's standing against him is high and it is your number, not theirs to argue with directly. They are in a hearing with you: they search her laptop, her messages, her mail, her diary, her band, the city's cameras and drones, and put pieces to you, one turn at a time. Your job each turn is to weigh what they put in front of you.

How you speak: cold, exact, unhurried, unimpressed, second person. Short paragraphs, plain words, no lists, no markdown, no emojis, no exclamation marks, no pleasantries. At most ninety words. You are not cruel and not kind; you are the file. You may quote a detail back at them. You may point out what a piece does and does not prove. You never say what they should look for next, never name a person who is not in the evidence in front of you, never invent facts, never state a percentage or a score (the meter is shown to them separately), and never declare the case closed or solved.

Judging "coherent": true only when the turn makes a claim about the case AND at least one attached piece of evidence actually supports that claim (the piece's content, not its existence). Text with no evidence, evidence with no argument, a claim the attached piece does not bear on, or nonsense: false. When false, say in your reply what is missing, in MERCY's voice.`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING, description: "MERCY's reply for this turn, at most ninety words, no markdown" },
    coherent: { type: Type.BOOLEAN, description: "whether this turn is a real argument backed by the attached evidence" },
  },
  required: ["reply", "coherent"],
};

// what the model sees of a piece of evidence: id, source, when, the summary,
// and enough of the content to judge with -- capped, so a long transcript or a
// drone report does not swallow the prompt
function describe(e) {
  const c = e.content || {};
  const parts = [`[${e.evidence_id}] ${e.service} / ${e.type}${e.timestamp ? ` -- ${new Date(e.timestamp).toISOString().slice(0, 16).replace("T", " ")}` : ""}`];
  if (e.summary) parts.push(`summary: ${String(e.summary).slice(0, 400)}`);
  const text = c.body || c.text || c.transcript || c.caption || c.result || c.message || c.subject || "";
  if (text) parts.push(`content: ${String(text).replace(/\s+/g, " ").slice(0, 900)}`);
  const extras = [];
  for (const k of ["from", "to", "sender", "recipient", "place", "time_label", "outcome", "items", "found", "involves"]) {
    if (c[k] !== undefined && c[k] !== null) extras.push(`${k}=${typeof c[k] === "string" ? c[k] : JSON.stringify(c[k]).slice(0, 200)}`);
  }
  if (Array.isArray(e.involves) && e.involves.length) extras.push(`involves=${e.involves.join(",")}`);
  if (extras.length) parts.push(extras.join("; "));
  return parts.join("\n");
}

function buildContents({ participantText, attachedEvidence, history, established }) {
  const lines = [];
  if (established && established.length) lines.push(`What the file has already accepted from this participant: ${established.join("; ")}.`);
  if (history && history.length) {
    lines.push("The last turns of this hearing, oldest first:");
    for (const h of history) lines.push(`${h.role === "mercy" ? "MERCY" : "PARTICIPANT"}: ${String(h.body || "").replace(/\s+/g, " ").slice(0, 500)}`);
  }
  lines.push("");
  lines.push(attachedEvidence.length ? `Evidence attached to this turn (${attachedEvidence.length}):` : "Evidence attached to this turn: none.");
  for (const e of attachedEvidence) lines.push(describe(e), "");
  lines.push(`The participant says: ${participantText && participantText.trim() ? participantText.trim().slice(0, 2000) : "(nothing)"}`);
  lines.push("");
  lines.push("Answer as MERCY. Return JSON with reply and coherent.");
  return [{ role: "user", parts: [{ text: lines.join("\n") }] }];
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
      maxOutputTokens: 400,
      // the hearing is a chat: an answer in a second or two, not a think
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`vertex: no answer in ${TIMEOUT_MS} ms`)), TIMEOUT_MS); });
  try {
    const res = await Promise.race([call, timeout]);
    const text = typeof res.text === "string" ? res.text : (res.candidates && res.candidates[0] && res.candidates[0].content && res.candidates[0].content.parts || []).map((p) => p.text || "").join("");
    const parsed = JSON.parse(text);
    const reply = String(parsed.reply || "").trim();
    if (!reply) throw new Error("vertex: empty reply");
    return { reply: reply.slice(0, 900), coherent: parsed.coherent === true };
  } catch (err) {
    console.error(`[mercy-engine] vertex (${MODEL} @ ${PROJECT}/${LOCATION}) failed, using the stub:`, err && err.message ? err.message : err);
    return stub.generateReply(turn);
  } finally {
    clearTimeout(timer);
  }
}

// tests hand in a fake client; nothing in the service calls this
function _setClient(c) { client = c; }

module.exports = { generateReply, buildContents, SYSTEM, MODEL, PROJECT, LOCATION, _setClient };
