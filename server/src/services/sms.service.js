export const sendSms = async ({ to, body, smsConfig, tag }) => {
  if (!smsConfig) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { messageId: "SIMULATED_MSG_ID", status: "delivered", to, body };
  }

  try {
    const apiKey = smsConfig.apiKey;
    const sender = smsConfig.senderName;

    if (!apiKey) {
      throw new Error("Brevo SMS API key missing in company configuration");
    }

    const payload = {
      type: "transactional",
      unicodeEnabled: false,
      sender,
      recipient: to,
      content: body,
      ...(tag && { tag })
    };

    const response = await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": apiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Failed to send Brevo SMS");
    }

    return { ...data, provider: "BREVO_SMS" };
  } catch (error) {
    console.error(`[SMS Service] Failed to send message to ${to}:`, error);
    throw error;
  }
};
