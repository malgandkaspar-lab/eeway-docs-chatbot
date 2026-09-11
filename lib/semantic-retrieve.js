// Semantic search over the scraped doc chunks using a local embedding
// model served by Ollama (nomic-embed-text). Chunk vectors are
// precomputed by scripts/embed-docs.js and cached in data/embeddings.json;
// only the query is embedded at request time.
//
// This replaces plain keyword (BM25) matching so that a question and a
// doc page can match on MEANING even when they use different words for
// the same thing (e.g. Estonian "veoseleht" vs "saateleht", both meaning
// "waybill") - something pure keyword search can never do.

const fs = require("fs");
const path = require("path");

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";

// nomic-embed-text is asymmetric: it was trained to encode a short query
// differently from a long passage, and expects a prefix marking which one
// you're giving it (Nomic's documented convention). bge-m3, unlike older
// BGE versions, was explicitly trained NOT to need a query instruction -
// adding one measurably hurt ranking in testing, so it's left unprefixed.
const QUERY_PREFIX = {
  "nomic-embed-text": "search_query: ",
};
const PASSAGE_PREFIX = {
  "nomic-embed-text": "search_document: ",
};

async function embed(text, { isQuery = false } = {}) {
  const prefix = (isQuery ? QUERY_PREFIX : PASSAGE_PREFIX)[EMBED_MODEL] || "";
  const res = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: prefix + text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ollama embeddings request failed: HTTP ${res.status} ${body}`);
  }
  const data = await res.json();
  return data.embedding;
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

class SemanticIndex {
  constructor(chunks, vectors) {
    this.chunks = chunks;
    this.vectors = vectors; // parallel array: vectors[i] is chunks[i]'s embedding
  }

  async search(query, topK = 5) {
    const queryVector = await embed(query, { isQuery: true });
    const scored = this.chunks.map((chunk, i) => ({
      chunk,
      score: cosineSimilarity(queryVector, this.vectors[i]),
    }));
    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}

function loadSemanticIndex({
  docsPath = path.join(__dirname, "..", "data", "docs.json"),
  embeddingsPath = path.join(__dirname, "..", "data", "embeddings.json"),
} = {}) {
  if (!fs.existsSync(docsPath)) {
    throw new Error(`No scraped docs found at ${docsPath}. Run "npm run scrape" first.`);
  }
  if (!fs.existsSync(embeddingsPath)) {
    throw new Error(
      `No embeddings found at ${embeddingsPath}. Run "npm run embed" first.`
    );
  }

  const chunks = JSON.parse(fs.readFileSync(docsPath, "utf-8"));
  const embeddings = JSON.parse(fs.readFileSync(embeddingsPath, "utf-8"));
  const vectorById = new Map(embeddings.map((e) => [e.id, e.vector]));

  const vectors = chunks.map((c) => {
    const v = vectorById.get(c.id);
    if (!v) {
      throw new Error(
        `Missing embedding for chunk ${c.id}. Run "npm run embed" to regenerate.`
      );
    }
    return v;
  });

  return new SemanticIndex(chunks, vectors);
}

module.exports = { SemanticIndex, loadSemanticIndex, embed, cosineSimilarity };
