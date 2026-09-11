require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { loadSemanticIndex } = require("../lib/semantic-retrieve");

async function main() {
  const query = process.argv.slice(2).join(" ");
  if (!query) {
    console.error("Usage: node scripts/debug-search.js <query>");
    process.exit(1);
  }
  const index = loadSemanticIndex();
  const results = await index.search(query, 10);
  for (const r of results) {
    console.log(
      `${r.score.toFixed(4)}  [${r.chunk.lang}] ${r.chunk.title} (${r.chunk.id})`
    );
  }
}

main();
