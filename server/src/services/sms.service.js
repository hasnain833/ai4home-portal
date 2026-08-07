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

function isComplete(cfg) {
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

const preview = (text, n = 160) =>
  (text || "").replace(/\s+/g, " ").slice(0, n) + ((text || "").length > n ? "…" : "");

const simulated = (to, body, provider, error) => {
  console.log(`[SMS] ⚠️ SIMULATED (${provider}) to=${to} | "${preview(body)}"`);
  return { messageId: "SIMULATED_MSG_ID", status: "delivered", to, body, provider: `${provider}_SIMULATED`, error };
};

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
    await new Promise((resolve) => setTimeout(resolve, 500));
    return simulated(to, body, smsConfig?.provider || "TWILIO_SMS", "SMS credentials are missing or incomplete.");
  }

  try {
    const result = await SENDERS[cfg.provider]({ to, body, cfg, tag });

    if (result.error) {
      console.error(`[SMS] ❌ Rejected by ${cfg.provider} to ${to}: ${result.error}. SIMULATING INSTEAD.`);
      return simulated(to, body, cfg.provider, result.error);
    }

    console.log(`[SMS] ✅ Sent via ${cfg.provider} to ${result.to} (ID: ${result.messageId})`);
    return result;
  } catch (error) {
    console.error(`[SMS] ❌ Failed to send to ${to} via ${cfg.provider}: ${error.message}`);
    throw error;
  }
};
