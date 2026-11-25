import prisma from "./prisma.js";

export const SALES_HOME_STATUSES = ["AVAILABLE", "COMING_SOON", "UNDER_CONTRACT", "SOLD"];

const SALES_HOME_STATUS_LABELS = {
  AVAILABLE: "Available",
  COMING_SOON: "Coming soon",
  UNDER_CONTRACT: "Under contract",
  SOLD: "Sold",
};

export const OFFERABLE_STATUSES = ["AVAILABLE", "COMING_SOON"];
export const MAX_PHOTOS_PER_HOME = 20;
const MAX_HOMES_IN_PROMPT = 60;
const MAX_HOMES_LOADED = 1000;

export const isSalesHomeStatus = (value) => SALES_HOME_STATUSES.includes(value);
export function normalizeStatus(value) {
  const v = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (!v) return null;
  const upper = v.toUpperCase().replace(/ /g, "_");
  if (isSalesHomeStatus(upper)) return upper;
  if (/(^| )(sold|closed)( |$)/.test(v)) return "SOLD";
  if (/contract|pending|reserved|under agreement/.test(v)) return "UNDER_CONTRACT";
  if (/coming|future|soon|pre ?sale/.test(v)) return "COMING_SOON";
  if (/avail|for sale|now|move in|qmi|inventory|spec|active/.test(v)) return "AVAILABLE";
  return null;
}

export function parsePrice(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;
  const s = String(value).trim().toLowerCase().replace(/[$,\s]/g, "");
  const m = s.match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (!m) return null;
  const mult = m[2] === "m" ? 1_000_000 : m[2] === "k" ? 1_000 : 1;
  return Math.round(parseFloat(m[1]) * mult);
}

export function parseNumber(value, { integer = false } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const n = parseFloat(String(value).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n)) return null;
  return integer ? Math.round(n) : n;
}

export function formatPrice(price) {
  if (price === null || price === undefined) return null;
  return `$${Number(price).toLocaleString("en-US")}`;
}

export async function loadOfferableHomes(companyId, { limit = MAX_HOMES_LOADED } = {}) {
  if (!companyId) return [];
  return prisma.salesHome.findMany({
    where: { companyId, status: { in: OFFERABLE_STATUSES } },
    include: {
      community: { select: { id: true, name: true } },
      photos: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { url: true } },
    },
    orderBy: [{ status: "asc" }, { community: { name: "asc" } }, { address: "asc" }],
    take: limit,
  });
}

// The model miscopies full 25-character ids, and a card with a wrong id is dropped,
// so it gets a short code: the end of the id.
// ponytail: 6 base-36 characters; lengthen if a builder ever lists enough homes to collide.
export const homeRef = (id) => String(id).replace(/^home:/i, "").trim().slice(-6);

function homeLine(h) {
  const where = [h.address, [h.city, h.state].filter(Boolean).join(", ")].filter(Boolean).join(", ");
  const specs = [
    h.planName ? `Plan: ${h.planName}` : null,
    h.lotNumber ? `Lot ${h.lotNumber}` : null,
    h.bedrooms != null ? `${h.bedrooms} bd` : null,
    h.bathrooms != null ? `${h.bathrooms} ba` : null,
    h.sqft != null ? `${h.sqft.toLocaleString("en-US")} sq ft` : null,
    h.price != null ? formatPrice(h.price) : "price not published",
    SALES_HOME_STATUS_LABELS[h.status] || h.status,
    h.moveIn ? `move-in ${h.moveIn}` : null,
    `${h.photos?.length || 0} photo${h.photos?.length === 1 ? "" : "s"}`,
  ].filter(Boolean);
  const desc = h.description ? `\n   ${String(h.description).replace(/\s+/g, " ").slice(0, 240)}` : "";
  return `- [home:${homeRef(h.id)}] ${where} — ${h.community?.name || "Community"} — ${specs.join(" · ")}${desc}`;
}

const groupKey = (h) => [h.community?.name || "Community", h.status, h.bedrooms ?? "?"].join("|");

function groupHomes(homes) {
  const groups = new Map();
  for (const h of homes) {
    const key = groupKey(h);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(h);
  }
  return [...groups.values()];
}

/** Up to `max` homes, taken in turn from each community/status/bedroom group so none is left out. */
export function sampleHomes(homes, max = MAX_HOMES_IN_PROMPT) {
  if (homes.length <= max) return homes;
  const groups = groupHomes(homes);
  const picked = new Set();
  for (let i = 0; picked.size < max; i++) {
    for (const g of groups) if (g[i] && picked.size < max) picked.add(g[i]);
  }
  return homes.filter((h) => picked.has(h));
}

