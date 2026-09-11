// Precomputes an embedding vector for every chunk in data/docs.json and
// saves them to data/embeddings.json. Run this once after every
// "npm run scrape". Requires Ollama running locally with the
// nomic-embed-text model pulled (`ollama pull nomic-embed-text`).

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const { embed } = require("../lib/semantic-retrieve");

const DOCS_PATH = path.join(__dirname, "..", "data", "docs.json");
const OUT_PATH = path.join(__dirname, "..", "data", "embeddings.json");

async function main() {
  if (!fs.existsSync(DOCS_PATH)) {
    console.error(`No ${DOCS_PATH} found. Run "npm run scrape" first.`);
    process.exit(1);
  }
  const chunks = JSON.parse(fs.readFileSync(DOCS_PATH, "utf-8"));

  const out = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const text = [c.title, c.heading, c.text].filter(Boolean).join("\n\n");
    process.stdout.write(`Embedding ${i + 1}/${chunks.length}: ${c.id} ... `);
    const vector = await embed(text);
    out.push({ id: c.id, vector });
    console.log("done");
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(out), "utf-8");
  console.log(`\nWrote ${out.length} embeddings to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
