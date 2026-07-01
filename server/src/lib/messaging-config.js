import prisma from "./prisma.js";
export async function getMessagingConfig(companyId) {
  if (!companyId) return { smtpConfig: null, smsConfig: null };

  const integrations = await prisma.integration.findMany({
    where: {
      companyId,
      isActive: true,
      platform: { in: ["BREVO_EMAIL", "BREVO_SMS"] },
    },
  });

  let smtpConfig = null;
  let smsConfig = null;

  const emailInt = integrations.find((i) => i.platform === "BREVO_EMAIL");
  if (emailInt) {
    smtpConfig = {
      host: emailInt.smtpHost,
      port: emailInt.smtpPort,
      user: emailInt.apiKey,
      pass: emailInt.secretKey,
      senderEmail: emailInt.senderEmail,
      senderName: emailInt.senderName,
    };
  }

  const smsInt = integrations.find((i) => i.platform === "BREVO_SMS");
  if (smsInt) {
    smsConfig = {
      provider: smsInt.platform,
      apiKey: smsInt.apiKey,
      apiSecret: smsInt.secretKey,
      senderName: smsInt.senderName,
    };
  }

  return { smtpConfig, smsConfig };
}
