import prisma from "../lib/prisma.js";
import { getB2BAvailability, exitB2BEnrollments } from "../lib/b2b.js";
import { platformCalendlyPointer } from "../lib/platform-calendly.js";
import { cancelCalendlyVisit } from "./calendly.service.js";
import { computeAvailableSlots, formatSlotLabel } from "../lib/scheduling.js";
import { parseWebsiteInquiry, inquiryHash, WEBSITE_CONSENT_TEXT } from "../lib/website-inquiry.js";
import { busyFor, listCalendarConnections } from "./admin-calendar.service.js";
import { inngest } from "../lib/inngest.js";

const DAYS = 21;
const DAY_MS = 86_400_000;
const bookingFrom = () => new Date(Date.now() + 60 * 60_000);

/** Mirrors meeting changes into connected Google/Outlook calendars; the 5-minute sweep catches a lost event. */
export const requestCalendarSync = () => inngest.send({ name: "admin-calendar/sync", data: {} }).catch(() => {});

/**
 * Each connected Super Admin / Super Staff member whose calendar can be read, with their busy times:
 * their calendar, their own meetings, and unassigned meetings (which hold the whole team).
 * null when nobody is connected (or no calendar can be read): the team then books as one calendar.
 */
async function teamBusy(setting, from, db) {
  const connections = await listCalendarConnections();
  if (!connections.length) return null;
  const to = new Date(from.getTime() + (DAYS + 1) * DAY_MS);
  const gap = setting.bufferMinutes * 60_000;
  const pad = (b) => ({ start: new Date(b.start.getTime() - gap), end: new Date(b.end.getTime() + gap) });
  const people = (await Promise.all(connections.map(async (c) => ({ userId: c.userId, calendar: await busyFor(c, from, to) })))).filter((p) => p.calendar);
  if (!people.length) return null;
  const taken = await db.salesAgentAppointment.findMany({
    where: { status: { not: "CANCELLED" }, startTime: { gte: new Date(from.getTime() - DAY_MS), lte: to } },
    select: { startTime: true, assignedUserId: true },
  });
  const meeting = (a) => pad({ start: a.startTime, end: new Date(a.startTime.getTime() + setting.slotDuration * 60_000) });
  return people.map((p) => ({
    userId: p.userId,
    busy: [...p.calendar.map(pad), ...taken.filter((a) => !a.assignedUserId || a.assignedUserId === p.userId).map(meeting)],
  }));
}

/** Open times: with connected calendars, a time is open when at least one person is free. */
export async function getPlatformSlots(setting, db = prisma) {
  const from = bookingFrom();
  const team = await teamBusy(setting, from, db);
  if (team) {
    const all = team.flatMap((p) => computeAvailableSlots({ setting, from, days: DAYS, busy: p.busy, limit: 500 }));
    return [...new Map(all.map((d) => [d.getTime(), d])).values()].sort((a, b) => a - b).slice(0, 200);
  }
  const taken = await db.salesAgentAppointment.findMany({
    where: { status: { not: "CANCELLED" }, startTime: { gte: new Date(from.getTime() - DAY_MS), lte: new Date(from.getTime() + DAYS * DAY_MS) } },
    select: { startTime: true },
  });
  const gap = setting.bufferMinutes * 60_000;
  const busy = taken.map((a) => ({ start: new Date(a.startTime.getTime() - gap), end: new Date(a.startTime.getTime() + setting.slotDuration * 60_000 + gap) }));
  return computeAvailableSlots({ setting, from, days: DAYS, busy, limit: 200 });
}

/**
 * Who takes a meeting at `start`: the free connected person with the fewest upcoming meetings.
 * { userId: null } = no connected calendars, book for the team; { userId: undefined } = nobody is free.
 */
