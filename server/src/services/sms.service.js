const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

// Resolve usable Twilio credentials from the per-company config (preferred)
// or from environment variables (fallback for single-tenant / local setups).
function resolveTwilioConfig(smsConfig) {
  const accountSid = smsConfig?.accountSid || process.env.TWILIO_ACCOUNT_SID;
  const authToken = smsConfig?.authToken || process.env.TWILIO_AUTH_TOKEN;
  const from = smsConfig?.from || process.env.TWILIO_FROM_NUMBER;
  const statusCallbackUrl = smsConfig?.statusCallbackUrl || process.env.TWILIO_STATUS_CALLBACK_URL || null;

  if (!accountSid || !authToken || !from) return null;
  return { accountSid, authToken, from, statusCallbackUrl };
}

const preview = (text, n = 160) =>
  (text || "").replace(/\s+/g, " ").slice(0, n) + ((text || "").length > n ? "…" : "");

export const sendSms = async ({ to, body, smsConfig, tag }) => {
  const cfg = resolveTwilioConfig(smsConfig);

  // No usable Twilio credentials (dev / not yet configured) — simulate a send.
  if (!cfg) {
    console.log(`[SMS OUT] (SIMULATED — no Twilio credentials) to=${to} | body="${preview(body)}"`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { messageId: "SIMULATED_MSG_ID", status: "delivered", to, body, provider: "TWILIO_SMS_SIMULATED" };
  }

  console.log(`[SMS OUT] → sending via Twilio | from=${cfg.from} to=${to}${tag ? ` tag=${tag}` : ""} | body="${preview(body)}"`);

  try {
    const params = new URLSearchParams();
    params.append("To", to);
    params.append("Body", body);

    // `from` is either a Messaging Service SID (starts with "MG") or an E.164 phone number.
    if (cfg.from.startsWith("MG")) {
      params.append("MessagingServiceSid", cfg.from);
    } else {
      params.append("From", cfg.from);
    }

    // Ask Twilio to POST delivery-status events to our webhook, carrying the
    // campaign step id as `tag` so status callbacks can increment step metrics.
    if (cfg.statusCallbackUrl) {
      const callback = tag
        ? `${cfg.statusCallbackUrl}${cfg.statusCallbackUrl.includes("?") ? "&" : "?"}tag=${encodeURIComponent(tag)}`
        : cfg.statusCallbackUrl;
      params.append("StatusCallback", callback);
    }

    const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64");

    const response = await fetch(`${TWILIO_API_BASE}/Accounts/${cfg.accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error(`[SMS OUT] ✗ Twilio rejected message to ${to} | code=${data.code || response.status} | ${data.message || "unknown error"}`);
      throw new Error(data.message || `Failed to send Twilio SMS (code ${data.code || response.status})`);
    }

    console.log(`[SMS OUT] ✓ accepted by Twilio | sid=${data.sid} status=${data.status} to=${data.to}`);

    return {
      messageId: data.sid,
      status: data.status,
      to: data.to,
      body: data.body,
      provider: "TWILIO_SMS",
      raw: data,
    };
  } catch (error) {
    console.error(`[SMS Service] Failed to send message to ${to}:`, error);
    throw error;
  }
};
