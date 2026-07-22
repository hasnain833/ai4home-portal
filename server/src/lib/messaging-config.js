import prisma from "./prisma.js";
import { decryptSafe } from "./crypto.js";

function isPubliclyReachable(hostname) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".localhost")) return false;
  if (h === "0.0.0.0" || h === "::1" || h === "[::1]") return false;
  if (/^127\./.test(h)) return false;
  if (/^10\./.test(h)) return false;
  if (/^192\.168\./.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return false;
  if (/^169\.254\./.test(h)) return false;
  return true;
}

export function buildSmsWebhookUrl(path, companyId) {
  const base = process.env.NEXT_PUBLIC_URL;
  if (!base) return null;
  try {
    const url = new URL(path, base);
    if (!isPubliclyReachable(url.hostname)) return null;
    if (companyId) url.searchParams.set("companyId", companyId);
    if (process.env.INBOUND_WEBHOOK_SECRET) {
      url.searchParams.set("token", process.env.INBOUND_WEBHOOK_SECRET);
    }
    return url.toString();
  } catch {
    return null;
  }
}

export async function getMessagingConfig(companyId) {
  if (!companyId) return { smtpConfig: null, smsConfig: null };

  const integrations = await prisma.integration.findMany({
    where: {
      companyId,
      isActive: true,
      platform: { in: ["BREVO_EMAIL", "TWILIO_SMS"] },
    },
  });

  let smtpConfig = null;
  let smsConfig = null;

  const emailInt = integrations.find((i) => i.platform === "BREVO_EMAIL");
  if (emailInt) {
    smtpConfig = {
      host: emailInt.smtpHost,
      port: emailInt.smtpPort,
      user: decryptSafe(emailInt.apiKey),
      pass: decryptSafe(emailInt.secretKey),
      senderEmail: emailInt.senderEmail,
      senderName: emailInt.senderName,
    };
  }

  const smsInt = integrations.find((i) => i.platform === "TWILIO_SMS");
  if (smsInt) {
    smsConfig = {
      provider: "TWILIO_SMS",
      accountSid: decryptSafe(smsInt.apiKey),
      authToken: decryptSafe(smsInt.secretKey),
      from: smsInt.senderName,
      statusCallbackUrl: buildSmsWebhookUrl("/api/sales/compliance/events/sms", companyId),
    };
  }

  return { smtpConfig, smsConfig };
}
