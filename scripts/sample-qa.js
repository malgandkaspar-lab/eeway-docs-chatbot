// Runs representative questions through the live server (must be running
// on :3000) and saves the Q&A pairs - both as a manual quality-review set
// and, via scripts/embed-questions.js, as the instant-answer cache backing
// lib/question-cache.js.
//
// Safe to re-run: any question that already has a saved (non-error) answer
// is skipped, so adding new entries to QUESTIONS never re-asks (and never
// silently overwrites) ones that have already been reviewed/corrected.
// Pass --force to re-ask everything anyway.

const fs = require("fs");
const path = require("path");

const BASE = "http://localhost:3000";
const OUT_PATH = path.join(__dirname, "..", "data", "sample-qa.json");
const FORCE = process.argv.includes("--force");

const QUESTIONS = [
  // Estonian - one per doc section (original set; corrected for grammar
  // after generation, see data/sample-qa.json).
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

  // English - multiple realistic phrasings per high-traffic topic, so a
  // wider range of real questions land in the instant-answer cache.
  { section: "Overview", q: "What is Eeway?" },
  { section: "Overview", q: "What does Eeway do?" },
  { section: "How to join", q: "How do I sign up for Eeway?" },
  { section: "Contacts & Support", q: "How do I contact support?" },
  { section: "Contacts & Support", q: "Who do I contact if I have a problem?" },
  { section: "Vehicles & Drivers", q: "How do I add a new vehicle?" },
  { section: "Vehicles & Drivers", q: "How can I register a vehicle in the system?" },
  { section: "Waybills", q: "How do I create a waybill?" },
  { section: "Waybills", q: "How can I make a waybill without an order?" },
  { section: "Create Order", q: "How do I create an order?" },
  { section: "Create Order", q: "How can I make a new order?" },
  { section: "Create Order", q: "What fields are required when creating an order?" },
  { section: "Delete Order", q: "How do I delete an order?" },
  { section: "Delete Order", q: "Can I remove an order after creating it?" },
  { section: "Weighbridge", q: "How does the weighbridge integration work?" },
  { section: "API", q: "Does Eeway have an API?" },
];

// The server streams newline-delimited JSON: a "meta" line (sources,
// cached), then "delta" lines as text arrives, then "done" (or "error").
async function ask(question) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: question, history: [] }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  const text = await res.text();
  let answer = "";
  let sources = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const evt = JSON.parse(trimmed);
    if (evt.type === "meta") sources = evt.sources;
    else if (evt.type === "delta") answer += evt.text;
    else if (evt.type === "error") throw new Error(evt.message || "generation error");
  }
  return { answer: answer.trim(), sources };
}

async function main() {
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  console.log(`Backend: ${health.backend.name}/${health.backend.model}, retrieval: ${health.retrieval}\n`);

  const existing = fs.existsSync(OUT_PATH)
    ? JSON.parse(fs.readFileSync(OUT_PATH, "utf-8"))
    : [];
  const existingByQuestion = new Map(existing.map((item) => [item.question, item]));

  const results = [];
  for (let i = 0; i < QUESTIONS.length; i++) {
    const { section, q } = QUESTIONS[i];
    const prior = existingByQuestion.get(q);
    if (prior && !prior.error && !FORCE) {
      console.log(`[${i + 1}/${QUESTIONS.length}] ${section}: "${q}" ... skipped (already have an answer)`);
      results.push(prior);
      fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2), "utf-8");
      continue;
    }

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
