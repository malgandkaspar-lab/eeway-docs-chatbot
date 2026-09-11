// Serves pre-written, pre-corrected answers instantly for questions close
// in meaning to the ones in data/sample-qa.json, instead of waiting ~60-120s
// for the local LLM to regenerate an answer it has effectively already
// given before. Falls through to live generation on anything else.

const fs = require("fs");
const path = require("path");
const { embed, cosineSimilarity } = require("./semantic-retrieve");

// Cosine similarity above this counts as "the same question, reworded".
// Calibrated empirically against data/sample-qa.json with bge-m3: real
// paraphrases (same or cross-language, e.g. an English rewording of an
// Estonian cached question) scored 0.87-0.88; genuinely different
// questions on a related topic (e.g. "can I edit an order later?" vs.
// "how do I create an order?") capped around 0.68-0.76. 0.83 sits in
// that gap with margin on both sides.
const MATCH_THRESHOLD = 0.83;

class QuestionCache {
  constructor(entries) {
    this.entries = entries; // [{ question, answer, sources, vector }]
  }

  // Only meaningful for a fresh question (no prior conversation context) -
  // a canned answer can't account for follow-up context like "and that one?".
  async match(query, history) {
    if (Array.isArray(history) && history.length > 0) return null;
    if (this.entries.length === 0) return null;

    const queryVector = await embed(query, { isQuery: true });
    let best = null;
    for (const entry of this.entries) {
      const score = cosineSimilarity(queryVector, entry.vector);
      if (!best || score > best.score) best = { entry, score };
    }
    if (best && best.score >= MATCH_THRESHOLD) {
      return { answer: best.entry.answer, sources: best.entry.sources, score: best.score };
    }
    return null;
  }
}

function loadQuestionCache({
  qaPath = path.join(__dirname, "..", "data", "sample-qa.json"),
  embeddingsPath = path.join(__dirname, "..", "data", "sample-qa-embeddings.json"),
} = {}) {
  if (!fs.existsSync(qaPath) || !fs.existsSync(embeddingsPath)) {
    return new QuestionCache([]); // cache is optional - empty means always fall through
  }
  const items = JSON.parse(fs.readFileSync(qaPath, "utf-8")).filter((i) => !i.error);
  const embeddings = JSON.parse(fs.readFileSync(embeddingsPath, "utf-8"));
  const vectorByQuestion = new Map(embeddings.map((e) => [e.question, e.vector]));

  const entries = items
    .filter((item) => vectorByQuestion.has(item.question))
    .map((item) => ({
      question: item.question,
      answer: item.answer,
      sources: item.sources,
      vector: vectorByQuestion.get(item.question),
    }));

  return new QuestionCache(entries);
}

module.exports = { QuestionCache, loadQuestionCache, MATCH_THRESHOLD };
