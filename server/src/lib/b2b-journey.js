import prisma from "./prisma.js";
import { b2bLeadTimezone, nextLocalSendTime, safeSendTime, sendHoursFor } from "./timezone.js";
import { getZonedParts } from "./scheduling.js";
import { escapeHtml } from "./utils.js";
import { blockReason, sendStep, renderB2BStep } from "../inngest/functions/b2b-campaign.js";
import { MailService } from "../services/mail-service.js";
import { sendSms, smsSent } from "../services/sms.service.js";
import {
  B2B_CLOSED_STATUSES,
  B2B_REPLY_TAG,
  QUIET_AFTER,
  b2bEmailHtml,
  bookingLinkFor,
  getB2BJourneySettings,
  notifySuperAdmin,
  weeklyLimitReached,
} from "./b2b.js";

export const JOURNEY_STAGES = ["FIRST_TOUCH", "NO_RESPONSE", "QUARTERLY", "RESPONDED", "BOT_ENGAGED", "APPOINTMENT_BOOKED"];
// Stages that send approved content. Responded is the agent's; it sends nothing scheduled.
export const CONTENT_STAGES = ["FIRST_TOUCH", "NO_RESPONSE", "QUARTERLY", "BOT_ENGAGED", "APPOINTMENT_BOOKED"];
export const CONTENT_CATEGORIES = ["ABOUT", "INDUSTRY"];

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_TOUCH_GAP_DAYS = [4, 5];
const NO_RESPONSE_GAP_DAYS = 7;
const QUARTERLY_GAP_DAYS = 90;
const BOT_ENGAGED_GAP_DAYS = 7;
const BOT_ENGAGED_TOUCHES = 3;
const NO_RESPONSE_MAX_TOUCHES = 12;
const UNOPENED_LIMIT = 6;
const MAX_FAILURES = 3;
const HOLD_ALERT_KEY = "b2b.journey.holdAlertAt";

/** Which channel this touch wants before consent and limits are checked. */
export function plannedChannel(stage, touches) {
  if (stage === "FIRST_TOUCH") return touches === 2 ? "SMS" : "EMAIL";
  if (stage === "NO_RESPONSE") return (touches + 1) % 3 === 0 ? "SMS" : "EMAIL";
  return "EMAIL";
}

export const otherCategory = (category) => (category === "ABOUT" ? "INDUSTRY" : "ABOUT");

/** Where the lead goes after a send: same or next stage, and how long until the next touch. */
export function afterSend(stage, touches, noOpens) {
  switch (stage) {
    case "FIRST_TOUCH":
      return touches >= 3 ? { stage: "NO_RESPONSE", touches: 0, gapDays: NO_RESPONSE_GAP_DAYS } : { stage, touches, gapDays: FIRST_TOUCH_GAP_DAYS[touches - 1] };
    case "NO_RESPONSE":
      return noOpens || touches >= NO_RESPONSE_MAX_TOUCHES ? { stage: "QUARTERLY", touches: 0, gapDays: QUARTERLY_GAP_DAYS } : { stage, touches, gapDays: NO_RESPONSE_GAP_DAYS };
    case "BOT_ENGAGED":
      return touches >= BOT_ENGAGED_TOUCHES ? { stage: "QUARTERLY", touches: 0, gapDays: QUARTERLY_GAP_DAYS } : { stage, touches, gapDays: BOT_ENGAGED_GAP_DAYS };
    case "QUARTERLY":
      return { stage, touches, gapDays: QUARTERLY_GAP_DAYS };
    default:
      // A booked lead gets one prep piece, then waits for the meeting.
      return { stage, touches, gapDays: null };
  }
}

/** The next allowed day and time on the lead's clock, at or after `from`. */
export function nextJourneySlot(lead, settings, channel, from = new Date(), now = new Date()) {
  const { timezone, known } = b2bLeadTimezone(lead);
  const time = safeSendTime(channel === "SMS" ? settings.smsTime : settings.emailTime, known);
  const days = settings.sendDays.split(",");
  let base = from;
  for (let i = 0; i < 14; i++) {
    const slot = nextLocalSendTime(base, timezone, time, now);
    if (days.includes(getZonedParts(slot, timezone).weekday)) return slot;
    base = new Date(slot.getTime() + DAY_MS);
  }
  return nextLocalSendTime(from, timezone, time, now);
}

const hasEmail = (lead) => !!lead.email && !lead.emailOptOut;

