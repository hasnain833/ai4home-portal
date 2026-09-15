import prisma from "../lib/prisma.js";

const SUGGESTION_COUNT = 6;
const CACHE_TTL_MS = 10 * 60 * 1000;

const MAX_CHUNKS_SCANNED = 5000;

const COLUMNS = {
  Category: "category",
  "Service Type": "serviceType",
  "Problem Code": "problemCode",
};

const cache = new Map();

export function readRow(content) {
  const row = {};

  for (const line of String(content || "").split("\n")) {
    const at = line.indexOf(": ");
    if (at < 0) continue;
    const field = COLUMNS[line.slice(0, at).trim()];
    if (field) row[field] = line.slice(at + 2).trim();
  }
  return row;
}

function laneWeight(items) {
  return items.reduce((sum, i) => sum + i.weight, 0);
}

export function deriveSuggestions(contents, limit = SUGGESTION_COUNT) {
  const byLabel = new Map();

  for (const content of contents) {
    const { category, serviceType, problemCode } = readRow(content);
    if (!serviceType || !problemCode) continue;

    const label = `${serviceType} — ${problemCode}`;
    const seen = byLabel.get(label);
    if (seen) seen.weight += 1;
    else byLabel.set(label, { label, category: category || "General", weight: 1 });
  }

  const byCategory = new Map();
  for (const item of byLabel.values()) {
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

export function invalidateSuggestions() {
  cache.clear();
}

export async function getWarrantySuggestions(companyId) {
  const key = companyId || "platform";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.suggestions;

  const chunks = await prisma.warrantyKBChunk.findMany({
    where: companyId ? { OR: [{ scope: "PLATFORM" }, { companyId }] } : { scope: "PLATFORM" },
    select: { content: true },
    take: MAX_CHUNKS_SCANNED,
  });

  const suggestions = deriveSuggestions(chunks.map((c) => c.content));
  cache.set(key, { at: Date.now(), suggestions });
  return suggestions;
}