export async function pickAssignee(start, setting, db = prisma) {
  const team = await teamBusy(setting, bookingFrom(), db);
  if (!team) return { userId: null };
  const end = start.getTime() + setting.slotDuration * 60_000;
  const free = team.filter((p) => !p.busy.some((b) => start.getTime() < b.end.getTime() && end > b.start.getTime())).map((p) => p.userId);
  if (!free.length) return { userId: undefined };
  const load = await db.salesAgentAppointment.groupBy({
    by: ["assignedUserId"],
    where: { assignedUserId: { in: free }, status: { not: "CANCELLED" }, startTime: { gte: new Date() } },
    _count: true,
  });
  const count = (id) => load.find((l) => l.assignedUserId === id)?._count || 0;
  return { userId: free.reduce((best, id) => (count(id) < count(best) ? id : best)) };
}

/** Meetings that would overlap one at `start` for this person (or, unassigned, for anyone). */
export const clashWhere = (start, setting, userId, excludeId) => ({
  ...(excludeId ? { id: { not: excludeId } } : {}),
  status: { not: "CANCELLED" },
  startTime: {
    gt: new Date(start.getTime() - (setting.slotDuration + setting.bufferMinutes) * 60_000),
    lt: new Date(start.getTime() + (setting.slotDuration + setting.bufferMinutes) * 60_000),
  },
  ...(userId ? { OR: [{ assignedUserId: userId }, { assignedUserId: null }] } : {}),
});