/** Joins leads at the stage that fits them. Returns how many joined and how many were skipped. */
export async function joinJourney(leadIds) {
  const settings = await getB2BJourneySettings();
  const leads = await prisma.b2BLead.findMany({ where: { id: { in: leadIds } } });
  let joined = 0;
  for (const lead of leads) {
    if (lead.journeyStage || B2B_CLOSED_STATUSES.includes(lead.status) || !hasEmail(lead)) continue;
    const meeting = await prisma.salesAgentAppointment.findFirst({
      where: { b2bLeadId: lead.id, OR: [{ status: "CONFIRMED", startTime: { gte: new Date() } }, { status: "PENDING" }] },
      select: { id: true },
    });
    await prisma.b2BLead.update({
      where: { id: lead.id },
      data: {
        journeyStage: meeting ? "APPOINTMENT_BOOKED" : "FIRST_TOUCH",
        journeyTouches: 0,
        journeyFailures: 0,
        journeyHoldReason: null,
        journeyEnteredAt: new Date(),
        journeyNextAt: nextJourneySlot(lead, settings, "EMAIL"),
      },
    });
    joined++;
  }
  return { joined, skipped: leadIds.length - joined };
}

/** Website leads who gave marketing consent join once. CSV and manual leads join only when staff add them. */
export async function autoJoinWebsiteLeads() {
  const leads = await prisma.b2BLead.findMany({
    where: {
      source: { startsWith: "WEBSITE_" },
      marketingOptIn: true,
      emailOptOut: false,
      journeyStage: null,
      journeyEnteredAt: null,
      status: { notIn: B2B_CLOSED_STATUSES },
      // First touch is for someone who has never heard from us, not a lead already in talks.
      messages: { none: { actor: { in: ["LEAD", "AGENT"] } } },
      appointments: { none: { status: { in: ["COMPLETED", "NO_SHOW"] } } },
    },
    select: { id: true },
    take: 500,
  });
  return leads.length ? joinJourney(leads.map((l) => l.id)) : { joined: 0, skipped: 0 };
}

