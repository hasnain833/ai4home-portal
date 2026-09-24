import prisma from "../lib/prisma.js";
import { chat } from "../lib/llm.js";
import { parseLlmJson } from "../lib/sales-ai.js";

// Starter bubbles for the warranty chat. They are written from what the
// company's warranty KB actually covers — the AI turns the diagnostic matrix
// (and any other indexed documents) into things a homeowner would really type.
// When no AI is available they fall back to the matrix's own labels.

const SUGGESTION_COUNT = 6;
const TARGET_CHARS = 55;
const MAX_CHARS = 90;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// A fallback set is cached briefly, so the AI version replaces it soon after a
// key is added or a transient failure clears.
const FALLBACK_TTL_MS = 10 * 60 * 1000;

const MAX_CHUNKS_SCANNED = 5000;
const TOPICS_FOR_PROMPT = 60;
const OTHER_DOC_CHUNKS = 12;
const OTHER_DOC_CHARS = 400;

const COLUMNS = {
  Category: "category",
  "Service Type": "serviceType",
  "Problem Code": "problemCode",
  "Diagnostic Question": "question",
};

const cache = new Map();

export function readRow(content) {
  const row = {};

  for (const line of String(content || "").split("\n")) {
    const at = line.indexOf(": ");
    if (at < 0) continue;
    const field = COLUMNS[line.slice(0, at).trim()];
    if (field && !row[field]) row[field] = line.slice(at + 2).trim();
  }
  return row;
}

/** Distinct matrix topics, weighted by how many diagnostic rows each has. */
function matrixTopics(contents) {
  const byLabel = new Map();
  for (const content of contents) {
    const { category, serviceType, problemCode, question } = readRow(content);
    if (!serviceType || !problemCode) continue;
    const label = `${serviceType} — ${problemCode}`;
    const seen = byLabel.get(label);
    if (seen) seen.weight += 1;
    else byLabel.set(label, { label, category: category || "General", weight: 1, question: question || null });
  }
  return [...byLabel.values()];
}

function laneWeight(items) {
  return items.reduce((sum, i) => sum + i.weight, 0);
}

/** The matrix labels themselves, spread across categories. Used without AI. */
export function deriveSuggestions(contents, limit = SUGGESTION_COUNT) {
  const byCategory = new Map();
  for (const item of matrixTopics(contents)) {
    const lane = byCategory.get(item.category);
    if (lane) lane.push(item);
    else byCategory.set(item.category, [item]);
  }
  const lanes = [...byCategory.values()]
    .map((items) => items.sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label)))
    .sort((a, b) => laneWeight(b) - laneWeight(a) || a[0].label.localeCompare(b[0].label));

  const picked = [];
  for (let round = 0; picked.length < limit; round++) {
    let addedThisRound = false;

    for (const lane of lanes) {
      if (round >= lane.length) continue;
      picked.push(lane[round]);
      addedThisRound = true;
      if (picked.length >= limit) break;
    }
    if (!addedThisRound) break;
  }

  return picked.map((i) => i.label);
}

function clean(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const s = String(raw || "").replace(/\s+/g, " ").replace(/^["'\-•\d.)\s]+/, "").trim();
    if (s.length < 6 || s.length > MAX_CHARS) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= SUGGESTION_COUNT) break;
  }
  return out;
}

async function generate(companyId, chunks) {
  const topics = matrixTopics(chunks.map((c) => c.content))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, TOPICS_FOR_PROMPT);
  // Anything indexed that is not a matrix row: warranty guides, policies, FAQs.
  const others = chunks
    .filter((c) => !readRow(c.content).serviceType)
    .slice(0, OTHER_DOC_CHUNKS)
    .map((c) => String(c.content).replace(/\s+/g, " ").slice(0, OTHER_DOC_CHARS));

  if (!topics.length && !others.length) return [];

  const company = companyId
    ? await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } })
    : null;

  const system =
    "You write the starter messages shown as tappable bubbles in a home builder's warranty chat. " +
    "A homeowner taps one and it is sent to the warranty assistant as their first message. " +
    "Return ONLY a JSON array of strings.";

  const user = `Write ${SUGGESTION_COUNT} starter messages for ${company?.name || "this builder"}'s warranty chat.

Rules:
- Each is what a homeowner would actually type to report a problem with their home, in their own words, first person. Plain everyday language — "My kitchen sink is draining really slowly", not "Interior Lines / Fixtures — Slow or Clogged Drain".
- Under ${TARGET_CHARS} characters each. No numbering, no emoji, no trade jargon or category codes.
- Only problems the knowledge base below actually covers — the assistant can diagnose these well.
- Spread them across different kinds of problems (plumbing, electrical, doors, appliances, HVAC and so on). Favour the common, everyday ones; include at most one urgent-sounding one.
- If the other documents cover a general warranty question (what's covered, how long coverage lasts), one bubble may ask it.

## Problems the diagnostic knowledge base covers (most detailed first)
${topics.map((t) => `- [${t.category}] ${t.label}${t.question ? ` — first question asked: ${t.question}` : ""}`).join("\n") || "(none)"}

## Other warranty documents (excerpt)
${others.join("\n") || "(none)"}`;

  const raw = await chat({ companyId, system, user, maxTokens: 500 });
  return clean(parseLlmJson(raw, { array: true }));
}

export function invalidateSuggestions() {
  cache.clear();
}

export async function getWarrantySuggestions(companyId) {
  const key = companyId || "platform";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.suggestions;

  // Live documents only: a sandbox or retired document must not shape what
  // homeowners are offered.
  const chunks = await prisma.warrantyKBChunk.findMany({
    where: {
      ...(companyId ? { OR: [{ scope: "PLATFORM" }, { companyId }] } : { scope: "PLATFORM" }),
      document: { isActive: true, isSandbox: false },
    },
    select: { content: true },
    take: MAX_CHUNKS_SCANNED,
  });

  let suggestions = [];
  // Output varies run to run, so one thin answer earns a second try.
  for (let attempt = 0; attempt < 2 && suggestions.length < 3; attempt++) {
    try {
      suggestions = await generate(companyId, chunks);
    } catch (e) {
      console.warn("[Warranty Suggestions] generation failed:", e.message);
    }
  }

  const generated = suggestions.length >= 3;
  if (!generated) suggestions = deriveSuggestions(chunks.map((c) => c.content));

  // An empty list is never cached, so the next load tries again.
  if (suggestions.length) {
    cache.set(key, { at: Date.now(), ttl: generated ? CACHE_TTL_MS : FALLBACK_TTL_MS, suggestions });
  }
  return suggestions;
}
