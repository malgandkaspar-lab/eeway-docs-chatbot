require("dotenv").config();

const express = require("express");
const { loadIndex } = require("./lib/retrieve");
const { loadSemanticIndex } = require("./lib/semantic-retrieve");
const { createBackend } = require("./lib/llm");

const PORT = process.env.PORT || 3000;
const TOP_K = 5;
const MAX_MESSAGE_LEN = 2000;
const MAX_HISTORY_TURNS = 8; // user+assistant messages kept for context

function buildContext(results) {
  return results
    .map(
      (r, i) =>
        `[${i + 1}] ${r.chunk.title}${
          r.chunk.heading && r.chunk.heading !== r.chunk.title
            ? " - " + r.chunk.heading
            : ""
        }\nSource: ${r.chunk.url}\n${r.chunk.text}`
    )
    .join("\n\n---\n\n");
}

function buildSystemPrompt(context) {
  return `You are the support assistant for Eeway (an electronic waybill and warehouse management system). You answer questions about how to use the Eeway product, based ONLY on the documentation excerpts provided below.

Rules:
- Answer using only the information in the provided excerpts. Do not use outside knowledge about Eeway.
- If the excerpts don't contain the answer, say you don't know and suggest the user check the "Contacts & Support" page or the full docs at https://docs.eeway.eu.
- Keep answers concise and practical (use short paragraphs or numbered/bulleted steps when explaining a process).
- This is a chat bubble, not a document: do not use markdown headings (#, ##). Plain paragraphs and "1. ..." numbered/bulleted lists are fine; **bold** is fine for emphasis.
- When you use information from an excerpt, cite it inline like [1], [2] matching the excerpt numbers below.
- Never invent URLs, buttons, menu names, or features that are not mentioned in the excerpts.
- Always reply in the same language the user's question was written in, even if the excerpts you're using are in a different language (translate the relevant information rather than switching languages). Write that language correctly and fluently.

Documentation excerpts:

${context}`;
}

async function main() {
  let bm25;
  try {
    bm25 = loadIndex();
    console.log(`Loaded ${bm25.chunks.length} doc chunks into the keyword search index.`);
  } catch (err) {
    console.error(err.message);
    console.error('Run "npm run scrape" before starting the server.');
    process.exit(1);
  }

  let semantic = null;
  try {
    semantic = loadSemanticIndex();
    console.log(`Loaded ${semantic.chunks.length} doc chunks into the semantic search index.`);
  } catch (err) {
    console.warn(`Semantic search unavailable (${err.message}). Falling back to keyword search.`);
    console.warn('Run "npm run embed" to enable it (requires "ollama pull nomic-embed-text").');
  }

  async function search(query, topK) {
    if (semantic) {
      try {
        return await semantic.search(query, topK);
      } catch (err) {
        console.error(`Semantic search failed (${err.message}), falling back to keyword search.`);
      }
    }
    return bm25.search(query, topK);
  }

  const backend = await createBackend(process.env);
  if (backend) {
    console.log(`Using LLM backend: ${backend.name} (${backend.model})`);
  } else {
    console.warn(
      "No LLM backend available. Set ANTHROPIC_API_KEY in .env, or start Ollama " +
        "(https://ollama.com) with a model pulled, e.g.: ollama pull qwen3:8b"
    );
  }

  const app = express();
  app.use(express.json({ limit: "100kb" }));
  app.use(express.static("public"));

  app.post("/api/chat", async (req, res) => {
    try {
      if (!backend) {
        return res.status(500).json({
          error:
            "No LLM backend configured. Set ANTHROPIC_API_KEY in .env, or start a local Ollama model, then restart the server.",
        });
      }

      const { message, history } = req.body || {};
      if (typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ error: "Missing 'message' string." });
      }
      if (message.length > MAX_MESSAGE_LEN) {
        return res
          .status(400)
          .json({ error: `Message too long (max ${MAX_MESSAGE_LEN} chars).` });
      }

      let cleanHistory = [];
      if (Array.isArray(history)) {
        cleanHistory = history
          .filter(
            (m) =>
              m &&
              (m.role === "user" || m.role === "assistant") &&
              typeof m.content === "string" &&
              m.content.length <= MAX_MESSAGE_LEN
          )
          .slice(-MAX_HISTORY_TURNS)
          .map((m) => ({ role: m.role, content: m.content }));
      }

      const results = await search(message, TOP_K);
      const context = results.length
        ? buildContext(results)
        : "(No relevant excerpts were found for this question.)";

      const answer = await backend.generate({
        systemPrompt: buildSystemPrompt(context),
        history: cleanHistory,
        message,
      });

      const sources = results.map((r, i) => ({
        n: i + 1,
        title: r.chunk.title,
        url: r.chunk.url,
      }));

      res.json({ answer, sources });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Something went wrong answering that question." });
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({
      ok: true,
      chunks: bm25.chunks.length,
      retrieval: semantic ? "semantic" : "keyword",
      backend: backend ? { name: backend.name, model: backend.model } : null,
    });
  });

  app.listen(PORT, () => {
    console.log(`Eeway docs chatbot running at http://localhost:${PORT}`);
  });
}

main();
