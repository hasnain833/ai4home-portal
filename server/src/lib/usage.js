import prisma from "./prisma.js";

export const PRICING_SETTING_KEY = "messaging.pricing";

export const DEFAULT_PRICING = {
  EMAIL: 1250,
  // Telnyx US outbound long-code, list price $0.004 per segment.
  TELNYX_SMS: 4000,
  FAILED_SEND: 0,
};

// Per million tokens, input/output. Anything unlisted falls back to the Sonnet
// rate rather than silently recording zero cost.
const AI_RATES = {
  "claude-opus-5": { in: 15, out: 75 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};

const CACHE_TTL_MS = 30_000;
let cache = { at: 0, value: null };

export function invalidatePricingCache() {
  cache = { at: 0, value: null };
}

export async function getPricing() {
  if (cache.value && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const value = { ...DEFAULT_PRICING };
  try {
    const row = await prisma.platformSetting.findUnique({
      where: { key: PRICING_SETTING_KEY },
    });
    for (const key of Object.keys(DEFAULT_PRICING)) {
      const saved = row?.value?.[key];
      if (Number.isFinite(saved) && saved >= 0) value[key] = saved;
    }
  } catch (error) {
    console.error("[Usage] Pricing lookup failed, using defaults:", error.message);
  }

  cache = { at: Date.now(), value };
  return value;
}

// The GSM-7 alphabet, as code points. Anything outside it forces the whole
// message to UCS-2, which more than halves how much fits in a segment.
const GSM7_EXTRA = new Set([
  0x40, 0xa3, 0x24, 0xa5, 0xe8, 0xe9, 0xf9, 0xec, 0xf2, 0xc7, 0x0a, 0xd8, 0xf8,
  0x0d, 0xc5, 0xe5, 0x394, 0x5f, 0x3a6, 0x393, 0x39b, 0x3a9, 0x3a0, 0x3a8,
  0x3a3, 0x398, 0x39e, 0xc6, 0xe6, 0xdf, 0xc9, 0xa4, 0xa1, 0xc4, 0xd6, 0xd1,
  0xdc, 0xa7, 0xbf, 0xe4, 0xf6, 0xf1, 0xfc, 0xe0,
]);

// Extension-table characters are sent as ESC + char, so each costs two.
const GSM7_EXTENSION = new Set([..."^{}\\[~]|€"].map((c) => c.codePointAt(0)));

// Length in GSM-7 septets, or null when the text needs UCS-2. The backtick is
// printable ASCII but not GSM-7, so it forces UCS-2 like any other outsider.
function gsm7Length(text) {
  let septets = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (GSM7_EXTENSION.has(code)) septets += 2;
    else if ((code >= 0x20 && code <= 0x7e && code !== 0x60) || GSM7_EXTRA.has(code)) septets += 1;
    else return null;
  }
  return septets;
}

// A message longer than one segment is split and billed per part. Concatenated
// parts carry a header, which is why the per-part limit drops.
export function countSegments(body) {
  const text = String(body || "");
  if (!text) return 0;
  const septets = gsm7Length(text);
  const unicode = septets === null;
  const length = unicode ? text.length : septets;
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return length <= single ? 1 : Math.ceil(length / multi);
}

export function aiCostMicros(model, inputTokens, outputTokens) {
  const rate = AI_RATES[model] || AI_RATES["claude-sonnet-5"];
  return Math.round(inputTokens * rate.in + outputTokens * rate.out);
}

export async function recordUsage({
  companyId = null,
  channel,
  provider = null,
  units = 1,
  costMicros,
  outcome = "sent",
  source = null,
  recipient = null,
}) {
  try {
    let cost = costMicros;
    if (cost === undefined) {
      const pricing = await getPricing();
      const rate =
        outcome === "sent" ? pricing[provider] ?? pricing[channel] ?? 0 : pricing.FAILED_SEND;
      cost = rate * units;
    }

    await prisma.messageUsage.create({
      data: {
        companyId: companyId || null,
        channel,
        provider,
        units: Math.max(0, Math.round(units)),
        costMicros: Math.max(0, Math.round(cost)),
        outcome,
        source,
        recipient,
      },
    });
  } catch (error) {
    console.error(`[Usage] Failed to record ${channel} usage:`, error.message);
  }
}
