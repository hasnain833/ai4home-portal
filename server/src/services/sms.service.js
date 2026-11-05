import prisma from "../lib/prisma.js";
import { recordUsage, countSegments } from "../lib/usage.js";
import { isCompanySuspended } from "../lib/company-suspension.js";

const TELNYX_API_BASE = "https://api.telnyx.com/v2";
const TELNYX_PROVIDER = "TELNYX_SMS";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resolveSystemConfig() {
  const config = {
    provider: TELNYX_PROVIDER,
    apiKey: String(process.env.TELNYX_API_KEY || "").trim(),
    from: String(process.env.TELNYX_FROM_NUMBER || process.env.TELNYX_MESSAGING_PROFILE_ID || "").trim(),
  };
  return isComplete(config) ? config : null;
}

function isComplete(cfg) {
  return !!(cfg?.apiKey && cfg?.from);
}
export const SMS_OUTCOME = {
  SENT: "sent",
  FAILED: "failed",
  NOT_CONFIGURED: "not_configured",
  SUSPENDED: "suspended",
  // The number is outside +1, which we don't text. Not a failure: nothing to retry or park.
  SKIPPED: "skipped",
};

export const PHONE_ERROR = "Only +1 phone numbers are supported, e.g. +1 (555) 123-4567.";
export const NON_PLUS_ONE_TAG = "non-+1-phone";

export const smsSent = (result) => result?.outcome === SMS_OUTCOME.SENT;

export const smsShouldPark = (result) => result?.outcome === SMS_OUTCOME.FAILED;

export function formatSmsError(errors, fallback = "Unknown SMS delivery error") {
  const error = Array.isArray(errors) ? errors[0] : null;
  if (!error) return fallback;
  const detail = error.detail || error.title || fallback;
  const hint = String(error.code) === "40306" ? " Configure an approved alphanumeric sender ID on the Telnyx messaging profile for this destination route." : "";
  return `${detail}${error.code ? ` (code: ${error.code})` : ""}${hint}`;
}

async function sendViaTelnyx({ to, body, cfg }) {
  const payload = { to, text: body };
  if (UUID_RE.test(cfg.from)) {
    payload.messaging_profile_id = cfg.from;
  } else {
    payload.from = cfg.from;
  }

  const response = await fetch(`${TELNYX_API_BASE}/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    return { error: formatSmsError(data?.errors, `Telnyx rejected the message (HTTP ${response.status})`) };
  }

  const msg = data?.data || {};
  if (!msg.id) return { error: "Telnyx returned no message ID; delivery could not be confirmed." };
  if (["sending_failed", "delivery_failed"].includes(msg.to?.[0]?.status)) {
    return { error: formatSmsError(msg.errors, `Telnyx reported ${msg.to[0].status}`), messageId: msg.id };
  }
  return {
    messageId: msg.id,
    status: msg.to?.[0]?.status || "queued",
    to: msg.to?.[0]?.phone_number || to,
    body: msg.text ?? body,
    provider: "TELNYX_SMS",
    raw: msg,
  };
}

// Digits only, so a number written any way matches the same conversation.
export function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

// Phone as typed -> E.164 for Telnyx. We only text +1 (US and Canada); bare
// 10-digit numbers are taken as +1. "" -> null (clear); anything else -> undefined (reject).
export function toE164(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const digits = normalizePhone(raw);
  const withCountry = digits.length === 10 && !raw.startsWith("+") ? `1${digits}` : digits;
  return /^1[2-9]\d{9}$/.test(withCountry) ? `+${withCountry}` : undefined;
}

// For imports and CRM sync: one bad number shouldn't cost us the lead, so keep it without a phone.
export const usablePhone = (value) => (toE164(value) ? value : null);

const NAME_TTL_MS = 60_000;
const nameCache = new Map();

async function companyName(companyId) {
  if (!companyId) return null;

  const hit = nameCache.get(companyId);
  if (hit && Date.now() - hit.at < NAME_TTL_MS) return hit.name;

  let name = null;
  try {
    const row = await prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true },
    });
    name = row?.name || null;
  } catch (error) {
    console.error("[SMS] Company name lookup failed:", error.message);
  }

  nameCache.set(companyId, { at: Date.now(), name });
  return name;
}

export function brandSmsBody(body, name) {
  const text = String(body || "");
  if (!name) return text;
  if (text.toLowerCase().startsWith(name.toLowerCase())) return text;
  return `${name}: ${text}`;
}

export const sendSms = async ({ to, body, tag, companyId = null, source = null, brand = true, track = null }) => {
  if (await isCompanySuspended(companyId)) {
    return { outcome: SMS_OUTCOME.SUSPENDED, to, body, provider: null, error: "Company is suspended." };
  }
  const destination = toE164(to);
  if (!destination) {
    console.info(`[SMS] Skipped for ${source || "unknown source"}: not a +1 number.`);
    return { outcome: SMS_OUTCOME.SKIPPED, to, body, provider: null, error: "SMS skipped: not a +1 number." };
  }
  const cfg = resolveSystemConfig();

  if (!cfg) {
    const error = "Platform SMS credentials are missing or incomplete.";
    console.warn(`[SMS] ⏭️ Not configured — nothing sent to ${to}.`);
    return { outcome: SMS_OUTCOME.NOT_CONFIGURED, to, body, provider: null, error };
  }

  const finalBody = brand ? brandSmsBody(body, await companyName(companyId)) : String(body || "");
  const recipient = normalizePhone(to);

  const segments = countSegments(finalBody);
  const meter = (outcome, providerMessageId = null) =>
    recordUsage({
      companyId,
      channel: "SMS",
      provider: cfg.provider,
      units: segments,
      outcome,
      source,
      recipient,
      // Every SMS needs its provider ID, including website acknowledgments,
      // so a later delivery receipt can find the send.
      track: { ...track, providerMessageId },
    });

  try {
    const result = await sendViaTelnyx({ to: destination, body: finalBody, cfg, tag });

    if (result.error) {
      console.error(`[SMS] ❌ Rejected by ${cfg.provider} to ${to}: ${result.error}`);
      await meter("failed", result.messageId || null);
      return { outcome: SMS_OUTCOME.FAILED, to, body: finalBody, provider: cfg.provider, error: result.error };
    }

    console.log(`[SMS] ✅ Sent via ${cfg.provider} to ${result.to} (${segments} segment(s), ID: ${result.messageId})`);
    await meter("sent", result.messageId);
    return { outcome: SMS_OUTCOME.SENT, segments, ...result };
  } catch (error) {
    console.error(`[SMS] ❌ Failed to send to ${to} via ${cfg.provider}: ${error.message}`);
    await meter("failed");
    return {
      outcome: SMS_OUTCOME.FAILED,
      to,
      body: finalBody,
      provider: cfg.provider,
      error: error.message || "Network error",
    };
  }
};
