import prisma from "../lib/prisma.js";
import { recordUsage, countSegments } from "../lib/usage.js";

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";
const TELNYX_API_BASE = "https://api.telnyx.com/v2";

export const SMS_PROVIDERS = ["TWILIO_SMS", "TELNYX_SMS"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const statusCallbackUrl = () =>
  process.env.NEXT_PUBLIC_URL
    ? `${process.env.NEXT_PUBLIC_URL.replace(/\/$/, "")}/api/sales/compliance/inbound/sms-status`
    : null;

export const SMS_PROVIDER_SETTING_KEY = "sms.provider";

const PROVIDER_CACHE_TTL_MS = 30_000;
let providerCache = { at: 0, value: null };

export function invalidateSmsProviderCache() {
  providerCache = { at: 0, value: null };
}

export async function getActiveSmsProvider() {
  if (Date.now() - providerCache.at < PROVIDER_CACHE_TTL_MS) return providerCache.value;

  let value = process.env.SMS_PROVIDER || null;
  try {
    const row = await prisma.platformSetting.findUnique({
      where: { key: SMS_PROVIDER_SETTING_KEY },
    });
    const chosen = row?.value?.provider;
    if (SMS_PROVIDERS.includes(chosen)) value = chosen;
  } catch (error) {
    console.error("[SMS] Provider setting lookup failed, using env default:", error.message);
  }

  providerCache = { at: Date.now(), value };
  return value;
}

export function resolveSystemConfig(preferred = process.env.SMS_PROVIDER) {
  const candidates = {
    TWILIO_SMS: {
      provider: "TWILIO_SMS",
      apiKey: process.env.TWILIO_ACCOUNT_SID,
      apiSecret: process.env.TWILIO_AUTH_TOKEN,
      from: process.env.TWILIO_FROM_NUMBER,
    },
    TELNYX_SMS: {
      provider: "TELNYX_SMS",
      apiKey: process.env.TELNYX_API_KEY,
      apiSecret: process.env.TELNYX_PUBLIC_KEY,
      from: process.env.TELNYX_FROM_NUMBER || process.env.TELNYX_MESSAGING_PROFILE_ID,
    },
  };

  const order = preferred && candidates[preferred] ? [preferred] : SMS_PROVIDERS;

  for (const name of order) {
    const cfg = candidates[name];
    if (isComplete(cfg)) return { ...cfg, statusCallbackUrl: statusCallbackUrl() };
  }
  return null;
}

function isComplete(cfg) {
  if (!cfg?.apiKey || !cfg?.from) return false;
  if (cfg.provider === "TWILIO_SMS" && !cfg.apiSecret) return false;
  return true;
}
export const SMS_OUTCOME = {
  SENT: "sent",
  FAILED: "failed",
  NOT_CONFIGURED: "not_configured",
};

export const smsSent = (result) => result?.outcome === SMS_OUTCOME.SENT;

export const smsShouldPark = (result) => result?.outcome === SMS_OUTCOME.FAILED;

const withTag = (url, tag) => {
  if (!url || !tag) return url;
  return `${url}${url.includes("?") ? "&" : "?"}tag=${encodeURIComponent(tag)}`;
};

async function sendViaTwilio({ to, body, cfg, tag }) {
  const params = new URLSearchParams();
  params.append("To", to);
  params.append("Body", body);
  if (cfg.from.startsWith("MG")) {
    params.append("MessagingServiceSid", cfg.from);
  } else {
    params.append("From", cfg.from);
  }

  const callback = withTag(cfg.statusCallbackUrl, tag);
  if (callback) params.append("StatusCallback", callback);

  const auth = Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString("base64");

  const response = await fetch(`${TWILIO_API_BASE}/Accounts/${cfg.apiKey}/Messages.json`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await response.json();
  if (!response.ok) {
    return { error: `${data.message || "unknown error"} (code: ${data.code || response.status})` };
  }

  return {
    messageId: data.sid,
    status: data.status,
    to: data.to,
    body: data.body,
    provider: "TWILIO_SMS",
    raw: data,
  };
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

const SENDERS = {
  TWILIO_SMS: sendViaTwilio,
  TELNYX_SMS: sendViaTelnyx,
};

export async function verifyProviderCredentials(provider) {
  const cfg = resolveSystemConfig(provider);
  if (!cfg) return { ok: false, reason: "No credentials configured in the environment." };

  try {
    if (provider === "TWILIO_SMS") {
      const auth = Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString("base64");
      const res = await fetch(`${TWILIO_API_BASE}/Accounts/${cfg.apiKey}.json`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, reason: data.message || `Twilio rejected the credentials (${res.status}).` };
      if (data.status && data.status !== "active") {
        return { ok: false, reason: `Twilio account is "${data.status}", not active.` };
      }
      return { ok: true };
    }

    const res = await fetch(`${TELNYX_API_BASE}/phone_numbers?page[size]=1`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, reason: data?.errors?.[0]?.detail || `Telnyx rejected the credentials (${res.status}).` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `Could not reach ${provider}: ${error.message}` };
  }
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
  const cfg = resolveSystemConfig(await getActiveSmsProvider());

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
    const result = await SENDERS[cfg.provider]({ to, body: finalBody, cfg, tag });

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
