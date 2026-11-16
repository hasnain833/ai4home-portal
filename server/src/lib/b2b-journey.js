// Business-meeting follow-up: reminders, the no-show email and the unmarked-meeting alert.
// Scheduled nurture lives in the 180-day campaign (services/b2b-auto-nurture.js).
import prisma from "./prisma.js";
import { b2bLeadTimezone, sendHoursFor } from "./timezone.js";
import { formatSlotLabel, getZonedParts } from "./scheduling.js";
import { Templates } from "../services/templates.js";
import { blockReason, renderB2BStep } from "../inngest/functions/b2b-campaign.js";
import { MailService } from "../services/mail-service.js";
import { sendSms, smsSent } from "../services/sms.service.js";
import { B2B_REPLY_TAG, appUrl, b2bEmailHtml, bookingLinkFor, getB2BAvailability, notifySuperAdmin } from "./b2b.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const UNMARKED_MEETING_ALERT_KEY = "b2b.journey.unmarkedMeetingAlertAt";

const hasEmail = (lead) => !!lead.email && !lead.emailOptOut;

/** True at most once a day per key, so a standing problem doesn't flood the inbox. */
async function onceADay(key) {
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  if (row && Date.now() - new Date(row.value?.at).getTime() < DAY_MS) return false;
  const value = { at: new Date().toISOString() };
  await prisma.platformSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  return true;
}

/** A meeting left Confirmed after it happened has no outcome on record, so say so daily. */
export async function alertUnmarkedMeetings(now = new Date()) {
  const rows = await prisma.salesAgentAppointment.findMany({
    where: { status: "CONFIRMED", b2bLeadId: { not: null }, startTime: { lt: new Date(now.getTime() - DAY_MS) } },
    include: { b2bLead: { select: { companyName: true, contactName: true } } },
    orderBy: { startTime: "asc" },
    take: 50,
  });
  if (!rows.length || !(await onceADay(UNMARKED_MEETING_ALERT_KEY))) return rows.length;
  const { timezone } = await getB2BAvailability();
  const meetings = rows.map((a) => ({
    company: a.b2bLead?.companyName || "Unknown company",
    contact: a.b2bLead?.contactName || "",
    when: formatSlotLabel(a.startTime, timezone),
  }));
  await notifySuperAdmin(
    `${rows.length} business meeting${rows.length === 1 ? "" : "s"} need an outcome`,
    Templates.getUnmarkedMeetingsEmail(meetings, `${appUrl()}/admin/sales-agent-appointments`),
  );
  return rows.length;
}

/** Whether a message may go out now on the lead's clock (8am–9pm). */
export function insideSendWindow(lead, now = new Date()) {
  const { timezone, known } = b2bLeadTimezone(lead);
  const hours = sendHoursFor(known);
  const { hour, minute } = getZonedParts(now, timezone);
  const clock = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return clock >= hours.start && clock < hours.end;
}

const REPLY_TO = () => {
  const inbound = String(process.env.INBOUND_EMAIL_DOMAIN || "").trim();
  return inbound ? `reply+${B2B_REPLY_TAG}@${inbound}` : process.env.SUPERADMIN_EMAIL || undefined;
};

/** A plain email outside any campaign: reminders and rebooking messages. */
async function sendMeetingEmail(lead, subject, text, { bookingButton = false } = {}) {
  if (!hasEmail(lead)) return;
  const r = await MailService.sendEmail({
    to: lead.email,
    subject,
    html: b2bEmailHtml(text, lead, { bookingLink: bookingLinkFor(lead), bookingButton }),
    fromName: "AI for Homebuilders",
    replyTo: REPLY_TO(),
    source: "b2b-meeting",
    track: { leadId: lead.id, stepId: "b2b-meeting" },
  });
  await prisma.b2BMessage.create({
    data: { leadId: lead.id, direction: "OUT", actor: "AGENT", channel: "EMAIL", subject, body: text, outcome: r.success ? "sent" : r.outcome || "failed", note: r.success ? "meeting" : r.error || null },
  });
}

/** Sends the day-before reminder once, by email and by text where consent allows. */
export async function sendMeetingReminder(appointment, label) {
  const claim = await prisma.salesAgentAppointment.updateMany({
    where: { id: appointment.id, reminderSentAt: null, status: "CONFIRMED" },
    data: { reminderSentAt: new Date() },
  });
  if (!claim.count || !appointment.b2bLead) return false;
  const lead = appointment.b2bLead;
  await sendMeetingEmail(lead, "Reminder: your meeting with AI for Homebuilders", `Hi ${lead.contactName?.split(" ")[0] || "there"},\n\nA quick reminder of your meeting on ${label}. If anything has changed, just reply to this email.\n\nThe AI4Home team`);
  if (!(await blockReason(lead, "SMS"))) {
    const { body } = renderB2BStep({ channel: "SMS", noBookingLink: true, body: `Reminder: your meeting is on ${label}. Reply here if anything changes.` }, lead, null, "b2b-meeting");
    const r = await sendSms({ to: lead.phone, body, source: "b2b-meeting", brand: false, track: { leadId: lead.id, stepId: "b2b-meeting" } });
    if (!smsSent(r)) console.warn(`[B2B meeting] Reminder text not sent: ${r.error}`);
  }
  return true;
}

/** A missed meeting gets a friendly rebooking email. */
export async function journeyOnMeetingStatus(leadId, status) {
  if (status !== "NO_SHOW" || !leadId) return;
  const lead = await prisma.b2BLead.findUnique({ where: { id: leadId } });
  if (!lead) return;
  await sendMeetingEmail(
    lead,
    "Sorry we missed you",
    `Hi ${lead.contactName?.split(" ")[0] || "there"},\n\nIt looks like we missed each other. If you'd still like to talk, you can pick a new time below.\n\nThe AI4Home team`,
    { bookingButton: true },
  );
}
