// Thin abstraction over two interchangeable answer-generation backends:
// Anthropic's hosted Claude API, or a fully local model served by Ollama
// (https://ollama.com) - no API key, no internet call, runs on this machine.

const Anthropic = require("@anthropic-ai/sdk");

// Caps answer length for both backends so replies stay chat-sized instead
// of turning into full walkthroughs. ~400 tokens is roughly 5-8 short
// sentences or a ~6-step list - enough for a real answer, not a manual page.
const MAX_ANSWER_TOKENS = 400;

function createAnthropicBackend({ apiKey, model }) {
  const client = new Anthropic({ apiKey });
  return {
    name: "anthropic",
    model,
    async generate({ systemPrompt, history, message }) {
      const response = await client.messages.create({
        model,
        max_tokens: MAX_ANSWER_TOKENS,
        system: systemPrompt,
        messages: [...history, { role: "user", content: message }],
      });
      return response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
    },
  };
}

function createOllamaBackend({ baseUrl, model, think }) {
  return {
    name: "ollama",
    model,
    async generate({ systemPrompt, history, message }) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 240_000);
      try {
        const res = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            stream: false,
            think,
            options: { num_predict: MAX_ANSWER_TOKENS },
            messages: [
              { role: "system", content: systemPrompt },
              ...history,
              { role: "user", content: message },
            ],
          }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Ollama request failed: HTTP ${res.status} ${text}`);
        }
        const data = await res.json();
        return (data.message && data.message.content || "").trim();
      } catch (err) {
        if (err.name === "AbortError") {
          throw new Error(
            "Local model timed out (240s). It may still be loading into memory - try again."
          );
        }
        throw err;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

async function isOllamaReachable(baseUrl) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${baseUrl}/api/version`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

// Picks a backend based on LLM_PROVIDER (explicit choice) or, if unset,
// prefers Anthropic when a key is present and falls back to a local Ollama
// model otherwise. Returns null if neither is usable.
async function createBackend(env) {
  const provider = (env.LLM_PROVIDER || "").toLowerCase();
  const ollamaBaseUrl = env.OLLAMA_BASE_URL || "http://localhost:11434";
  const ollamaModel = env.OLLAMA_MODEL || "qwen3:8b";
  const ollamaThink = env.OLLAMA_THINK === "true";

  if (provider === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) return null;
    return createAnthropicBackend({ apiKey: env.ANTHROPIC_API_KEY, model: env.CLAUDE_MODEL || "claude-haiku-4-5-20251001" });
  }
  if (provider === "ollama") {
    return createOllamaBackend({ baseUrl: ollamaBaseUrl, model: ollamaModel, think: ollamaThink });
  }

  // Auto-detect.
  if (env.ANTHROPIC_API_KEY) {
    return createAnthropicBackend({ apiKey: env.ANTHROPIC_API_KEY, model: env.CLAUDE_MODEL || "claude-haiku-4-5-20251001" });
  }
  if (await isOllamaReachable(ollamaBaseUrl)) {
    return createOllamaBackend({ baseUrl: ollamaBaseUrl, model: ollamaModel, think: ollamaThink });
  }
  return null;
}

module.exports = { createBackend, createAnthropicBackend, createOllamaBackend, isOllamaReachable };
