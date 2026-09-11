// Runs a representative question per doc section through the live server
// (must be running on :3000) and saves the Q&A pairs, for reviewing answer
// quality/length across the whole site. Not part of the app itself - a
// one-off review tool. Results are written incrementally so partial
// progress survives if a request errors out.

const fs = require("fs");
const path = require("path");

const BASE = "http://localhost:3000";
const OUT_PATH = path.join(__dirname, "..", "data", "sample-qa.json");

const QUESTIONS = [
  { section: "Ülevaade", q: "Mis on Eeway ja mida see teeb?" },
  { section: "Liitumine", q: "Kuidas ma saan Eeway süsteemiga liituda?" },
  { section: "Kontaktid ja abi", q: "Kuidas ma saan toega ühendust võtta?" },
  { section: "Tarnijad", q: "Millised on Eeway eelised tarnijale?" },
  { section: "Transpordiettevõtted", q: "Millised on Eeway eelised transpordiettevõttele?" },
  { section: "Materjali vastuvõtja", q: "Millised on Eeway eelised materjali vastuvõtjale?" },
  { section: "Sõidukid ja juhid", q: "Kuidas lisada süsteemi uus sõiduk?" },
  { section: "Saatelehed", q: "Kuidas luua saatelehte?" },
  { section: "Tellimuse loomine", q: "Kuidas luua tellimust?" },
  { section: "Tellimuse kustutamine", q: "Kuidas kustutada tellimust?" },
  { section: "Alltarnija tellimus", q: "Mis on alltarnija tellimus?" },
  { section: "Loadmon", q: "Mis on mahu mõõtmine (Loadmon)?" },
  { section: "Kaalusild", q: "Kuidas kaalusilla integratsioon töötab?" },
  { section: "Sõiduki ligipääsu kontroll", q: "Mis on sõiduki ligipääsu kontroll?" },
  { section: "API", q: "Kas Eeway'l on API teiste süsteemidega liidestamiseks?" },
  { section: "KKK", q: "Kuidas saab saatelehti automaatselt lõpetada?" },
];

async function ask(question) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: question, history: [] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function main() {
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  console.log(`Backend: ${health.backend.name}/${health.backend.model}, retrieval: ${health.retrieval}\n`);

  const results = [];
  for (let i = 0; i < QUESTIONS.length; i++) {
    const { section, q } = QUESTIONS[i];
    const start = Date.now();
    process.stdout.write(`[${i + 1}/${QUESTIONS.length}] ${section}: "${q}" ... `);
    try {
      const { answer, sources } = await ask(q);
      const seconds = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`done (${seconds}s, ${answer.length} chars)`);
      results.push({ section, question: q, answer, sources, seconds: Number(seconds) });
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      results.push({ section, question: q, error: err.message });
    }
    fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2), "utf-8");
  }

  console.log(`\nWrote ${results.length} sample Q&A pairs to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
