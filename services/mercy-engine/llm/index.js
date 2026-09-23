// Pluggable so the model behind MERCY can be picked without touching
// server.js. Select with MERCY_LLM_PROVIDER: stub (default, no key),
// vertex (Gemini through Vertex AI -- see llm/vertex.js), anthropic (not wired).
const provider = process.env.MERCY_LLM_PROVIDER || "stub";

const providers = {
  stub: () => require("./stub"),
  anthropic: () => require("./anthropic"),
  vertex: () => require("./vertex"),   // Gemini on Google Cloud Vertex AI -- the event's model
};

if (!providers[provider]) {
  throw new Error(`Unknown MERCY_LLM_PROVIDER "${provider}". Known providers: ${Object.keys(providers).join(", ")}`);
}

const chosen = providers[provider]();

// Every provider answers status() so server.js can report which brain is
// speaking without knowing which one was chosen; a provider that has not
// been given one is reported by name, with nothing else claimed.
module.exports = {
  ...chosen,
  status: typeof chosen.status === "function" ? chosen.status : () => ({ provider, mode: provider }),
};
