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


export const CONVERSATION_LOCK_MS = 24 * 60 * 60 * 1000;
export const B2B_OWNER = "B2B";

export function smsOwner({ companyId, source }) {
  if (String(source || "").startsWith("warranty-")) return null;
  if (companyId) return companyId;
  return /^(b2b-|website-b2b)/.test(source || "") ? B2B_OWNER : null;
}

export async function recentSmsOwners(phone, since) {
  const digits = normalizePhone(phone).slice(-10);
  if (!digits) return [];
  const rows = await prisma.messageUsage.findMany({
    // Only the shared number's conversations: a builder texting from its own number shares nothing.
    where: { channel: "SMS", outcome: "sent", fromNumber: null, recipient: { endsWith: digits }, createdAt: { gte: since } },
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

export async function smsConversationHold(phone, companyId) {
  if ((await companySender(companyId)).ownNumber) return null; // its own number: no one to collide with
  const me = companyId || B2B_OWNER;
  const others = (await recentSmsOwners(phone, new Date(Date.now() - CONVERSATION_LOCK_MS))).filter((o) => o.owner !== me);
  if (!others.length) return null;
  return new Date(Math.max(...others.map((o) => new Date(o.at).getTime())) + CONVERSATION_LOCK_MS);
}
export function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

export const usablePhone = (value) => toE164(value) || null;

const SENDER_TTL_MS = 60_000;
const senderCache = new Map();

async function companySender(companyId) {
  if (!companyId) return { name: null, ownNumber: null };

  const hit = senderCache.get(companyId);
  if (hit && Date.now() - hit.at < SENDER_TTL_MS) return hit.sender;

  let sender = { name: null, ownNumber: null };
  try {
    const row = await prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, smsNumber: true, smsStatus: true },
    });
    sender = {
      name: row?.name || null,
      ownNumber: row?.smsStatus === SMS_STATUS.APPROVED ? row.smsNumber || null : null,
    };
  } catch (error) {
    console.error("[SMS] Company lookup failed:", error.message);
  }

  senderCache.set(companyId, { at: Date.now(), sender });
  return sender;
}

export function forgetCompanySender(companyId) {
  senderCache.delete(companyId);
}

export const SMS_STATUS = { NONE: "NONE", PENDING: "PENDING", APPROVED: "APPROVED", REJECTED: "REJECTED" };

/** The builder that owns this number (one of ours, approved), or null for the shared platform number. */
export async function companyForSmsNumber(number) {
  const e164 = toE164(number);
  if (!e164) return null;
  const row = await prisma.company.findFirst({
    where: { smsNumber: e164, smsStatus: SMS_STATUS.APPROVED },
    select: { id: true },
  });
  return row?.id || null;
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
  const system = resolveSystemConfig();
  const sender = await companySender(companyId);
  const cfg = system && (sender.ownNumber ? { ...system, from: sender.ownNumber } : system);

  if (!cfg) {
    const error = "Platform SMS credentials are missing or incomplete.";
    console.warn(`[SMS] ⏭️ Not configured — nothing sent to ${to}.`);
    return { outcome: SMS_OUTCOME.NOT_CONFIGURED, to, body, provider: null, error };
  }

  const finalBody = brand ? brandSmsBody(body, sender.name) : String(body || "");
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
      track: { ...track, providerMessageId, fromNumber: sender.ownNumber },
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
