export const KB_CATEGORIES = {
  GENERAL: "General",
  BRAND_VOICE: "brand_voice",
  COMMUNITY: "community",
  PRICING: "pricing",
  FAQ: "faq",
  COMPLIANCE: "compliance",
};

const { GENERAL, BRAND_VOICE, COMMUNITY, PRICING, FAQ, COMPLIANCE } = KB_CATEGORIES;

export const KB_SCOPES = {
  scheduling: [FAQ, PRICING, COMPLIANCE, COMMUNITY, GENERAL],
  blog: [BRAND_VOICE, COMMUNITY, GENERAL],
  nurture: [BRAND_VOICE, COMMUNITY, FAQ, GENERAL],
  calendar: [BRAND_VOICE, COMMUNITY, GENERAL],
};

export function buildBrandContext(company, { profile, voiceProfile, brandVoice } = {}) {
  const bp = profile !== undefined ? (profile || {}) : (company?.salesBrandProfile || {});
  const voice = brandVoice || voiceProfile || company?.voiceProfile;
  const markets = bp.markets || bp.communities;
  return [
    company?.name ? `Company/builder name: ${company.name}` : null,
    voice ? `Tone/voice: ${voice}` : null,
    bp.tone ? `Brand tone: ${bp.tone}` : null,
    bp.tagline ? `Tagline: ${bp.tagline}` : null,
    markets ? `Markets/communities: ${Array.isArray(markets) ? markets.join(", ") : markets}` : null,
    bp.audience ? `Primary audience: ${bp.audience}` : null,
    bp.signature ? `Signature/sign-off: ${bp.signature}` : null,
    bp.about ? `About: ${bp.about}` : null,
  ].filter(Boolean).join("\n");
}

export function dedupeKbCitations(chunks) {
  const out = [];
  const seen = new Set();
  for (const c of chunks || []) {
    const key = c.documentId || c.name;
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push({
        documentId: c.documentId || null,
        name: c.name || "",
        category: c.category || "General",
      });
    }
  }
  return out;
}

export function parseLlmJson(raw, { array = false } = {}) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/```json/gi, "").replace(/```/g, "").trim();
  const open = array ? "[" : "{";
  const close = array ? "]" : "}";
  const start = cleaned.indexOf(open);
  const end = cleaned.lastIndexOf(close);
  const slice = start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}
