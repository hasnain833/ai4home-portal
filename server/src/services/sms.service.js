const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

function resolveTwilioConfig(smsConfig) {
  if (smsConfig === "SYSTEM") {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM_NUMBER;
    const statusCallbackUrl = process.env.NEXT_PUBLIC_URL ? `${process.env.NEXT_PUBLIC_URL.replace(/\/$/, "")}/api/sales/compliance/inbound/sms-status` : null;

    if (!accountSid || !authToken || !from) return null;
    return { accountSid, authToken, from, statusCallbackUrl };
  }

  const accountSid = smsConfig?.accountSid;
  const authToken = smsConfig?.authToken;
  const from = smsConfig?.from;
  const statusCallbackUrl = process.env.NEXT_PUBLIC_URL ? `${process.env.NEXT_PUBLIC_URL.replace(/\/$/, "")}/api/sales/compliance/inbound/sms-status` : null;

  if (!accountSid || !authToken || !from) return null;
  return { accountSid, authToken, from, statusCallbackUrl };
}

const preview = (text, n = 160) =>
  (text || "").replace(/\s+/g, " ").slice(0, n) + ((text || "").length > n ? "…" : "");

export const sendSms = async ({ to, body, smsConfig, tag }) => {
  const cfg = resolveTwilioConfig(smsConfig);

  if (!cfg) {
    console.log(`[SMS] ⚠️ SIMULATED to=${to} | "${preview(body)}"`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { messageId: "SIMULATED_MSG_ID", status: "delivered", to, body, provider: "TWILIO_SMS_SIMULATED" };
  }

  try {
    const params = new URLSearchParams();
    params.append("To", to);
    params.append("Body", body);
    if (cfg.from.startsWith("MG")) {
      params.append("MessagingServiceSid", cfg.from);
    } else {
      params.append("From", cfg.from);
    }

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
      console.error(`[SMS] ❌ Rejected by Twilio to ${to}: ${data.message || "unknown error"} (code: ${data.code || response.status}). SIMULATING INSTEAD.`);
      return { messageId: "SIMULATED_MSG_ID", status: "delivered", to, body, provider: "TWILIO_SMS_SIMULATED" };
    }

    console.log(`[SMS] ✅ Sent to ${data.to} (ID: ${data.sid})`);

    return {
      messageId: data.sid,
      status: data.status,
      to: data.to,
      body: data.body,
      provider: "TWILIO_SMS",
      raw: data,
    };
  } catch (error) {
    if (!error.message.includes("Twilio SMS")) {
      console.error(`[SMS] ❌ Failed to send to ${to}: ${error.message}`);
    }
    throw error;
  }
};
