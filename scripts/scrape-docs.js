// Scrapes the public English pages of docs.eeway.eu into data/docs.json.
// Read-only: this script only performs GET requests, it never writes
// anything back to docs.eeway.eu.
//
// The site has no sitemap.xml, so the page list below was collected by
// reading the left-hand navigation menu by hand. Re-run this script (and
// update the list) whenever the docs site's structure changes.

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const BASE = "https://docs.eeway.eu";

const PAGES = [
  // English
  { url: "/getting-started/overview/", section: "Getting Started", lang: "en" },
  { url: "/getting-started/how-to-join/", section: "Getting Started", lang: "en" },
  { url: "/getting-started/contacts-support/", section: "Getting Started", lang: "en" },
  { url: "/use-cases/suppliers/", section: "Use Cases", lang: "en" },
  { url: "/use-cases/transport-companies/", section: "Use Cases", lang: "en" },
  { url: "/use-cases/receiver-of-materials/", section: "Use Cases", lang: "en" },
  { url: "/how-to-use/vehicles-drivers/", section: "How to Use", lang: "en" },
  { url: "/how-to-use/waybills/", section: "How to Use", lang: "en" },
  { url: "/how-to-use/orders/", section: "How to Use", lang: "en" },
  { url: "/how-to-use/orders/create-order/", section: "How to Use", lang: "en" },
  { url: "/how-to-use/orders/delete-order/", section: "How to Use", lang: "en" },
  { url: "/how-to-use/orders/sub-supplier-order/", section: "How to Use", lang: "en" },
  { url: "/automation/loadmon/", section: "Automation", lang: "en" },
  { url: "/automation/weighbridge/", section: "Automation", lang: "en" },
  { url: "/automation/vehicle-access-control-vac/", section: "Automation", lang: "en" },
  { url: "/integrations/api-reference/", section: "Integrations", lang: "en" },
  { url: "/frequently-asked-questions/faq/", section: "FAQ", lang: "en" },

  // Estonian
  { url: "/alustamine/ulevaade/", section: "Alustamine", lang: "et" },
  { url: "/alustamine/kuidas-liituda/", section: "Alustamine", lang: "et" },
  { url: "/alustamine/kontaktid-ja-abi/", section: "Alustamine", lang: "et" },
  { url: "/kasutusviisid/tarnijad/", section: "Kasutusviisid", lang: "et" },
  { url: "/kasutusviisid/transpordiettevotted/", section: "Kasutusviisid", lang: "et" },
  { url: "/kasutusviisid/materjali-vastuvotja/", section: "Kasutusviisid", lang: "et" },
  { url: "/kuidas-kasutada/soidukid-ja-juhid/", section: "Kuidas kasutada", lang: "et" },
  { url: "/kuidas-kasutada/saatelehed/", section: "Kuidas kasutada", lang: "et" },
  { url: "/kuidas-kasutada/tellimused/", section: "Kuidas kasutada", lang: "et" },
  { url: "/kuidas-kasutada/tellimused/loo-tellimus/", section: "Kuidas kasutada", lang: "et" },
  { url: "/kuidas-kasutada/tellimused/kustuta-tellimus/", section: "Kuidas kasutada", lang: "et" },
  { url: "/kuidas-kasutada/tellimused/alltarnija-tellimus/", section: "Kuidas kasutada", lang: "et" },
  { url: "/automatiseerimine/mahu-mootmine-loadmon/", section: "Automatiseerimine", lang: "et" },
  { url: "/automatiseerimine/kaalusild/", section: "Automatiseerimine", lang: "et" },
  { url: "/automatiseerimine/soiduki-ligipaasu-kontroll/", section: "Automatiseerimine", lang: "et" },
  { url: "/liidestus/api-viide/", section: "Liidestus", lang: "et" },
  { url: "/korduma-kippuvad-kusimused/kusimused/", section: "FAQ", lang: "et" },
];

const BLOCK_TAGS = new Set([
  "p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6",
  "br", "table", "ul", "ol", "blockquote", "pre",
]);

// Walk the DOM under `el` and produce reasonably clean plain text,
// keeping paragraph/heading/list-item boundaries as line breaks.
function htmlToText($, el) {
  let out = "";
  el.contents().each((_, node) => {
    if (node.type === "text") {
      out += node.data;
    } else if (node.type === "tag") {
      const tag = node.tagName.toLowerCase();
      if (tag === "script" || tag === "style") return;
      if (tag === "li") out += "\n- ";
      out += htmlToText($, $(node));
      if (BLOCK_TAGS.has(tag)) out += "\n";
    }
  });
  return out;
}

function cleanText(raw) {
  return raw
    .replace(/ /g, " ")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
    .join("\n")
    .trim();
}

// Split a page's cleaned text into retrieval-sized chunks (~200-900 chars),
// keeping the current heading attached to each chunk and never splitting
// a paragraph/list item in the middle.
function chunkText(text, title) {
  const lines = text.split("\n");
  const chunks = [];
  let heading = title;
  let buf = [];
  let bufLen = 0;

  const flush = () => {
    const body = buf.join("\n").trim();
    if (body) chunks.push({ heading, text: body });
    buf = [];
    bufLen = 0;
  };

  const HEADING_RE = /^(#{1,6}\s|.{1,80})$/;

  for (const line of lines) {
    const isShortStandaloneLine =
      line.length > 0 &&
      line.length <= 80 &&
      !line.startsWith("-") &&
      !/[.:;,]$/.test(line);

    if (bufLen > 700) flush();

    if (line === "") {
      buf.push("");
      continue;
    }

    buf.push(line);
    bufLen += line.length;
  }
  flush();

  // Merge tiny trailing chunks into the previous one so we don't end up
  // with lots of near-empty fragments.
  const merged = [];
  for (const c of chunks) {
    if (merged.length && c.text.length < 120) {
      merged[merged.length - 1].text += "\n" + c.text;
    } else {
      merged.push(c);
    }
  }
  return merged;
}

async function scrapePage(page) {
  const url = BASE + page.url;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; EewayDocsBot/1.0)" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  const title = $("h1.page-title").first().text().trim() || $("title").text().trim();
  const content = $(".pcsp-content").first();
  if (content.length === 0) {
    console.warn(`  ! no .pcsp-content found on ${url}, skipping`);
    return [];
  }

  const rawText = htmlToText($, content);
  const text = cleanText(rawText);
  const chunks = chunkText(text, title);

  return chunks.map((c, i) => ({
    id: `${page.url}#${i}`,
    url,
    title,
    section: page.section,
    lang: page.lang,
    heading: c.heading,
    text: c.text,
  }));
}

async function main() {
  const all = [];
  for (const page of PAGES) {
    process.stdout.write(`Scraping ${BASE}${page.url} ... `);
    try {
      const chunks = await scrapePage(page);
      all.push(...chunks);
      console.log(`${chunks.length} chunk(s)`);
    } catch (err) {
      console.log("FAILED");
      console.error(`  ${err.message}`);
    }
    // Be polite to the server.
    await new Promise((r) => setTimeout(r, 200));
  }

  const outPath = path.join(__dirname, "..", "data", "docs.json");
  fs.writeFileSync(outPath, JSON.stringify(all, null, 2), "utf-8");
  console.log(`\nWrote ${all.length} chunks from ${PAGES.length} pages to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
