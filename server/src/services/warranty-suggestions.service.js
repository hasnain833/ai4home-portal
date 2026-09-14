/**
 * Starter prompts for the warranty chat, derived from the Bravo matrix.
 *
 * The matrix is already a ranked list of what homeowners call about: one indexed
 * row per diagnostic question, grouped by Category / Service Type / Problem Code.
 * The problem codes carrying the most questions are the ones built out first, and
 * the Bravo approach sheet orders that build explicitly by call volume — so
 * question count doubles as a serviceable popularity signal without anyone
 * maintaining a second list that would drift from the knowledge base.
 *
 * Suggestions therefore track KB content: load more of the matrix and the chat's
 * empty state fills out on its own. The corollary is that a tenant whose warranty
 * KB has no matrix in it gets no suggestions, and the panel stays hidden.
 */

import prisma from "../lib/prisma.js";

const SUGGESTION_COUNT = 6;
const CACHE_TTL_MS = 10 * 60 * 1000;

/** Bounds the scan. Far past the ~98-row matrix, but keeps a large KB from being read whole. */
const MAX_CHUNKS_SCANNED = 5000;

/** Column names the matrix uses, mapped to the fields a suggestion needs. */
const COLUMNS = {
  Category: "category",
  "Service Type": "serviceType",
  "Problem Code": "problemCode",
};

/** companyId -> { at, suggestions } */
const cache = new Map();

/**
 * Reads the labelled cells out of one row-chunk.
 *
 * Values can themselves contain a colon — "Service Type / Problem Code" holds
 * "Hot Water Heater: Leaking" — so only the first separator on a line separates,
 * and the column name has to match exactly rather than by prefix ("Service Type"
 * is a prefix of "Service Type / Problem Code").
 */
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

/**
 * Turns row-chunks into a short, varied list of starter prompts.
 *
 * Ranked by question count, then spread across categories round-robin: ranking
 * alone would return six plumbing prompts, because plumbing is the only part of
 * the matrix that is close to complete.
 */
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

  // Sort within a lane by depth, and the lanes themselves by total depth, so a
  // list shorter than the number of categories still leads with the best-covered.
  // Label is the tie-break, so the same KB always yields the same order.
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

/** Drops cached suggestions so a freshly indexed document shows up immediately. */
export function invalidateSuggestions() {
  cache.clear();
}

export async function getWarrantySuggestions(companyId) {
  const key = companyId || "platform";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.suggestions;

  // Same two tiers retrieval uses: the shared matrix plus anything this builder added.
  const chunks = await prisma.warrantyKBChunk.findMany({
    where: companyId ? { OR: [{ scope: "PLATFORM" }, { companyId }] } : { scope: "PLATFORM" },
    select: { content: true },
    take: MAX_CHUNKS_SCANNED,
  });

  const suggestions = deriveSuggestions(chunks.map((c) => c.content));
  cache.set(key, { at: Date.now(), suggestions });
  return suggestions;
}
