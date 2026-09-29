import prisma from "../lib/prisma.js";
import { recordUsage, countSegments } from "../lib/usage.js";

const TELNYX_API_BASE = "https://api.telnyx.com/v2";
const TELNYX_PROVIDER = "TELNYX_SMS";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resolveSystemConfig() {
  const config = {
    provider: TELNYX_PROVIDER,
    apiKey: process.env.TELNYX_API_KEY,
    from: process.env.TELNYX_FROM_NUMBER || process.env.TELNYX_MESSAGING_PROFILE_ID,
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
};

export const smsSent = (result) => result?.outcome === SMS_OUTCOME.SENT;

export const smsShouldPark = (result) => result?.outcome === SMS_OUTCOME.FAILED;

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
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    const err = data?.errors?.[0];
    return { error: `${err?.detail || err?.title || "unknown error"} (code: ${err?.code || response.status})` };
  }

  const msg = data?.data || {};
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

// Company names are read on every send, including bulk announcements, so they
// are cached briefly. Looked up here rather than via getSenderIdentity because
// messaging-config imports this module.
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

// A shared sending number tells the recipient nothing about who is texting, so
// the tenant's name leads the message. Skipped when the copy already opens with
// it, to avoid "Olson Homes: Olson Homes here — ...".
export function brandSmsBody(body, name) {
  const text = String(body || "");
  if (!name) return text;
  if (text.toLowerCase().startsWith(name.toLowerCase())) return text;
  return `${name}: ${text}`;
}

export const sendSms = async ({ to, body, tag, companyId = null, source = null, brand = true }) => {
  const cfg = resolveSystemConfig();

  if (!cfg) {
    const error = "Platform SMS credentials are missing or incomplete.";
    console.warn(`[SMS] ⏭️ Not configured — nothing sent to ${to}.`);
    return { outcome: SMS_OUTCOME.NOT_CONFIGURED, to, body, provider: null, error };
  }

  const finalBody = brand ? brandSmsBody(body, await companyName(companyId)) : String(body || "");
  const recipient = normalizePhone(to);

  // Recorded against the normalised number: on a shared sending number this is
  // the only trace of which tenant last spoke to someone, and an inbound reply
  // is attributed back through it.
  const segments = countSegments(finalBody);
  const meter = (outcome) =>
    recordUsage({
      companyId,
      channel: "SMS",
      provider: cfg.provider,
      units: segments,
      outcome,
      source,
      recipient,
    });

  try {
    const result = await sendViaTelnyx({ to, body: finalBody, cfg, tag });

    if (result.error) {
      console.error(`[SMS] ❌ Rejected by ${cfg.provider} to ${to}: ${result.error}`);
      await meter("failed");
      return { outcome: SMS_OUTCOME.FAILED, to, body: finalBody, provider: cfg.provider, error: result.error };
    }

    console.log(`[SMS] ✅ Sent via ${cfg.provider} to ${result.to} (${segments} segment(s), ID: ${result.messageId})`);
    await meter("sent");
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
