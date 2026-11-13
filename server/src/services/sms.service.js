import prisma from "../lib/prisma.js";
import { recordUsage, countSegments } from "../lib/usage.js";
import { isCompanySuspended } from "../lib/company-suspension.js";
import { toE164 } from "../lib/lead-phone.js";
export { PHONE_ERROR, toE164 } from "../lib/lead-phone.js";

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

// ---------- One shared number: who owns the conversation ----------

export const CONVERSATION_LOCK_MS = 24 * 60 * 60 * 1000;
export const B2B_OWNER = "B2B";

/**
 * Who a text speaks for: a builder (its companyId) or the platform's B2B sales.
 * No-reply texts (warranty, logins, the routing question) belong to no one.
 */
export function smsOwner({ companyId, source }) {
  if (String(source || "").startsWith("warranty-")) return null;
  if (companyId) return companyId;
  return /^(b2b-|website-b2b)/.test(source || "") ? B2B_OWNER : null;
}

/** Everyone who texted this phone since `since`, newest first: [{ owner, at }]. */
export async function recentSmsOwners(phone, since) {
  const digits = normalizePhone(phone).slice(-10);
  if (!digits) return [];
  const rows = await prisma.messageUsage.findMany({
    where: { channel: "SMS", outcome: "sent", recipient: { endsWith: digits }, createdAt: { gte: since } },
    select: { companyId: true, source: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const owners = new Map();
  for (const row of rows) {
    const owner = smsOwner(row);
    if (owner && !owners.has(owner)) owners.set(owner, row.createdAt);
  }
  return [...owners].map(([owner, at]) => ({ owner, at }));
}

/**
 * Marketing waits while someone else is talking to this phone, so a reply has one clear owner.
 * Returns when it may go, or null for now. `companyId` null means B2B.
 * ponytail: a sender who texts daily keeps the lock; add a max wait if builders starve.
 */
export async function smsConversationHold(phone, companyId) {
  const me = companyId || B2B_OWNER;
  const others = (await recentSmsOwners(phone, new Date(Date.now() - CONVERSATION_LOCK_MS))).filter((o) => o.owner !== me);
  if (!others.length) return null;
  return new Date(Math.max(...others.map((o) => new Date(o.at).getTime())) + CONVERSATION_LOCK_MS);
}
export function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

// Phone as typed -> E.164 for Telnyx. We only text +1 (US and Canada); bare
// 10-digit numbers are taken as +1. "" -> null (clear); anything else -> undefined (reject).

// For imports and CRM sync: one bad number shouldn't cost us the lead, so keep it without a phone.
export const usablePhone = (value) => toE164(value) || null;

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
