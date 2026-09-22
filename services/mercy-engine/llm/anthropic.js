// Not wired up yet -- placeholder so choosing MERCY_LLM_PROVIDER=anthropic
// fails loudly and explains what's missing, instead of silently doing
// nothing. See ANTHROPIC.md for the actual wiring once a model is picked.
async function generateReply() {
  throw new Error(
    "MERCY_LLM_PROVIDER=anthropic is selected but not implemented yet. " +
      "This needs an API key (ANTHROPIC_API_KEY) and the actual request/response " +
      "wiring in services/mercy-engine/llm/anthropic.js. Use MERCY_LLM_PROVIDER=stub " +
      "(the default) until that's done.",
  );
}

module.exports = { generateReply };