const range = (values, format) => {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? format(min) : `${format(min)} to ${format(max)}`;
};

function groupLine(group) {
  const [h] = group;
  const prices = group.map((x) => x.price).filter((v) => v != null);
  const sizes = group.map((x) => x.sqft).filter((v) => v != null);
  const withPhotos = group.filter((x) => x.photos?.length).length;
  return "- " + [
    `${h.community?.name || "Community"}${h.city ? ` (${h.city})` : ""}`,
    `${group.length} home${group.length === 1 ? "" : "s"}`,
    h.bedrooms != null ? `${h.bedrooms} bd` : null,
    SALES_HOME_STATUS_LABELS[h.status] || h.status,
    prices.length
      ? `${range(prices, formatPrice)}${prices.length < group.length ? ` (${prices.length} priced)` : ""}`
      : "price not published",
    sizes.length ? `${range(sizes, (n) => n.toLocaleString("en-US"))} sq ft` : null,
    withPhotos ? `${withPhotos} with photos` : "no photos",
  ].filter(Boolean).join(" · ");
}

export function inventoryChunk(homes) {
  if (!homes?.length) return null;
  const listed = sampleHomes(homes);
  const text = [
    "Homes currently for sale, from the builder's own inventory. This is the authoritative list of addresses, prices and availability — quote it exactly, and never invent a home, address or price that is not on it.",
    "When the buyer asks to see a home, asks for pictures, or you recommend specific homes for the first time, put those homes' ids (the value after 'home:') in home_ids so the chat can show them. Only include homes that have photos when pictures were asked for. A home marked '[Shown as cards: …]' earlier in the conversation is already on screen — do not include it again unless the buyer asks to see it again, and do not say 'here's a look' without attaching a card.",
    "home_ids is the only way to show a home or a picture. If it is empty, do not say you are showing anything; if it holds one home, do not say there are two. Name only the plans whose homes you attached. Attach only homes from the group that matches the bedrooms and community you are talking about, and prefer different plans over repeats of one.",
    "Use the summary for what exists, how many, price ranges and sizes. A home that is in the summary but not itemised still exists.",
    "",
    "Summary of every home for sale:",
    ...groupHomes(homes).map(groupLine),
    "",
    listed.length < homes.length ? `Itemised (${listed.length} of ${homes.length} homes):` : "Itemised:",
    ...groupHomes(listed).flatMap((g) => [
      "",
      `${g[0].community?.name || "Community"}, ${g[0].bedrooms ?? "?"} bedrooms, ${SALES_HOME_STATUS_LABELS[g[0].status] || g[0].status}:`,
      ...g.map(homeLine),
    ]),
  ].join("\n");
  return {
    documentId: null,
    name: "Homes for sale (live inventory)",
    category: "inventory",
    scope: "COMPANY",
    score: 1,
    text,
  };
}

export async function withInventory(companyId, kbChunks = []) {
  try {
    const chunk = inventoryChunk(await loadOfferableHomes(companyId));
    return chunk ? [chunk, ...(kbChunks || [])] : kbChunks || [];
  } catch (e) {
    console.warn("[Sales Homes] inventory lookup failed:", e.message);
    return kbChunks || [];
  }
}
export async function homeCards(companyId, ids) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(homeRef).filter((ref) => /^[a-z0-9]{6}$/i.test(ref)))].slice(0, 6);
  if (!companyId || !wanted.length) return [];
  const rows = await prisma.salesHome.findMany({
    where: { companyId, status: { in: OFFERABLE_STATUSES }, OR: wanted.map((ref) => ({ id: { endsWith: ref } })) },
    include: {
      community: { select: { name: true } },
      photos: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { url: true } },
    },
  });
  const byId = new Map(rows.map((r) => [homeRef(r.id), r]));
  return wanted
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((h) => ({
      id: h.id,
      address: h.address,
      city: h.city,
      state: h.state,
      community: h.community?.name || null,
      planName: h.planName,
      price: h.price,
      bedrooms: h.bedrooms,
      bathrooms: h.bathrooms,
      sqft: h.sqft,
      status: h.status,
      moveIn: h.moveIn,
      description: h.description,
      photos: h.photos.map((p) => p.url),
    }));
}