/** Books a lead into an open slot. Returns { taken: true } when the slot is gone. */
export async function bookB2BMeeting({ lead, start, setting, campaignId }) {
  const upcoming = await prisma.salesAgentAppointment.findFirst({
    where: { b2bLeadId: lead.id, status: "CONFIRMED", startTime: { gte: new Date() } },
  });
  if (upcoming) return { alreadyBooked: true };
  if (!(await getPlatformSlots(setting)).some((s) => s.getTime() === start.getTime())) return { taken: true };
  const { userId: assignedUserId } = await pickAssignee(start, setting);
  if (assignedUserId === undefined) return { taken: true };

  // Which campaign brought them here: the link's ?c=, else their most recent enrollment.
  const enrollment = await prisma.b2BEnrollment.findFirst({
    where: { leadId: lead.id, ...(campaignId ? { campaignId: String(campaignId) } : {}) },
    orderBy: { updatedAt: "desc" },
    include: { campaign: { select: { name: true } } },
  });
  const label = formatSlotLabel(start, setting.timezone);

  let appointment;
  try {
    // Serializable: two leads racing for the same slot cannot both pass the overlap check.
    appointment = await prisma.$transaction(
      async (tx) => {
        const clash = await tx.salesAgentAppointment.findFirst({ where: clashWhere(start, setting, assignedUserId) });
        if (clash) return null;
        return tx.salesAgentAppointment.create({
          data: {
            name: lead.contactName || lead.companyName,
            email: lead.email,
            phone: lead.phone || "",
            preferredTime: label,
            source: "CAMPAIGN",
            campaignName: enrollment?.campaign.name || null,
            startTime: start,
            b2bLeadId: lead.id,
            assignedUserId,
          },
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (e) {
    if (e?.code !== "P2034") throw e; // serialization conflict = someone else got the slot
  }
  if (!appointment) return { taken: true };
  await requestCalendarSync();

  // Booked: this lead leaves every campaign; the campaigns carry on for everyone else.
  await exitB2BEnrollments(lead.id, "APPOINTMENT");
  if (["NEW", "CONTACTED"].includes(lead.status)) {
    await prisma.b2BLead.update({ where: { id: lead.id }, data: { status: "INTERESTED" } });
  }
  return { appointment, label, enrollment };
}

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function parseSalesBooking(body) {
  if (body?.meetingConsent !== true) throw fail("Please agree to receive meeting confirmations by email and SMS.");
  let p;
  try { p = parseWebsiteInquiry({ ...body, type: "DEMO" }); } catch (e) { throw fail(e.message); }
  if (!p.phone) throw fail("A valid phone number is required for meeting confirmations.");
  const start = typeof body.startTime === "string" ? new Date(body.startTime) : new Date(NaN);
  if (!Number.isFinite(start.getTime())) throw fail("Choose an available meeting time.");
  return { ...p, type: "BOOKING", startTime: start.toISOString(), meetingConsent: true };
}

// Lead, meeting, and durable notification job commit together. Retries cannot create a second meeting.
export async function saveSalesBooking(id, payload, db = prisma, availability = getB2BAvailability) {
  const hash = inquiryHash(payload);
  const setting = await availability();
  const start = new Date(payload.startTime);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const prior = await tx.b2BInquiry.findUnique({ where: { id } });
        if (prior) {
          if (prior.payloadHash !== hash || prior.type !== "BOOKING") throw fail("Request ID already used. Please restart the booking.", 409);
          return { label: prior.payload.label, appointmentId: id };
        }
        if (!(await getPlatformSlots(setting, tx)).some((s) => s.getTime() === start.getTime())) throw fail("That time is no longer available. Please choose another.", 409);
        const { userId: assignedUserId } = await pickAssignee(start, setting, tx);
        if (assignedUserId === undefined || await tx.salesAgentAppointment.findFirst({ where: clashWhere(start, setting, assignedUserId) })) {
          throw fail("That time is no longer available. Please choose another.", 409);
        }
        const existing = await tx.b2BLead.findUnique({ where: { email: payload.email } });
        if (existing && await tx.salesAgentAppointment.findFirst({ where: { b2bLeadId: existing.id, status: "CONFIRMED", startTime: { gte: new Date() } } })) {
          throw fail("A meeting is already booked for this email. Please contact the team to change it.", 409);
        }
        const lead = await tx.b2BLead.upsert({
          where: { email: payload.email },
          create: { email: payload.email, companyName: payload.company, contactName: payload.name, phone: payload.phone, source: "WEBSITE_SALES", status: "INTERESTED", marketingOptIn: payload.marketingConsent, marketingConsentAt: payload.marketingConsent ? new Date() : null, emailOptOut: !payload.marketingConsent, smsOptOut: true },
          update: {
            ...(!existing?.companyName ? { companyName: payload.company } : {}),
            ...(!existing?.contactName ? { contactName: payload.name } : {}),
            ...(!existing?.phone ? { phone: payload.phone } : {}),
            ...(["NEW", "CONTACTED"].includes(existing?.status) ? { status: "INTERESTED" } : {}),
            ...(payload.marketingConsent ? { marketingOptIn: true, marketingConsentAt: new Date() } : {}),
          },
        });
        const label = formatSlotLabel(start, setting.timezone);
        await tx.salesAgentAppointment.create({ data: { id, name: payload.name, email: payload.email, phone: payload.phone, preferredTime: label, source: "WEBSITE_SALES", startTime: start, b2bLeadId: lead.id, assignedUserId } });
        await tx.b2BInquiry.create({ data: { id, leadId: lead.id, type: "BOOKING", payload: { ...payload, label, slotDuration: setting.slotDuration }, payloadHash: hash, marketingConsent: payload.marketingConsent, consentText: `${WEBSITE_CONSENT_TEXT}\nMeeting consent: Receive email and SMS confirmations for this booking.` } });
        await tx.b2BEnrollment.updateMany({ where: { leadId: lead.id, status: "ACTIVE" }, data: { status: "EXITED", exitedReason: "APPOINTMENT", nextRunAt: null } });
        return { label, appointmentId: id, created: true };
      }, { isolationLevel: "Serializable" }).then(async (r) => {
        if (r.created) await requestCalendarSync();
        return { label: r.label, appointmentId: r.appointmentId };
      });
    } catch (e) {
      if (attempt < 2 && ["P2034", "P2002"].includes(e.code)) continue;
      if (["P2034", "P2002"].includes(e.code)) throw fail("The booking changed. Please refresh the times and try again.", 409);
      throw e;
    }
  }
}


// Website chat: collects contact details, then books one of the open times.
export const CONSULTATION_FIELDS = [
  ["name", "Please share your name, company, email, and phone number for the consultation."],
  ["company", "What company do you represent?"],
  ["email", "What email address should our team use to contact you?"],
  ["phone", "What +1 phone number should we use?"],
  ["role", "What is your role at the company? You can skip this."],
  ["annualClosings", "Approximately how many homes does your company close each year? You can skip this."],
  ["discussion", "What would you like to discuss during your Product Consultation? You can skip this."],
];

export function isApproval(text) {
  return /^(yes(?: please)?|yes[, ]+(?:please )?(?:submit|send|go ahead|i agree)(?: it| the request)?|i (?:agree|approve|confirm)|confirm|confirmed|please (?:submit|send)(?: it| the request)?|go ahead|sounds good|that(?:'s| is) correct)[.!\s]*$/i.test(text.trim());
}

const US_TIMEZONES = {
  "America/New_York": "Eastern Time",
  "America/Chicago": "Central Time",
  "America/Denver": "Mountain Time",
  "America/Phoenix": "Arizona Time",
  "America/Los_Angeles": "Pacific Time",
  "America/Anchorage": "Alaska Time",
  "Pacific/Honolulu": "Hawaii Time",
};
export const resolveConsultationTimezone = (timezone) => Object.hasOwn(US_TIMEZONES, timezone) ? timezone : "America/New_York";
export const consultationTimezoneLabel = (timezone) => US_TIMEZONES[resolveConsultationTimezone(timezone)];

// Last, the visitor picks one of the open times.
const BOOKING_FIELDS = [...CONSULTATION_FIELDS, ["slot", "Which of these times works for you?"]];

export function nextConsultationField(draft) {
  return BOOKING_FIELDS.find(([key]) => !["role", "annualClosings", "discussion"].includes(key) && !draft[key]);
}

/** The offered time the visitor chose: by its number, or by naming its day and time. */
export function slotChoice(text, offered = []) {
  const value = String(text || "").trim().toLowerCase();
  const number = /^(?:option\s*|#)?(\d{1,2})[.)]?$/.exec(value);
  if (number) return offered[Number(number[1]) - 1] || null;
  const matches = offered.filter((o) => {
    const [day, labelTime] = o.label.toLowerCase().split(" at ");
    const weekday = day.split(",")[0]; // "wed" also matches "wednesday"
    const time = labelTime.replace(/\s+[a-z]{2,5}$/, ""); // drop "EST"
    const compact = time.replace(":00", "").replace(/\s+/g, "");
    return value.includes(weekday) && (value.replace(/\s+/g, "").includes(compact) || value.includes(time));
  });
  return matches.length === 1 ? matches[0] : null;
}

export function slotQuestion(offered, timezone) {
  if (!offered.length) return "There are no open times in the next three weeks. Please email our team and we'll find a time with you.";
  const list = offered.map((o, i) => `${i + 1}. ${o.label}`).join("\n");
  return `Here are the next open times (${consultationTimezoneLabel(timezone)}):\n${list}\n\nReply with the number of the time that suits you.`;
}

export function bookingSummary(draft, minutes) {
  const contact = [["Name", draft.name], ["Company", draft.company], ["Email", draft.email], ["Phone", draft.phone]];
  const lines = contact.map(([key, value]) => key + ": " + value).join("\n");
  return `Please review your Product Consultation:\n${lines}\nMeeting time: ${draft.slotLabel} (${consultationTimezoneLabel(draft.timezone)}, ${minutes} minutes)\n\nMay I book this time and send email and SMS confirmations about it? Message and data rates may apply; reply STOP to opt out of texts. This does not subscribe you to marketing. Reply yes to book it, or tell me what to change.`;
}

// Older PENDING requests (preferred time, no startTime) get a time when the team confirms them.
export async function updatePlatformAppointment(id, status, startTime, setting, db = prisma) {
  const fail = (message, code) => Object.assign(new Error(message), { status: code });
  try {
    return await db.$transaction(async (tx) => {
      const appointment = await tx.salesAgentAppointment.findFirst({ where: { id, source: { in: ["CAMPAIGN", "WEBSITE_SALES"] } } });
      if (!appointment) throw fail("Appointment not found.", 404);
      let start = appointment.startTime;
      let assignedUserId = appointment.assignedUserId;
      if (status === "CONFIRMED") {
        if (startTime !== undefined) {
          if (typeof startTime !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(startTime)) throw fail("Choose a meeting time with a timezone.", 400);
          start = new Date(startTime);
        }
        if (!start || !Number.isFinite(start.getTime())) throw fail("Choose a scheduled meeting time before confirming this request.", 400);
        if ((!appointment.startTime || start.getTime() !== appointment.startTime.getTime()) && start.getTime() <= Date.now()) throw fail("Choose a future meeting time.", 400);
        // Nobody on it yet: give it to whoever is free. If no one's calendar is free, it stays with
        // the whole team (and holds everyone's time) until an admin assigns it.
        if (!assignedUserId) assignedUserId = (await pickAssignee(start, setting, tx)).userId || null;
        const clash = await tx.salesAgentAppointment.findFirst({ where: clashWhere(start, setting, assignedUserId, id) });
        if (clash) throw fail("That time overlaps another meeting. Choose a different time.", 409);
      }
      // A new time needs its own reminder.
      const moved = status === "CONFIRMED" && appointment.startTime?.getTime() !== start.getTime();
      // A legacy Calendly meeting that is cancelled or moved leaves Calendly; a moved one lives on our calendar.
      const leavesCalendly = !!appointment.calendlyEventUri && (status === "CANCELLED" || moved);
      const updated = await tx.salesAgentAppointment.update({ where: { id }, data: { status, ...(status === "CONFIRMED" ? { startTime: start } : {}), ...(moved ? { reminderSentAt: null } : {}), ...(leavesCalendly && moved ? { calendlyEventUri: null } : {}), assignedUserId } });
      return { updated, calendlyEventUri: leavesCalendly ? appointment.calendlyEventUri : null, moved };
    }, { isolationLevel: "Serializable" }).then(async ({ updated, calendlyEventUri, moved }) => {
      await requestCalendarSync();
      // Best effort: frees the old time in Calendly and tells the lead it's off there.
      if (calendlyEventUri) {
        const pointer = await platformCalendlyPointer();
        await cancelCalendlyVisit(pointer?.userId, calendlyEventUri, moved ? "Moved to a new time by the AI4Home team" : "Cancelled from the AI4Home portal");
      }
      return updated;
    });
  } catch (error) {
    if (error.code === "P2034") throw fail("The calendar changed. Please try again.", 409);
    throw error;
  }
}

/** Gives a meeting to a connected team member (or back to the whole team with null). */
export async function setAppointmentAssignee(id, userId, setting, db = prisma) {
  const fail = (message, code) => Object.assign(new Error(message), { status: code });
  try {
    await db.$transaction(async (tx) => {
      const appointment = await tx.salesAgentAppointment.findFirst({ where: { id, source: { in: ["CAMPAIGN", "WEBSITE_SALES"] } } });
      if (!appointment) throw fail("Appointment not found.", 404);
      if (userId) {
        const person = await tx.adminCalendarConnection.findUnique({ where: { userId } });
        if (!person) throw fail("That person hasn't connected a calendar.", 400);
        // Their own calendar isn't checked here: the admin picked them, and the meeting may already be on it.
        if (appointment.startTime && appointment.status !== "CANCELLED" && await tx.salesAgentAppointment.findFirst({ where: clashWhere(appointment.startTime, setting, userId, id) })) {
          throw fail(`${person.userName || "That person"} already has a meeting at that time.`, 409);
        }
      }
      await tx.salesAgentAppointment.update({ where: { id }, data: { assignedUserId: userId || null } });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error.code === "P2034") throw fail("The calendar changed. Please try again.", 409);
    throw error;
  }
  await requestCalendarSync();
}
