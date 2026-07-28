const BREVO_SMS_ENDPOINT = "https://api.brevo.com/v3/transactionalSMS/send";

const preview = (text, n = 160) =>
  (text || "").replace(/\s+/g, " ").slice(0, n) + ((text || "").length > n ? "..." : "");

const normalizeRecipient = (phone) =>
  String(phone || "").replace(/[^\d+]/g, "").replace(/^\+/, "");

function resolveSender() {
  const sender = String(process.env.BREVO_SMS_SENDER || "AI4Home").trim();
  if (!sender) return "AI4Home";

  const isNumeric = /^\d+$/.test(sender);
  const maxLength = isNumeric ? 15 : 11;
  if (sender.length > maxLength) {
    throw new Error(
      `BREVO_SMS_SENDER must be ${maxLength} characters or fewer. Current value "${sender}" is ${sender.length} characters.`,
    );
  }

  return sender;
}

export const sendBrevoSms = async ({ to, body, tag }) => {
  const apiKey = process.env.BREVO_API_KEY || "";
  const sender = resolveSender();
  const recipient = normalizeRecipient(to);

  if (!apiKey) {
    console.log(
      `[BREVO SMS] (SIMULATED - no BREVO_API_KEY) to=${to} | body="${preview(body)}"`,
    );
    return {
      messageId: "SIMULATED_BREVO_SMS",
      status: "simulated",
      to,
      body,
      provider: "BREVO_SMS_SIMULATED",
    };
  }

  if (!recipient) {
    throw new Error("Brevo SMS recipient is missing or invalid.");
  }

  console.log(
    `[BREVO SMS] sending | sender=${sender} to=${recipient}${tag ? ` tag=${tag}` : ""} | body="${preview(body)}"`,
  );

  const response = await fetch(BREVO_SMS_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender,
      recipient,
      content: body,
      type: "transactional",
      ...(tag ? { tag } : {}),
      unicodeEnabled: true,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.message || `Brevo SMS failed with HTTP ${response.status}`;
    console.error(`[BREVO SMS] rejected | status=${response.status} | ${message}`);
    throw new Error(message);
  }

  console.log(`[BREVO SMS] accepted | messageId=${data?.messageId || "unknown"}`);

  return {
    messageId: data?.messageId,
    status: "accepted",
    to,
    body,
    provider: "BREVO_SMS",
    raw: data,
  };
};
