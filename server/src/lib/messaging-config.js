import prisma from "./prisma.js";

/**
 * Resolve a company's active email (SMTP) and SMS provider configuration from the
 * Integration table, in the shape expected by MailService.sendEmail / sendSms.
 * Mirrors the extraction the nurture engine does so all send paths use the same
 * per-company credentials. Returns { smtpConfig, smsConfig } (either may be null).
 */
export async function getMessagingConfig(companyId) {
  if (!companyId) return { smtpConfig: null, smsConfig: null };

  const integrations = await prisma.integration.findMany({
    where: {
      companyId,
      isActive: true,
      platform: { in: ["BREVO_EMAIL", "BREVO_SMS", "TWILIO"] },
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

  const smsInt = integrations.find((i) => i.platform === "BREVO_SMS" || i.platform === "TWILIO");
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
