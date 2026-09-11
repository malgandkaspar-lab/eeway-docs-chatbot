// Tiny dependency-free BM25 lexical search over the scraped doc chunks.
// No embeddings/vector DB needed for a doc set this small (~a few dozen
// chunks) - plain BM25 keyword ranking is plenty and keeps this self-hosted.

const fs = require("fs");
const path = require("path");

const STOPWORDS = new Set([
  // English
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "to", "of", "in", "on", "for", "and", "or", "but", "with", "as", "at",
  "by", "from", "that", "this", "it", "its", "into", "how", "do", "does",
  "can", "i", "you", "your", "my", "me", "we", "our", "what", "which",
  "when", "where", "who", "will", "would", "should", "could", "if", "not",
  // Estonian
  "ja", "ning", "ega", "või", "aga", "kuid", "et", "kui", "sest", "ka",
  "on", "oli", "olid", "ei", "mis", "kes", "kus", "kuidas", "miks",
  "see", "seda", "selle", "need", "nende", "ma", "sa", "ta", "me", "te",
  "nad", "mina", "sina", "tema", "meie", "teie", "nende", "oma", "üks",
]);

// [\p{L}\p{N}] (Unicode letter/number) instead of [a-z0-9] so accented
// letters (e.g. Estonian õ/ä/ö/ü, Latvian ā/ē/ī) stay part of the word
// instead of being treated as separators.
function tokenize(text) {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(
    (t) => t.length > 1 && !STOPWORDS.has(t)
  );
}

class BM25Index {
  constructor(chunks, { k1 = 1.5, b = 0.75 } = {}) {
    this.k1 = k1;
    this.b = b;
    this.chunks = chunks;
    this.docs = chunks.map((c) =>
      tokenize([c.title, c.heading, c.text].filter(Boolean).join(" \n "))
    );
    this.N = this.docs.length;
    this.docLen = this.docs.map((d) => d.length);
    this.avgdl = this.docLen.reduce((a, l) => a + l, 0) / (this.N || 1);

    this.df = new Map(); // term -> number of docs containing it
    this.tf = this.docs.map((doc) => {
      const counts = new Map();
      for (const term of doc) counts.set(term, (counts.get(term) || 0) + 1);
      for (const term of counts.keys()) {
        this.df.set(term, (this.df.get(term) || 0) + 1);
      }
      return counts;
    });

    this.idf = new Map();
    for (const [term, df] of this.df.entries()) {
      this.idf.set(term, Math.log(1 + (this.N - df + 0.5) / (df + 0.5)));
    }
  }

  search(query, topK = 5) {
    const qTerms = tokenize(query);
    if (qTerms.length === 0) return [];

    const scores = new Array(this.N).fill(0);
    for (let i = 0; i < this.N; i++) {
      const tf = this.tf[i];
      const dl = this.docLen[i];
      let score = 0;
      for (const term of qTerms) {
        const f = tf.get(term);
        if (!f) continue;
        const idf = this.idf.get(term) || 0;
        const denom = f + this.k1 * (1 - this.b + (this.b * dl) / this.avgdl);
        score += idf * ((f * (this.k1 + 1)) / denom);
      }
      scores[i] = score;
    }

    return scores
      .map((score, i) => ({ chunk: this.chunks[i], score }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

function loadIndex(docsPath = path.join(__dirname, "..", "data", "docs.json")) {
  if (!fs.existsSync(docsPath)) {
    throw new Error(
      `No scraped docs found at ${docsPath}. Run "npm run scrape" first.`
    );
  }
  const chunks = JSON.parse(fs.readFileSync(docsPath, "utf-8"));
  return new BM25Index(chunks);
}

module.exports = { BM25Index, loadIndex, tokenize };
