// Thin abstraction over two interchangeable answer-generation backends:
// Anthropic's hosted Claude API, or a fully local model served by Ollama
// (https://ollama.com) - no API key, no internet call, runs on this machine.

const Anthropic = require("@anthropic-ai/sdk");

// Caps answer length for both backends so replies stay chat-sized instead
// of turning into full walkthroughs. ~400 tokens is roughly 5-8 short
// sentences or a ~6-step list - enough for a real answer, not a manual page.
const MAX_ANSWER_TOKENS = 400;

// Keeps the local model (and the embedder, see semantic-retrieve.js)
// resident in memory between requests. Ollama's default is 5 minutes, which
// is shorter than a normal gap between chat messages during interactive
// use - every request after a gap was paying a ~70-130s reload on top of
// generation. Trade-off: ~6GB stays resident for longer between uses.
const OLLAMA_KEEP_ALIVE = "30m";

function createAnthropicBackend({ apiKey, model }) {
  const client = new Anthropic({ apiKey });
  return {
    name: "anthropic",
    model,
    // onDelta, if given, is called with each text chunk as it streams in.
    // The full answer is still returned at the end either way.
    async generate({ systemPrompt, history, message, onDelta }) {
      const stream = client.messages.stream({
        model,
        max_tokens: MAX_ANSWER_TOKENS,
        system: systemPrompt,
        messages: [...history, { role: "user", content: message }],
      });
      if (onDelta) {
        stream.on("text", (delta) => onDelta(delta));
      }
      const final = await stream.finalMessage();
      return final.content
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
    async generate({ systemPrompt, history, message, onDelta }) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 240_000);
      try {
        const res = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            stream: true,
            think,
            keep_alive: OLLAMA_KEEP_ALIVE,
            options: {
              num_predict: MAX_ANSWER_TOKENS,
              // Default context window for qwen3:8b is 32 768 tokens, which
              // allocates a multi-GB KV cache during generation even though
              // our prompts are never more than ~1 500 tokens (system prompt
              // + 3 doc chunks + question + short history). Capping at 2 048
              // brings the KV cache down from several GB to a few hundred MB.
              num_ctx: 2048,
            },
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

        // Ollama streams newline-delimited JSON objects, one per token
        // chunk, e.g. {"message":{"content":"foo"},"done":false} ... the
        // last one has "done":true plus timing stats.
        let full = "";
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line) continue;
            const data = JSON.parse(line);
            const delta = data.message && data.message.content;
            if (delta) {
              full += delta;
              if (onDelta) onDelta(delta);
            }
          }
        }
        return full.trim();
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

function createGroqBackend({ apiKey, model }) {
  return {
    name: "groq",
    model,
    async generate({ systemPrompt, history, message, onDelta }) {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_ANSWER_TOKENS,
          stream: true,
          messages: [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: message },
          ],
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Groq request failed: HTTP ${res.status} ${text}`);
      }
      // OpenAI-compatible SSE: "data: {...}" lines, ending with "data: [DONE]"
      let full = "";
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") break;
          try {
            const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
            if (delta) { full += delta; if (onDelta) onDelta(delta); }
          } catch { continue; }
        }
      }
      return full.trim();
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

  if (provider === "groq") {
    if (!env.GROQ_API_KEY) return null;
    return createGroqBackend({ apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL || "llama-3.3-70b-versatile" });
  }
  if (provider === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) return null;
    return createAnthropicBackend({ apiKey: env.ANTHROPIC_API_KEY, model: env.CLAUDE_MODEL || "claude-haiku-4-5-20251001" });
  }
  if (provider === "ollama") {
    return createOllamaBackend({ baseUrl: ollamaBaseUrl, model: ollamaModel, think: ollamaThink });
  }

  // Auto-detect.
  if (env.GROQ_API_KEY) {
    return createGroqBackend({ apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL || "llama-3.3-70b-versatile" });
  }
  if (env.ANTHROPIC_API_KEY) {
    return createAnthropicBackend({ apiKey: env.ANTHROPIC_API_KEY, model: env.CLAUDE_MODEL || "claude-haiku-4-5-20251001" });
  }
  if (await isOllamaReachable(ollamaBaseUrl)) {
    return createOllamaBackend({ baseUrl: ollamaBaseUrl, model: ollamaModel, think: ollamaThink });
  }
  return null;
}

module.exports = { createBackend, createAnthropicBackend, createOllamaBackend, isOllamaReachable };
