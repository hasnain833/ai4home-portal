import prisma from "./prisma.js";
import { decryptSafe } from "./crypto.js";
import { SMS_PROVIDERS, isComplete as isSmsConfigComplete } from "../services/sms.service.js";

function isPubliclyReachable(hostname) {
  const h = hostname.toLowerCase();
  const loopbackName = "local" + "host";
  if (h === loopbackName || h.endsWith(".local") || h.endsWith(`.${loopbackName}`)) return false;
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
      platform: { in: ["BREVO_EMAIL", ...SMS_PROVIDERS] },
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

   const smsInt = integrations.find((i) => SMS_PROVIDERS.includes(i.platform));
  if (smsInt) {
    smsConfig = {
      provider: smsInt.platform,
      apiKey: decryptSafe(smsInt.apiKey),
      apiSecret: decryptSafe(smsInt.secretKey),
      from: smsInt.senderName,
      statusCallbackUrl: buildSmsWebhookUrl("/api/sales/compliance/inbound/sms-status", companyId),
    };
  }

  return { smtpConfig, smsConfig };
}

export async function getMessagingCapabilities(companyId) {
  const { smtpConfig, smsConfig } = await getMessagingConfig(companyId);

  const emailConfigured = !!(smtpConfig?.host && smtpConfig?.user && smtpConfig?.pass);
  const smsConfigured = isSmsConfigComplete(smsConfig);

  return {
    email: {
      configured: emailConfigured,
      senderEmail: emailConfigured ? smtpConfig.senderEmail || null : null,
    },
    sms: {
      configured: smsConfigured,
      provider: smsConfigured ? smsConfig.provider : null,
    },
  };
}

export function channelNeeds(channel) {
  const c = String(channel || "EMAIL").toUpperCase();
  return { email: c === "EMAIL" || c === "BOTH", sms: c === "SMS" || c === "BOTH" };
}

export async function missingChannelsFor(companyId, channel) {
  const needs = channelNeeds(channel);
  const caps = await getMessagingCapabilities(companyId);
  const missing = [];
  if (needs.email && !caps.email.configured) missing.push("Email");
  if (needs.sms && !caps.sms.configured) missing.push("SMS");
  return missing;
}

export async function missingChannelsForSteps(companyId, steps) {
  const types = new Set((steps || []).map((s) => String(s?.type || "").toUpperCase()));
  if (!types.has("EMAIL") && !types.has("SMS")) return [];

  const caps = await getMessagingCapabilities(companyId);
  const missing = [];
  if (types.has("EMAIL") && !caps.email.configured) missing.push("Email");
  if (types.has("SMS") && !caps.sms.configured) missing.push("SMS");
  return missing;
}

export function notConfiguredMessage(missing, operation) {
  return (
    `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not configured, so ` +
    `${operation} cannot be delivered. Add your credentials in Settings > Email, SMS & News.`
  );
}
