# Eeway Docs Chatbot

A small local chatbot that answers "how do I use Eeway" questions, grounded
in the public documentation at https://docs.eeway.eu. It only *reads* the
docs site (via `npm run scrape`) — nothing is ever written back to it.

How it works:
1. `npm run scrape` fetches the English and Estonian doc pages and saves
   clean text chunks to `data/docs.json`.
2. `npm run embed` computes a semantic embedding for each chunk (via a
   local Ollama model) and caches them in `data/embeddings.json`.
3. On a question, the server first checks it against a small cache of
   pre-written, pre-corrected answers (`data/sample-qa.json`, built with
   `node scripts/sample-qa.js`) using the same kind of semantic match — a
   close-enough paraphrase, in Estonian or English, gets that answer back
   in well under a second instead of waiting on the local model.
4. On a cache miss, it embeds the question and finds the most similar doc
   chunks by meaning (not just matching words — so e.g. Estonian
   "veoseleht" and "saateleht", two different words for "waybill", both
   correctly match the waybill docs).
5. It sends those excerpts + the question to an LLM (Claude, or a local
   model via Ollama), which answers using only that context, in the same
   language the question was asked in, and cites which excerpt(s) it used.

## Setup

```bash
npm install
cp .env.example .env
```

Choose one LLM backend in `.env` (this only affects answer *generation* —
search always uses the local embedding model, see below):

- **Claude (hosted, best quality)** — set `ANTHROPIC_API_KEY` to a key from
  https://console.anthropic.com/settings/keys. This is used automatically
  whenever the key is set.
- **Local model via Ollama (free, offline, no key)** — install
  [Ollama](https://ollama.com), pull a model (e.g. `ollama pull qwen2.5:3b`),
  make sure it's running, and set `LLM_PROVIDER=ollama` (+ `OLLAMA_MODEL`
  if you pulled a different model) in `.env`. Local models are slower and
  lower quality than Claude — this is especially noticeable for languages
  other than English (e.g. Estonian), where small local models are prone
  to grammar mistakes.

Search (finding the right doc excerpts) always runs locally via Ollama,
regardless of which LLM you pick for answers. Pull the embedding model
once:

```bash
ollama pull bge-m3
```

Fetch the docs content and build the search index (re-run both any time
the docs site changes):

```bash
npm run scrape
npm run embed
```

Optionally, build the instant-answer cache for common questions (skip
this if you'd rather every question go through live generation):

```bash
node scripts/sample-qa.js       # asks the running server 16 representative
                                 # questions and saves the answers - review/
                                 # edit data/sample-qa.json afterwards for
                                 # quality before the next step
node scripts/embed-questions.js # embeds those questions for cache matching
```

Start the server:

```bash
npm start
```

Then open http://localhost:3000 in your browser.

## Notes

- English and Estonian docs are indexed (Latvian is not, but could be
  added the same way). The page list scraped is hardcoded in
  [`scripts/scrape-docs.js`](scripts/scrape-docs.js) since the site has no
  sitemap — update that list if pages are added/removed/renamed.
- Retrieval is semantic (embedding-based), not plain keyword matching, so
  it matches on meaning across synonyms and languages. If the embedding
  index is missing or Ollama is unreachable, the server automatically
  falls back to keyword (BM25) search from `lib/retrieve.js` rather than
  failing outright.
- If a question isn't covered by the docs, the bot is instructed to say so
  and point to the Contacts & Support page rather than guessing.
- `GET /api/health` reports which backend is active (`anthropic` or
  `ollama`), whether retrieval is `semantic` or `keyword`, how many doc
  chunks are indexed, and how many questions are in the instant-answer
  cache — useful for checking your `.env` took effect after restarting
  the server.
- The instant-answer cache (`lib/question-cache.js`) only fires on the
  first message of a conversation (a cached answer can't account for
  follow-up context like "and how do I delete it?") and only above a
  0.83 cosine-similarity match — calibrated so real paraphrases (~0.87+)
  hit it and genuinely different questions (~0.76 or below) don't. A
  cache hit is marked `"cached": true` in the API response. To widen
  coverage, add more entries to `data/sample-qa.json` (by hand or via
  `scripts/sample-qa.js`), proofread the answers, then re-run
  `node scripts/embed-questions.js`.
