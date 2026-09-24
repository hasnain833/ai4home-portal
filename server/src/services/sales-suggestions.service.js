import prisma from "../lib/prisma.js";
import { chat } from "../lib/llm.js";
import { parseLlmJson, buildBrandContext } from "../lib/sales-ai.js";
import { getLivePrompts } from "../prompts/live.js";
import { AGENT_TYPES } from "../prompts/index.js";
import { OFFERABLE_STATUSES } from "../lib/sales-homes.js";



const SUGGESTION_COUNT = 6;
// Asked for under TARGET_CHARS; anything up to MAX_CHARS is still kept, since
// dropping a good question for running a little long left the panel empty.
const TARGET_CHARS = 60;
const MAX_CHARS = 110;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FALLBACK_TTL_MS = 5 * 60 * 1000;

const COMPANY_CHUNKS = 30;
const PLATFORM_CHUNKS = 12;
const CHUNK_CHARS = 450;

const cache = new Map();

export function invalidateSalesSuggestions(companyId) {
  if (companyId) cache.delete(companyId);
  else cache.clear();
}

async function gatherContext(companyId) {
  const [company, companyChunks, platformChunks, communities] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId } }),
    prisma.salesKBChunk.findMany({
      where: { companyId, document: { isDeleted: false } },
      select: { name: true, category: true, content: true },
      orderBy: [{ documentId: "asc" }, { chunkIndex: "asc" }],
      take: COMPANY_CHUNKS,
    }),
    prisma.$queryRaw`
      SELECT c.name, c.category, c.content
      FROM "SalesKBChunk" c JOIN "SalesKB" d ON d.id = c."documentId"
      WHERE c.scope = 'PLATFORM' AND d."isDeleted" = false
      ORDER BY random() LIMIT ${PLATFORM_CHUNKS}`,
    prisma.community.findMany({
      where: { companyId },
      select: {
        name: true,
        salesHomes: { where: { status: { in: OFFERABLE_STATUSES } }, select: { id: true, photos: { select: { id: true }, take: 1 } } },
      },
      orderBy: { name: "asc" },
    }),
  ]);
  return { company, companyChunks, platformChunks, communities };
}

function excerpt(chunks) {
  return chunks
    .map((c) => `[${c.name || "doc"}${c.category ? ` · ${c.category}` : ""}] ${String(c.content || "").replace(/\s+/g, " ").slice(0, CHUNK_CHARS)}`)
    .join("\n");
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

async function generate(companyId, ctx) {
  const live = await getLivePrompts(AGENT_TYPES.SALES).catch(() => null);
  const promptGist = String(live?.systemTemplate || "").slice(0, 3000);

  const withHomes = ctx.communities.filter((c) => c.salesHomes.length);
  const inventory = withHomes.length
    ? withHomes
        .map((c) => `${c.name}: ${c.salesHomes.length} home(s) for sale${c.salesHomes.some((h) => h.photos.length) ? ", with photos" : ""}`)
        .join("\n")
    : "(no homes listed for sale yet)";

  const system =
    "You write the starter questions shown as tappable bubbles in a home builder's sales chat. " +
    "A prospective buyer taps one and it is sent to the sales assistant as their message. " +
    "Return ONLY a JSON array of strings.";

  const user = `Write ${SUGGESTION_COUNT} starter questions for this builder's sales chat.

Rules:
- Each is something a prospective home buyer would ask, written in the buyer's own voice, first person.
- Under ${TARGET_CHARS} characters each. Plain text, no numbering, no emoji.
- Draw them from the material below: what the assistant is set up to do (its prompt), the topics the knowledge base actually covers, and the communities and homes this builder has. Prefer questions the assistant can answer well from this material.
- Cover different ground — no two asking the same thing. Mix buying concerns (affordability, fit, what's included, trusting the builder, the buying process) with this builder's own communities and homes where they exist.
- If the assistant's job includes booking visits, one of them should move toward booking one.
- If homes have photos, one may ask to see pictures of a home or community.

## The sales assistant's prompt (excerpt)
${promptGist || "(not available)"}

## Builder
${buildBrandContext(ctx.company) || ctx.company?.name || "(unknown)"}

## Communities and homes for sale
${ctx.communities.length ? inventory : "(no communities set up)"}

## This builder's knowledge base (excerpt)
${excerpt(ctx.companyChunks) || "(empty)"}

## Shared home-buying library (random excerpt)
${excerpt(ctx.platformChunks) || "(empty)"}`;

  const raw = await chat({ companyId, system, user, maxTokens: 500 });
  return clean(parseLlmJson(raw, { array: true }));
}

function fallback(ctx) {
  const fromKb = [];
  for (const c of ctx.companyChunks) {
    for (const line of String(c.content || "").split(/\n|(?<=\?)\s+/)) {
      const q = line.replace(/^(q(uestion)?\s*[:.-]\s*)/i, "").trim();
      if (q.endsWith("?")) fromKb.push(q);
    }
  }
  // Communities with homes listed first; without any, the communities alone.
  const withHomes = ctx.communities.filter((c) => c.salesHomes.length);
  const fromCommunities = (withHomes.length ? withHomes : ctx.communities).map((c) =>
    withHomes.length ? `What homes are available at ${c.name}?` : `Tell me about ${c.name}`,
  );
  return clean([...fromCommunities.slice(0, 3), ...fromKb]);
}

export async function getSalesSuggestions(companyId) {
  if (!companyId) return [];
  const hit = cache.get(companyId);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.suggestions;

  const ctx = await gatherContext(companyId);
  let suggestions = [];
  // Output varies run to run, so one thin answer earns a second try.
  for (let attempt = 0; attempt < 2 && suggestions.length < 3; attempt++) {
    try {
      suggestions = await generate(companyId, ctx);
    } catch (e) {
      console.warn("[Sales Suggestions] generation failed:", e.message);
    }
  }

  const generated = suggestions.length >= 3;
  if (!generated) suggestions = fallback(ctx);

  // An empty list is never cached, so the next page load tries again rather
  // than showing a bare panel for the whole TTL.
  if (suggestions.length) {
    cache.set(companyId, { at: Date.now(), ttl: generated ? CACHE_TTL_MS : FALLBACK_TTL_MS, suggestions });
  } else {
    console.warn(`[Sales Suggestions] none for company=${companyId}: no AI output and nothing to fall back on.`);
  }
  return suggestions;
}
