import prisma from "./prisma.js";
import { MailService } from "../services/mail-service.js";
import { resolveSystemConfig, getActiveSmsProvider } from "../services/sms.service.js";

export async function getSenderIdentity(companyId) {
  if (!companyId) return { senderName: null, replyTo: null };

  const company = await prisma.company
    .findUnique({ where: { id: companyId }, select: { name: true, email: true } })
    .catch(() => null);

  const inbound = String(process.env.INBOUND_EMAIL_DOMAIN || "").trim();
  return { senderName: company?.name || null, replyTo: inbound ? null : company?.email || null };
}

export async function getMessagingCapabilities() {
  const smsConfig = resolveSystemConfig(await getActiveSmsProvider());

  return {
    email: {
      configured: MailService.hasPlatformSender(),
      senderEmail: MailService.SENDER_EMAIL,
    },
    sms: {
      configured: !!smsConfig,
      provider: smsConfig?.provider || null,
    },
  };
}

function channelNeeds(channel) {
  const c = String(channel || "EMAIL").toUpperCase();
  return { email: c === "EMAIL" || c === "BOTH", sms: c === "SMS" || c === "BOTH" };
}

export async function missingChannelsFor(companyId, channel) {
  const needs = channelNeeds(channel);
  const caps = await getMessagingCapabilities();
  const missing = [];
  if (needs.email && !caps.email.configured) missing.push("Email");
  if (needs.sms && !caps.sms.configured) missing.push("SMS");
  return missing;
}

export async function missingChannelsForSteps(companyId, steps) {
  const types = new Set((steps || []).map((s) => String(s?.type || "").toUpperCase()));
  if (!types.has("EMAIL") && !types.has("SMS")) return [];

  const caps = await getMessagingCapabilities();
  const missing = [];
  if (types.has("EMAIL") && !caps.email.configured) missing.push("Email");
  if (types.has("SMS") && !caps.sms.configured) missing.push("SMS");
  return missing;
}

export function notConfiguredMessage(missing, operation) {
  return (
    `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} temporarily unavailable, so ` +
    `${operation} cannot be delivered. This is a platform issue — please contact support.`
  );
}
