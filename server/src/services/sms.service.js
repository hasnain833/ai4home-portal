const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";
const TELNYX_API_BASE = "https://api.telnyx.com/v2";

// SMS providers must support inbound messages — the portal depends on replies for
// reply-detection and on STOP keywords for opt-out compliance.
export const SMS_PROVIDERS = ["TWILIO_SMS", "TELNYX_SMS"];

// Platforms that were once selectable; stale rows are purged when SMS settings are saved.
export const RETIRED_SMS_PROVIDERS = ["BREVO_SMS"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const statusCallbackUrl = () =>
  process.env.NEXT_PUBLIC_URL
    ? `${process.env.NEXT_PUBLIC_URL.replace(/\/$/, "")}/api/sales/compliance/inbound/sms-status`
    : null;

// The platform-level fallback used by callers that pass smsConfig: "SYSTEM".
// Picks the provider named by SMS_PROVIDER, else the first one fully configured.
function resolveSystemConfig() {
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

  const preferred = process.env.SMS_PROVIDER;
  const order = preferred && candidates[preferred] ? [preferred] : SMS_PROVIDERS;

  for (const name of order) {
    const cfg = candidates[name];
    if (isComplete(cfg)) return { ...cfg, statusCallbackUrl: statusCallbackUrl() };
  }
  return null;
}

// Exported so the capabilities endpoint reports exactly what the sender would do
// — "SMS is configured" in the UI must mean the same thing as it does here.
export function isComplete(cfg) {
  if (!cfg?.apiKey || !cfg?.from) return false;
  // Only Twilio needs a second credential to authenticate outbound sends.
  if (cfg.provider === "TWILIO_SMS" && !cfg.apiSecret) return false;
  return true;
}

// Accepts the shape produced by getMessagingConfig()/the settings controller, and
// still understands the legacy Twilio-only keys (accountSid/authToken).
function resolveConfig(smsConfig) {
  if (smsConfig === "SYSTEM") return resolveSystemConfig();
  if (!smsConfig) return null;

  const cfg = {
    provider: smsConfig.provider || "TWILIO_SMS",
    apiKey: smsConfig.apiKey ?? smsConfig.accountSid,
    apiSecret: smsConfig.apiSecret ?? smsConfig.authToken,
    from: smsConfig.from ?? smsConfig.senderName,
    statusCallbackUrl: smsConfig.statusCallbackUrl ?? statusCallbackUrl(),
  };

  if (!SMS_PROVIDERS.includes(cfg.provider)) return null;
  return isComplete(cfg) ? cfg : null;
}

/**
 * Every send reports exactly one of these. SENT means the provider accepted the
 * message; FAILED means it rejected it or the request never got through, and is
 * worth parking for retry; NOT_CONFIGURED means the tenant has no usable
 * credentials, so there is nothing to retry and the caller should skip with a
 * reason. Nothing here ever pretends a message went out.
 */
export const SMS_OUTCOME = {
  SENT: "sent",
  FAILED: "failed",
  NOT_CONFIGURED: "not_configured",
};

export const smsSent = (result) => result?.outcome === SMS_OUTCOME.SENT;

/** Only genuine failures are worth a dead-letter row — missing config is not. */
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
  // A messaging profile id (UUID) sends from the profile's number pool; anything
  // else is treated as a literal sender (E.164 number or alphanumeric sender id).
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

export const sendSms = async ({ to, body, smsConfig, tag }) => {
  const cfg = resolveConfig(smsConfig);

  if (!cfg) {
    const provider = smsConfig === "SYSTEM" ? "SYSTEM" : smsConfig?.provider || null;
    const error = "SMS credentials are missing or incomplete.";
    console.warn(`[SMS] ⏭️ Not configured (${provider || "no provider"}) — nothing sent to ${to}.`);
    return { outcome: SMS_OUTCOME.NOT_CONFIGURED, to, body, provider, error };
  }

  try {
    const result = await SENDERS[cfg.provider]({ to, body, cfg, tag });

    if (result.error) {
      console.error(`[SMS] ❌ Rejected by ${cfg.provider} to ${to}: ${result.error}`);
      return { outcome: SMS_OUTCOME.FAILED, to, body, provider: cfg.provider, error: result.error };
    }

    console.log(`[SMS] ✅ Sent via ${cfg.provider} to ${result.to} (ID: ${result.messageId})`);
    return { outcome: SMS_OUTCOME.SENT, ...result };
  } catch (error) {
    // A transport-level error is a failure to deliver, not a reason to abort the
    // caller's flow — it is reported like a rejection so the send can be parked.
    console.error(`[SMS] ❌ Failed to send to ${to} via ${cfg.provider}: ${error.message}`);
    return {
      outcome: SMS_OUTCOME.FAILED,
      to,
      body,
      provider: cfg.provider,
      error: error.message || "Network error",
    };
  }
};
