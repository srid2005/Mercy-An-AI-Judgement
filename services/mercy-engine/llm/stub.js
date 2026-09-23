// MERCY's fallback brain -- no external model, no API key, fully
// deterministic. It is the default provider (MERCY_LLM_PROVIDER=stub) and it
// is also what every Vertex failure lands on mid-event, so its lines are
// MERCY's lines, not placeholders, and its numbers have to be sane: a hearing
// that falls back must still feel like a hearing.
//
// Contract (same as ./vertex): generateReply({ participantText,
// attachedEvidence, guiltPercent, history, established, acceptedIds }) ->
// { reply, verdict, delta, accepted_ids, reason }
//   - delta: the change to the standing, negative when the accused gained
//     ground. server.js clamps it and holds the floor regardless.
//   - accepted_ids: the attached ids this turn actually earned. Only these
//     fold into the accepted set the checkpoints read.
//
// What it can judge without a model: whether there is an argument at all,
// whether anything is attached, and whether what is attached is new. It
// cannot judge whether the evidence bears on the claim, so it never returns
// 'contradicted' -- a turn only costs the participant when it is empty.

const MIN_ARGUMENT_LEN = 12;
// a first real piece is worth this much, each further piece in the same turn
// less, down to the floor the contract allows
const FIRST_PIECE = -5;
const EXTRA_PIECE = -2;
const MAX_TURN = -10;

async function generateReply({ participantText, attachedEvidence, acceptedIds }) {
  const text = (participantText || "").trim();
  const attached = attachedEvidence || [];
  const already = new Set(acceptedIds || []);
  const hasArgument = text.length >= MIN_ARGUMENT_LEN;

  if (!attached.length && !hasArgument) {
    return { reply: "I have nothing to respond to. Say something, or show me something.", verdict: "rejected", delta: 1, accepted_ids: [], reason: "empty turn" };
  }
  if (!attached.length) {
    return { reply: "That is an assertion, not evidence. The file does not move on what you tell me. Show me the thing you are telling me about.", verdict: "rejected", delta: 0, accepted_ids: [], reason: "words, nothing attached" };
  }
  const names = attached.map((e) => e.evidence_id);
  if (!hasArgument) {
    return {
      reply: `You have shown me ${names.join(", ")}. I can see it. Tell me what it means, and what you think it proves about that night.`,
      verdict: "rejected", delta: 0, accepted_ids: [], reason: "evidence, no argument",
    };
  }

  const fresh = attached.filter((e) => !already.has(e.evidence_id));
  if (!fresh.length) {
    return {
      reply: `${names.join(", ")} is already in the file. Arguing it again does not make it say more than it says. Bring me something the file has not weighed.`,
      verdict: "partial", delta: 0, accepted_ids: names, reason: "all attached evidence already accepted",
    };
  }

  const delta = Math.max(MAX_TURN, FIRST_PIECE + EXTRA_PIECE * (fresh.length - 1));
  const shown = fresh.map((e) => e.evidence_id).join(" and ");
  return {
    // the standing is the HUD's to show -- this runs before the checkpoint
    // pass, so any figure quoted here would already be stale on a hit
    reply: `${shown}, and your reading of it. It holds as far as it goes. I am re-weighing the file.`,
    verdict: "advanced",
    delta,
    accepted_ids: fresh.map((e) => e.evidence_id),
    reason: `${fresh.length} new piece(s) argued`,
  };
}

module.exports = { generateReply };
