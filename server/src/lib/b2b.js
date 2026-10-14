import prisma from "./prisma.js";
import { MailService } from "../services/mail-service.js";
import { escapeHtml } from "./utils.js";

export const B2B_LEAD_STATUSES = ["NEW", "CONTACTED", "INTERESTED", "SIGNED", "LOST"];
export const B2B_CLOSED_STATUSES = ["SIGNED", "LOST"];
export const B2B_REPLY_TAG = "b2b";

const AVAILABILITY_KEY = "b2b.availability";
export const B2B_AVAILABILITY_DEFAULTS = {
  dayStart: "09:00",
  dayEnd: "17:00",
  slotDuration: 30,
  bufferMinutes: 15,
  workingDays: "Mon,Tue,Wed,Thu,Fri",
  timezone: "America/New_York",
};

export async function getB2BAvailability() {
  const row = await prisma.platformSetting.findUnique({ where: { key: AVAILABILITY_KEY } });
  return { ...B2B_AVAILABILITY_DEFAULTS, ...(row?.value || {}) };
}

export async function saveB2BAvailability(value) {
  await prisma.platformSetting.upsert({
    where: { key: AVAILABILITY_KEY },
    create: { key: AVAILABILITY_KEY, value },
    update: { value },
  });
  return getB2BAvailability();
}

export const appUrl = () => process.env.NEXT_PUBLIC_URL || "http://localhost:3000";
export const bookingLinkFor = (lead, campaignId) =>
  `${appUrl()}/meet/${lead.bookingToken}${campaignId ? `?c=${campaignId}` : ""}`;
export const unsubscribeLinkFor = (lead) => `${appUrl()}/unsubscribe/${lead.bookingToken}?type=b2b`;

export function validateSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return "Add at least one step.";
  if (steps.length > 20) return "A campaign can have at most 20 steps.";
  for (const [i, s] of steps.entries()) {
    if (!["EMAIL", "SMS"].includes(s?.channel)) return `Step ${i + 1} needs a channel (Email or SMS).`;
    if (!String(s.body || "").trim()) return `Step ${i + 1} needs a message.`;
    if (s.channel === "EMAIL" && !String(s.subject || "").trim()) return `Step ${i + 1} (email) needs a subject.`;
  }
  return null;
}

export function cleanSteps(steps) {
  return steps.map((s) => ({
    channel: s.channel,
    delayDays: Math.max(0, Math.min(365, parseInt(s.delayDays, 10) || 0)),
    subject: s.channel === "EMAIL" ? String(s.subject || "").trim() : "",
    body: String(s.body || ""),
  }));
}

export async function exitB2BEnrollments(leadId, reason, { campaignId } = {}) {
  const { count } = await prisma.b2BEnrollment.updateMany({
    where: { leadId, status: "ACTIVE", ...(campaignId ? { campaignId } : {}) },
    data: { status: "EXITED", exitedReason: reason, nextRunAt: null },
  });
  if (count) await completeFinishedCampaigns();
  return count;
}

export async function completeFinishedCampaigns(campaignId) {
  await prisma.b2BCampaign.updateMany({
    where: {
      ...(campaignId ? { id: campaignId } : {}),
      status: "ACTIVE",
      enrollments: { some: {}, none: { status: "ACTIVE" } },
    },
    data: { status: "COMPLETED" },
  });
}

export async function notifySuperAdmin(subject, html) {
  const to = process.env.SUPERADMIN_EMAIL;
  if (!to) {
    console.warn(`[B2B] SUPERADMIN_EMAIL is not set — dropped notification: ${subject}`);
    return;
  }
  await MailService.sendEmail({ to, subject, html, source: "b2b-notify", noReply: true }).catch((e) =>
    console.error("[B2B] Super admin notification failed:", e.message),
  );
}


export async function handleB2BReply({ channel, sender, body, subject }) {
  const contact = String(sender || "").trim().toLowerCase();
  if (!contact) return false;
  const digits = contact.replace(/\D/g, "").slice(-10);
  if (channel === "SMS" && !digits) return false;
  const lead = await prisma.b2BLead.findFirst({
    where: channel === "SMS" ? { phone: { contains: digits } } : { email: contact },
  });
  if (!lead) return false;

  await exitB2BEnrollments(lead.id, "REPLY");
  if (lead.status === "NEW") {
    await prisma.b2BLead.update({ where: { id: lead.id }, data: { status: "CONTACTED" } });
  }
  await notifySuperAdmin(
    `B2B lead reply from ${lead.companyName}${subject ? `: ${subject}` : ""}`,
    `<p><strong>${escapeHtml(lead.contactName || lead.companyName)}</strong> (${escapeHtml(lead.companyName)}, ` +
      `${escapeHtml(sender)}) replied by ${channel === "SMS" ? "text" : "email"}. ` +
      `Their campaign messages have been stopped.</p>` +
      `<blockquote style="border-left:3px solid #ccc;margin:0;padding-left:12px;white-space:pre-wrap">${escapeHtml(body || "")}</blockquote>` +
      `<p><a href="${appUrl()}/admin/leads">Open Business Leads</a></p>`,
  );
  return true;
}