/** The next approved piece they haven't had, alternating categories. Memory breaks ties when re-engaging. */
export async function pickContent(lead, stage, channel) {
  const seen = await prisma.b2BMessage.findMany({
    where: { leadId: lead.id, contentItemId: { not: null } },
    select: { contentItemId: true },
  });
  const items = await prisma.b2BContentItem.findMany({
    where: {
      status: "APPROVED",
      stage,
      channel,
      id: { notIn: seen.map((s) => s.contentItemId) },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    // Staff set the sequence with Send order. Unnumbered pieces follow, oldest first.
    orderBy: [{ sendOrder: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
  });
  if (!items.length) return null;
  const wanted = otherCategory(lead.journeyLastCategory);
  const pool = items.filter((i) => i.category === wanted);
  const choices = pool.length ? pool : items;
  const interest = String(lead.profile?.main_interest || "").toLowerCase();
  const topics = ["warranty", "sales", "inquir", "follow"].filter((word) => interest.includes(word));
  return choices.find((i) => topics.some((word) => `${i.subject || ""} ${i.body}`.toLowerCase().includes(word))) || choices[0];
}

async function noOpensLately(leadId) {
  const sends = await prisma.messageUsage.findMany({
    where: { leadId, source: "b2b-campaign", stepId: { startsWith: "content:" } },
    orderBy: { createdAt: "desc" },
    take: UNOPENED_LIMIT,
    select: { openedAt: true, clickedAt: true },
  });
  return sends.length >= UNOPENED_LIMIT && sends.every((s) => !s.openedAt && !s.clickedAt);
}

/** One alert a day is enough to say the library has run dry. */
async function alertContentGap(reason) {
  const row = await prisma.platformSetting.findUnique({ where: { key: HOLD_ALERT_KEY } });
  if (row && Date.now() - new Date(row.value?.at).getTime() < DAY_MS) return;
  const value = { at: new Date().toISOString() };
  await prisma.platformSetting.upsert({ where: { key: HOLD_ALERT_KEY }, create: { key: HOLD_ALERT_KEY, value }, update: { value } });
  await notifySuperAdmin("Nurture journey is waiting for approved content", `<p>${escapeHtml(reason)}. Builders in this stage are on hold until staff approve more content on the Nurture page.</p>`);
}

/** Whether a message may go out now. Every send checks this, however late or early its job ran. */
export function insideSendWindow(lead, settings, now = new Date(), { ignoreDays = false } = {}) {
  const { timezone, known } = b2bLeadTimezone(lead);
  const hours = sendHoursFor(known);
  const { hour, minute, weekday } = getZonedParts(now, timezone);
  const clock = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  if (clock < hours.start || clock >= hours.end) return false;
  return ignoreDays || settings.sendDays.split(",").includes(weekday);
}

/**
 * One scheduled step for one lead. Runs the checks in order, then sends or reschedules.
 * Returns what happened, for the job log and tests. `sendNow` skips the wait for a sending day,
 * but never the 8am-9pm hours.
 */
export async function journeyTouch(leadId, { sendNow = false } = {}) {
  const lead = await prisma.b2BLead.findUnique({ where: { id: leadId } });
  if (!lead?.journeyStage || !lead.journeyNextAt || lead.journeyNextAt > new Date()) return { action: "not due" };

  // Claim it, so a duplicate job can't send the same touch twice.
  const claim = await prisma.b2BLead.updateMany({
    where: { id: leadId, journeyNextAt: lead.journeyNextAt },
    data: { journeyNextAt: new Date(Date.now() + 60 * 60 * 1000) },
  });
  if (!claim.count) return { action: "already handled" };

  const settings = await getB2BJourneySettings();
  const { journeyStage: stage, journeyTouches: touches } = lead;
  const later = (channel, reason) =>
    prisma.b2BLead.update({ where: { id: leadId }, data: { journeyNextAt: nextJourneySlot(lead, settings, channel), journeyHoldReason: reason } });

  // 1. Is this lead still active?
  if (B2B_CLOSED_STATUSES.includes(lead.status)) {
    await prisma.b2BLead.update({ where: { id: leadId }, data: { journeyStage: null, journeyNextAt: null, journeyHoldReason: null } });
    return { action: "ended", reason: lead.status };
  }
  if (lead.agentPausedAt) {
    await later("EMAIL", "A person is handling this lead");
    return { action: "held", reason: "paused" };
  }
  const inCampaign = await prisma.b2BEnrollment.count({ where: { leadId, status: "ACTIVE" } });
  if (inCampaign) {
    await later("EMAIL", "Waiting for a running campaign to finish");
    return { action: "held", reason: "campaign" };
  }

  // A booked or requested meeting outranks every other stage, so nobody is told to book twice.
  if (stage !== "APPOINTMENT_BOOKED") {
    const meeting = await prisma.salesAgentAppointment.findFirst({
      where: { b2bLeadId: leadId, OR: [{ status: "CONFIRMED", startTime: { gte: new Date() } }, { status: "PENDING" }] },
      select: { id: true },
    });
    if (meeting) {
      await prisma.b2BLead.update({ where: { id: leadId }, data: { journeyStage: "APPOINTMENT_BOOKED", journeyTouches: 0, journeyHoldReason: null, journeyNextAt: nextJourneySlot(lead, settings, "EMAIL") } });
      return { action: "moved", stage: "APPOINTMENT_BOOKED" };
    }
  }

  // 2. Which stage? A conversation that went quiet becomes Bot engaged.
  if (stage === "RESPONDED") {
    const last = await prisma.b2BMessage.findFirst({
      where: { leadId, actor: { in: ["LEAD", "AGENT"] } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const quietAt = new Date((last?.createdAt.getTime() || 0) + QUIET_AFTER);
    if (quietAt > new Date()) {
      await prisma.b2BLead.update({ where: { id: leadId }, data: { journeyNextAt: quietAt } });
      return { action: "waiting", reason: "conversation still recent" };
    }
    await prisma.b2BLead.update({ where: { id: leadId }, data: { journeyStage: "BOT_ENGAGED", journeyTouches: 0, journeyNextAt: nextJourneySlot(lead, settings, "EMAIL") } });
    return { action: "moved", stage: "BOT_ENGAGED" };
  }

  // A job can run late or a booking can set the step to "now", so check the clock here.
  if (!insideSendWindow(lead, settings, new Date(), { ignoreDays: sendNow })) {
    await later(plannedChannel(stage, touches), null);
    return { action: "held", reason: "outside sending hours" };
  }

  // 3–6. Which channel and piece is allowed right now?
  const planned = plannedChannel(stage, touches);
  const smsBlock = await blockReason(lead, "SMS");
  const usable = (channel) => (channel === "SMS" ? !smsBlock : hasEmail(lead));
  const order = planned === "SMS" ? ["SMS", "EMAIL"] : ["EMAIL", "SMS"];
  const channels = order.filter(usable);
  if (!channels.length) {
    await prisma.b2BLead.update({ where: { id: leadId }, data: { journeyStage: null, journeyNextAt: null, journeyHoldReason: null } });
    return { action: "ended", reason: "no way to reach this lead" };
  }

  let item = null;
  let channel = null;
  let limited = false;
  for (const option of channels) {
    if (await weeklyLimitReached(leadId, option, settings)) { limited = true; continue; }
    item = await pickContent(lead, stage, option);
    if (item) { channel = option; break; }
  }
  if (!item) {
    if (limited) {
      await later(channels[0], "Weekly limit reached");
      return { action: "held", reason: "weekly limit" };
    }
    // Nothing left is normal for the single prep piece; the meeting still goes ahead.
    if (stage === "APPOINTMENT_BOOKED") {
      await prisma.b2BLead.update({ where: { id: leadId }, data: { journeyNextAt: null, journeyHoldReason: null } });
      return { action: "waiting", reason: "no prep content" };
    }
    const reason = `No approved ${stage.replace(/_/g, " ").toLowerCase()} content is left for ${lead.companyName}`;
    await later(channels[0], reason);
    await alertContentGap(reason);
    return { action: "held", reason: "no content" };
  }

  // 7–8. Send it word for word, and record it so the agent knows what they're replying to.
  const stepId = `content:${item.id}`;
  const noBookingLink = stage === "APPOINTMENT_BOOKED";
  const sent = await sendStep({ channel, subject: item.subject, body: item.body, noBookingLink }, lead, null, stepId).catch((error) => ({
    sent: false,
    error: error?.message || "Unexpected error",
  }));

  if (!sent.sent) {
    const failures = lead.journeyFailures + 1;
    if (failures < MAX_FAILURES) {
      await prisma.b2BLead.update({ where: { id: leadId }, data: { journeyFailures: failures, journeyNextAt: nextJourneySlot(lead, settings, channel), journeyHoldReason: `Last send failed: ${String(sent.error).slice(0, 200)}` } });
      return { action: "retry", error: sent.error };
    }
    await notifySuperAdmin(`Nurture send keeps failing: ${lead.companyName}`, `<p>The journey tried ${MAX_FAILURES} times and is moving on. Last error: ${escapeHtml(String(sent.error).slice(0, 300))}</p>`);
  } else {
    await prisma.b2BMessage.create({
      data: { leadId, direction: "OUT", actor: "CAMPAIGN", channel, subject: sent.subject, body: sent.text, outcome: "sent", handledAt: new Date(), contentItemId: item.id, note: `null|${stepId}` },
    });
  }

  const count = touches + 1;
  const next = afterSend(stage, count, stage === "NO_RESPONSE" && (await noOpensLately(leadId)));
  const nextChannel = next.gapDays === null ? null : plannedChannel(next.stage, next.touches);
  await prisma.b2BLead.update({
    where: { id: leadId },
    data: {
      journeyStage: next.stage,
      journeyTouches: next.touches,
      journeyFailures: 0,
      journeyHoldReason: null,
      journeyLastCategory: item.category,
      journeyNextAt: next.gapDays === null ? null : nextJourneySlot(lead, settings, nextChannel, new Date(Date.now() + next.gapDays * DAY_MS)),
      ...(sent.sent && lead.status === "NEW" ? { status: "CONTACTED" } : {}),
    },
  });
  return { action: sent.sent ? "sent" : "failed", channel, itemId: item.id, stage: next.stage };
}

// ---------- Meetings ----------

const REPLY_TO = () => {
  const inbound = String(process.env.INBOUND_EMAIL_DOMAIN || "").trim();
  return inbound ? `reply+${B2B_REPLY_TAG}@${inbound}` : process.env.SUPERADMIN_EMAIL || undefined;
};

/** A plain email outside the content library: reminders and rebooking messages. */
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

/** Keeps the journey in step with what happened to the meeting. */
export async function journeyOnMeetingStatus(leadId, status) {
  const lead = leadId ? await prisma.b2BLead.findUnique({ where: { id: leadId } }) : null;
  if (!lead) return;
  const settings = await getB2BJourneySettings();
  const backToEngaged = () =>
    prisma.b2BLead.updateMany({
      where: { id: leadId, journeyStage: { not: null } },
      data: { journeyStage: "BOT_ENGAGED", journeyTouches: 0, journeyHoldReason: null, journeyNextAt: nextJourneySlot(lead, settings, "EMAIL", new Date(Date.now() + 2 * DAY_MS)) },
    });
  if (status === "NO_SHOW") {
    await sendMeetingEmail(
      lead,
      "Sorry we missed you",
      `Hi ${lead.contactName?.split(" ")[0] || "there"},\n\nIt looks like we missed each other. If you'd still like to talk, you can pick a new time below.\n\nThe AI4Home team`,
      { bookingButton: true },
    );
    await backToEngaged();
  } else if (status === "CANCELLED") {
    await backToEngaged();
  } else if (status === "CONFIRMED") {
    // A cancelled meeting can be re-confirmed, and a requested one confirmed by staff.
    await prisma.b2BLead.updateMany({
      where: { id: leadId, journeyStage: { not: null, notIn: ["APPOINTMENT_BOOKED"] } },
      data: { journeyStage: "APPOINTMENT_BOOKED", journeyTouches: 0, journeyHoldReason: null, journeyNextAt: nextJourneySlot(lead, settings, "EMAIL") },
    });
  } else if (status === "COMPLETED") {
    // The meeting happened: a person owns this lead from here.
    await prisma.b2BLead.updateMany({ where: { id: leadId, journeyStage: { not: null } }, data: { journeyStage: null, journeyNextAt: null, journeyHoldReason: null } });
  }
}
