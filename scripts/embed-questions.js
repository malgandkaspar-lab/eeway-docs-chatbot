// Precomputes embeddings for the canned questions in data/sample-qa.json
// so the server can match a live user question against them (see
// lib/question-cache.js) and skip the slow LLM call entirely on a hit.
// Run this whenever data/sample-qa.json's questions or answers change.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const { embed } = require("../lib/semantic-retrieve");

const QA_PATH = path.join(__dirname, "..", "data", "sample-qa.json");
const OUT_PATH = path.join(__dirname, "..", "data", "sample-qa-embeddings.json");

async function main() {
  if (!fs.existsSync(QA_PATH)) {
    console.error(`No ${QA_PATH} found. Run "node scripts/sample-qa.js" first.`);
    process.exit(1);
  }
  const items = JSON.parse(fs.readFileSync(QA_PATH, "utf-8")).filter((i) => !i.error);

  const out = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    process.stdout.write(`Embedding ${i + 1}/${items.length}: "${item.question}" ... `);
    // Both sides of this match are questions, not a query-vs-passage pair,
    // so embed with isQuery:true (the query-side convention) on both.
    const vector = await embed(item.question, { isQuery: true });
    out.push({ question: item.question, vector });
    console.log("done");
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(out), "utf-8");
  console.log(`\nWrote ${out.length} question embeddings to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
