import prisma from "./prisma.js";

export const PRICING_SETTING_KEY = "messaging.pricing";

// Per-unit rates in millionths of a dollar, so the ledger stays integer-only.
// A superadmin edits these at /admin/messaging; these are only the starting
// point before anyone has.
export const DEFAULT_PRICING = {
  // Brevo bills by plan, not per email, so there is no per-email rate to look
  // up: divide your monthly plan cost by the emails it includes. 1250 is the
  // Starter plan ($25 / 20,000 emails); higher tiers work out cheaper.
  EMAIL: 1250,
  // Twilio US outbound long-code, list price $0.0079 per segment.
  TWILIO_SMS: 7900,
  // Telnyx US outbound long-code, list price $0.004 per segment.
  TELNYX_SMS: 4000,
  // A send the provider rejected never reached a carrier, so it costs nothing.
  // Delivery failures after acceptance can be billed, but those arrive later
  // via status callback, not here.
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

function isGsm7(text) {
  for (const ch of text) {
    const code = ch.codePointAt(0);
    // Printable ASCII covers most of the alphabet; the set above is the rest.
    if (code >= 0x20 && code <= 0x7e) continue;
    if (GSM7_EXTRA.has(code)) continue;
    return false;
  }
  return true;
}

// A message longer than one segment is split and billed per part. Concatenated
// parts carry a header, which is why the per-part limit drops.
export function countSegments(body) {
  const text = String(body || "");
  if (!text) return 0;
  const unicode = !isGsm7(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return text.length <= single ? 1 : Math.ceil(text.length / multi);
}

export function aiCostMicros(model, inputTokens, outputTokens) {
  const rate = AI_RATES[model] || AI_RATES["claude-sonnet-5"];
  return Math.round(inputTokens * rate.in + outputTokens * rate.out);
}

// Metering must never break a send: a failed ledger write is logged, not thrown.
// The cost is derived here so no caller has to know the rates — pass costMicros
// only when the price is not per-unit, as with AI tokens.
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
