// The default MERCY "brain" -- no external model, no API key, fully
// deterministic. Used until a real provider is wired in (see ../llm/index.js
// and ANTHROPIC.md). Keeps the rest of the service, and everything the
// console talks to, working end to end without one.
//
// Contract: generateReply({ participantText, attachedEvidence, guiltPercent,
// checkpointsRemaining }) -> { reply, coherent }
//   - reply: MERCY's line for this turn.
//   - coherent: whether this turn counts as a real argument (only coherent
//     turns fold their evidence into the accepted set that checkpoints
//     check against). The stub's rule: attaching at least one real piece of
//     evidence alongside real text is coherent; evidence with no text, or
//     text with no evidence, is not.

const MIN_ARGUMENT_LEN = 12;

async function generateReply({ participantText, attachedEvidence }) {
  const text = (participantText || "").trim();
  const hasEvidence = attachedEvidence.length > 0;
  const hasArgument = text.length >= MIN_ARGUMENT_LEN;
  const coherent = hasEvidence && hasArgument;

  if (!hasEvidence && !hasArgument) {
    return { reply: "I have nothing to respond to. Say something, or show me something.", coherent: false };
  }
  if (!hasEvidence) {
    return { reply: "That's an assertion, not evidence. What do you have to show me?", coherent: false };
  }
  if (!hasArgument) {
    const names = attachedEvidence.map((e) => e.evidence_id).join(", ");
    return { reply: `You've shown me ${names}. I can see it. Tell me what it means.`, coherent: false };
  }

  const names = attachedEvidence.map((e) => e.evidence_id).join(" and ");
  return {
    // the standing is the HUD's to show -- this runs before the checkpoint
    // pass, so any figure quoted here would already be stale on a hit
    reply: `Noted -- ${names}, and your reasoning for it. I'm re-weighing the file. [placeholder MERCY reply; the argument model is not wired in yet -- see ANTHROPIC.md.]`,
    coherent,
  };
}

module.exports = { generateReply };
