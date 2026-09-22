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

module.exports = providers[provider]();
