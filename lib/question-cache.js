// Serves pre-written, pre-corrected answers instantly for questions close
// in meaning to the ones in data/sample-qa.json, instead of waiting ~60-120s
// for the local LLM to regenerate an answer it has effectively already
// given before. Falls through to live generation on anything else.

const fs = require("fs");
const path = require("path");
const { embed, cosineSimilarity } = require("./semantic-retrieve");

// Cosine similarity above this counts as "the same question, reworded".
// Calibrated empirically against the (now same-language-filtered, see
// detectLanguage below) 32-entry data/sample-qa.json with bge-m3: real
// paraphrases score 0.88+. Raised from an initial 0.83 after growing the
// cache surfaced a genuine confusable pair that scored HIGHER than some
// true paraphrases: "Can I edit an order after it is created?" scored
// 0.8645 against the cached "Can I remove an order after creating it?" -
// same sentence shape, different verb, wrong answer. 0.87 excludes every
// false positive found during calibration (highest: 0.8645) while still
// catching strong paraphrases (lowest true positive found: 0.88). A missed
// paraphrase just falls through to a slower but correct live answer; a
// false-positive hit gives a fast, confidently wrong one - so ties go to
// the higher threshold.
const MATCH_THRESHOLD = 0.80;

// Cheap EN/ET classifier: this app only ever needs to tell those two apart.
// Estonian diacritics are close to a sure signal; the word list covers the
// (surprisingly common) case of an Estonian question with none of them,
// e.g. "Kuidas kustutada tellimust?" - "Kuidas" alone is diagnostic since
// it isn't an English word. Used only to keep the cache from answering a
// question in the wrong language (see match() below), not for anything
// user-facing, so it doesn't need to be more sophisticated than this.
const ESTONIAN_MARKER_RE =
  /[õäöüšžÕÄÖÜŠŽ]|\b(kuidas|kas|mis|miks|kus|kes|mida|millised|saan|palun|teha|luua)\b/i;

function detectLanguage(text) {
  return ESTONIAN_MARKER_RE.test(text) ? "et" : "en";
}

class QuestionCache {
  constructor(entries) {
    this.entries = entries; // [{ question, answer, sources, vector, lang }]
  }

  // Only meaningful for a fresh question (no prior conversation context) -
  // a canned answer can't account for follow-up context like "and that one?".
  async match(query, history) {
    if (Array.isArray(history) && history.length > 0) return null;
    if (this.entries.length === 0) return null;

    // Restricted to same-language entries: a cross-lingual semantic match
    // can score high enough to pass MATCH_THRESHOLD (bge-m3 matches well
    // across languages) but would hand back a canned answer in the wrong
    // language, which live generation never does (it's told to always
    // reply in the asker's language). Better to fall through to a live,
    // correctly-worded answer than serve a fast wrong-language one.
    const queryLang = detectLanguage(query);
    const candidates = this.entries.filter((e) => e.lang === queryLang);
    if (candidates.length === 0) return null;

    const queryVector = await embed(query, { isQuery: true });
    let best = null;
    for (const entry of candidates) {
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
      lang: detectLanguage(item.question),
    }));

  return new QuestionCache(entries);
}

module.exports = { QuestionCache, loadQuestionCache, MATCH_THRESHOLD, detectLanguage };
