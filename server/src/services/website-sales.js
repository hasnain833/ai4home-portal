import prisma from "../lib/prisma.js";
import { getB2BAvailability } from "../lib/b2b.js";
import { computeAvailableSlots, formatSlotLabel } from "../lib/scheduling.js";
import { parseWebsiteInquiry, inquiryHash, WEBSITE_CONSENT_TEXT } from "../lib/website-inquiry.js";

export const MEETING_SOURCES = ["CAMPAIGN", "WEBSITE_SALES"];
export async function getPlatformSlots(setting, db = prisma) {
  const from = new Date(Date.now() + 60 * 60_000);
  const taken = await db.salesAgentAppointment.findMany({
    where: { status: { not: "CANCELLED" }, startTime: { gte: new Date(from.getTime() - 86_400_000), lte: new Date(from.getTime() + 21 * 86_400_000) } },
    select: { startTime: true },
  });
  const gap = setting.bufferMinutes * 60_000;
  const busy = taken.map((a) => ({ start: new Date(a.startTime.getTime() - gap), end: new Date(a.startTime.getTime() + setting.slotDuration * 60_000 + gap) }));
  return computeAvailableSlots({ setting, from, days: 21, busy, limit: 200 });
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
        await tx.salesAgentAppointment.create({ data: { id, name: payload.name, email: payload.email, phone: payload.phone, preferredTime: label, source: "WEBSITE_SALES", startTime: start, b2bLeadId: lead.id } });
        await tx.b2BInquiry.create({ data: { id, leadId: lead.id, type: "BOOKING", payload: { ...payload, label, slotDuration: setting.slotDuration }, payloadHash: hash, marketingConsent: payload.marketingConsent, consentText: `${WEBSITE_CONSENT_TEXT}\nMeeting consent: Receive email and SMS confirmations for this booking.` } });
        await tx.b2BEnrollment.updateMany({ where: { leadId: lead.id, status: "ACTIVE" }, data: { status: "EXITED", exitedReason: "APPOINTMENT", nextRunAt: null } });
        return { label, appointmentId: id };
      }, { isolationLevel: "Serializable" });
    } catch (e) {
      if (attempt < 2 && ["P2034", "P2002"].includes(e.code)) continue;
      if (["P2034", "P2002"].includes(e.code)) throw fail("The booking changed. Please refresh the times and try again.", 409);
      throw e;
    }
  }
}


// Conversational consultation collection and pending requests.
export const CONSULTATION_FIELDS = [
  ["name", "Please share your name, company, email, and phone number for the consultation."],
  ["company", "What company do you represent?"],
  ["email", "What email address should our team use to contact you?"],
  ["phone", "What phone number should we use? Please include your country code."],
  ["role", "What is your role at the company? You can skip this."],
  ["annualClosings", "Approximately how many homes does your company close each year? You can skip this."],
  ["discussion", "What would you like to discuss during your Product Consultation? You can skip this."],
  ["preferredDate", "What day and time would work for your consultation?"],
  ["preferredTime", "What time would you prefer? Please include AM or PM, or use 24-hour time."],
];

export function isApproval(text) {
  return /^(yes(?: please)?|yes[, ]+(?:please )?(?:submit|send|go ahead|i agree)(?: it| the request)?|i (?:agree|approve|confirm)|confirm|confirmed|please (?:submit|send)(?: it| the request)?|go ahead|sounds good|that(?:'s| is) correct)[.!\s]*$/i.test(text.trim());
}

const US_TIMEZONES = {
  "America/New_York": "US Eastern Time",
  "America/Chicago": "US Central Time",
  "America/Denver": "US Mountain Time",
  "America/Phoenix": "Arizona Time",
  "America/Los_Angeles": "US Pacific Time",
  "America/Anchorage": "Alaska Time",
  "Pacific/Honolulu": "Hawaii Time",
};
export const resolveConsultationTimezone = (timezone) => Object.hasOwn(US_TIMEZONES, timezone) ? timezone : "America/New_York";
export const consultationTimezoneLabel = (timezone) => US_TIMEZONES[resolveConsultationTimezone(timezone)];

export function nextConsultationField(draft) {
  return CONSULTATION_FIELDS.find(([key]) => !["role", "annualClosings", "discussion"].includes(key) && !draft[key]);
}

function localCalendarDate(now, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: resolveConsultationTimezone(timezone), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
}

export function normalizeConsultationDate(input, timezone = "America/New_York", now = new Date()) {
  const value = String(input || "").trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/,/g, "").replace(/\s+/g, " ");
  const today = localCalendarDate(now, timezone);
  let year, month, day;
  const relative = { today: 0, tomorrow: 1, "day after tomorrow": 2 };
  if (Object.hasOwn(relative, value)) {
    const date = new Date(today.getTime() + relative[value] * 86400000);
    return date.toISOString().slice(0, 10);
  }
  const weekday = /^(?:(next|this|on) )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(value);
  if (weekday) {
    let offset = (["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(weekday[2]) - today.getUTCDay() + 7) % 7;
    if (weekday[1] === "next" && offset === 0) offset = 7;
    return new Date(today.getTime() + offset * 86400000).toISOString().slice(0, 10);
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const named = /^(?:([a-z]+)\s+(\d{1,2})|(\d{1,2})\s+([a-z]+))(?:\s+(\d{2}|\d{4}))?$/.exec(value);
  const numeric = /^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2}|\d{4}))?$/.exec(value);
  let inferredYear = false;
  if (iso) { year = +iso[1]; month = +iso[2] - 1; day = +iso[3]; }
  else if (named) {
    month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf((named[1] || named[4]).slice(0, 3));
    day = +(named[2] || named[3]); year = named[5] ? +named[5] : today.getUTCFullYear(); inferredYear = !named[5];
  } else if (numeric) {
    month = +numeric[1] - 1; day = +numeric[2]; year = numeric[3] ? +numeric[3] : today.getUTCFullYear(); inferredYear = !numeric[3];
  } else return null;
  if (year < 100) year += 2000;
  let date = new Date(Date.UTC(year, month, day));
  if (month < 0 || month > 11 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  if (inferredYear && date < today) {
    year++; date = new Date(Date.UTC(year, month, day));
    if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  }
  return date.toISOString().slice(0, 10);
}

export function normalizeConsultationTime(input) {
  const value = String(input || "").trim().toLowerCase();
  if (value === "noon") return "12:00 PM";
  if (value === "midnight") return "12:00 AM";
  const match = /^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?$/.exec(value);
  if (!match) return null;
  let hour = +match[1]; const minute = match[2] || "00";
  if (match[3]) {
    if (hour < 1 || hour > 12) return null;
    return hour + ":" + minute + " " + match[3].toUpperCase();
  }
  if (!match[2] || hour > 23) return null;
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return hour + ":" + minute + " " + suffix;
}

export function preferenceError(draft, now = new Date()) {
  if (draft.preferredDate) {
    const date = normalizeConsultationDate(draft.preferredDate, draft.timezone, now);
    if (!date) return { field: "preferredDate", message: "What day would you prefer? You can say November 5 or tomorrow." };
    if (new Date(date + "T00:00:00Z") < localCalendarDate(now, draft.timezone)) return { field: "preferredDate", message: "That date has passed. What upcoming day works for you?" };
  }
  if (draft.preferredTime && !normalizeConsultationTime(draft.preferredTime)) return { field: "preferredTime", message: "What time works for you? For example, 12 PM or 15:00." };
  return null;
}

export function consultationPreferenceLabel(draft) {
  const date = normalizeConsultationDate(draft.preferredDate, draft.timezone);
  const label = date ? new Intl.DateTimeFormat("en-US", {dateStyle: "long", timeZone: "UTC"}).format(new Date(date + "T12:00:00Z")) : draft.preferredDate;
  return label + " at " + (normalizeConsultationTime(draft.preferredTime) || draft.preferredTime) + " (" + consultationTimezoneLabel(draft.timezone) + ")";
}

export function consultationSummary(draft) {
  const contact = [["Name", draft.name], ["Company", draft.company], ["Email", draft.email], ["Phone", draft.phone]];
  return "Please review your Product Consultation request:\n" + contact.map(([key, value]) => key + ": " + value).join("\n") + "\nPreferred time: " + consultationPreferenceLabel(draft) + "\n\nOur team still needs to confirm availability. May I submit this request and send email and SMS updates about it? Message and data rates may apply; reply STOP to opt out of texts. This does not subscribe you to marketing. Reply yes to agree, or tell me what to change.";
}

export async function saveConsultation(id, draft, page, db = prisma) {
  if (!Object.hasOwn(US_TIMEZONES, draft.timezone)) throw Object.assign(new Error("Consultations use the team's US timezone."), { status: 400 });
  draft = { ...draft, preferredDate: normalizeConsultationDate(draft.preferredDate, draft.timezone) || draft.preferredDate, preferredTime: normalizeConsultationTime(draft.preferredTime) || draft.preferredTime };
  const invalid = preferenceError(draft);
  if (invalid) throw Object.assign(new Error(invalid.message), { status: 400 });
  const payload = parseWebsiteInquiry({ type: "DEMO", name: draft.name, company: draft.company, email: draft.email, phone: draft.phone, role: draft.role, annualClosings: draft.annualClosings, notes: draft.discussion, page, marketingConsent: false });
  if (!payload.phone) throw Object.assign(new Error("A valid phone number is required."), { status: 400 });
  for (const key of ["preferredDate", "preferredTime", "timezone"]) {
    if (typeof draft[key] !== "string" || !draft[key].trim() || draft[key].length > 160) throw Object.assign(new Error(`Please provide your ${key}.`), { status: 400 });
  }
  Object.assign(payload, { type: "CONSULTATION", preferredDate: draft.preferredDate, preferredTime: draft.preferredTime, timezone: draft.timezone, label: consultationPreferenceLabel(draft), meetingConsent: true });
  const payloadHash = inquiryHash(payload);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const prior = await tx.b2BInquiry.findUnique({ where: { id } });
        if (prior) {
          if (prior.type !== "CONSULTATION" || prior.payloadHash !== payloadHash) throw Object.assign(new Error("Request ID already used for different details. Please start a new conversation."), { status: 409 });
          return prior;
        }
        const recent = await tx.b2BInquiry.count({ where: { type: "CONSULTATION", createdAt: { gte: new Date(Date.now() - 600000) }, OR: [{ payload: { path: ["email"], equals: payload.email } }, { payload: { path: ["phone"], equals: payload.phone } }] } });
        if (recent >= 3) throw Object.assign(new Error("Too many consultation requests for these contact details. Please try again later."), { status: 429 });
        const existing = await tx.b2BLead.findUnique({ where: { email: payload.email } });
        const lead = await tx.b2BLead.upsert({ where: { email: payload.email }, create: { email: payload.email, contactName: payload.name, companyName: payload.company, phone: payload.phone, source: "WEBSITE_SALES", status: "INTERESTED", marketingOptIn: false, emailOptOut: true, smsOptOut: true }, update: {
          ...(!existing?.contactName ? { contactName: payload.name } : {}), ...(!existing?.companyName ? { companyName: payload.company } : {}), ...(!existing?.phone ? { phone: payload.phone } : {}), ...(["NEW", "CONTACTED"].includes(existing?.status) ? { status: "INTERESTED" } : {}),
        } });
        // Preferences do not reserve time on the calendar.
        await tx.salesAgentAppointment.create({ data: { id, name: payload.name, email: payload.email, phone: payload.phone, preferredTime: payload.label, status: "PENDING", source: "WEBSITE_SALES", b2bLeadId: lead.id } });
        const inquiry = await tx.b2BInquiry.create({ data: { id, leadId: lead.id, type: "CONSULTATION", payload, payloadHash, marketingConsent: false, consentText: "Visitor approved the consultation summary and email/SMS updates. Preferred time pending team confirmation. No marketing subscription." } });
        await tx.b2BEnrollment.updateMany({ where: { leadId: lead.id, status: "ACTIVE" }, data: { status: "EXITED", exitedReason: "CONSULTATION_REQUEST", nextRunAt: null } });
        await tx.b2BCampaign.updateMany({
          where: { status: "ACTIVE", enrollments: { some: { leadId: lead.id }, none: { status: "ACTIVE" } } },
          data: { status: "COMPLETED" },
        });
        return inquiry;
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (attempt < 2 && ["P2002", "P2034"].includes(error.code)) continue;
      throw error;
    }
  }
}

// A preferred time is free text. Only an explicit scheduled instant can reserve a slot.
export async function updatePlatformAppointment(id, status, startTime, setting, db = prisma) {
  const fail = (message, code) => Object.assign(new Error(message), { status: code });
  try {
    return await db.$transaction(async (tx) => {
      const appointment = await tx.salesAgentAppointment.findFirst({ where: { id, source: { in: ["CAMPAIGN", "WEBSITE_SALES"] } } });
      if (!appointment) throw fail("Appointment not found.", 404);
      let start = appointment.startTime;
      if (status === "CONFIRMED") {
        if (startTime !== undefined) {
          if (typeof startTime !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(startTime)) throw fail("Choose a meeting time with a timezone.", 400);
          start = new Date(startTime);
        }
        if (!start || !Number.isFinite(start.getTime())) throw fail("Choose a scheduled meeting time before confirming this request.", 400);
        if ((!appointment.startTime || start.getTime() !== appointment.startTime.getTime()) && start.getTime() <= Date.now()) throw fail("Choose a future meeting time.", 400);
        const gap = setting.bufferMinutes * 60000;
        const duration = setting.slotDuration * 60000;
        const clash = await tx.salesAgentAppointment.findFirst({ where: {
          id: { not: id }, status: { not: "CANCELLED" },
          startTime: { gt: new Date(start.getTime() - duration - gap), lt: new Date(start.getTime() + duration + gap) },
        } });
        if (clash) throw fail("That time overlaps another meeting. Choose a different time.", 409);
      }
      return tx.salesAgentAppointment.update({ where: { id }, data: { status, ...(status === "CONFIRMED" ? { startTime: start } : {}) } });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error.code === "P2034") throw fail("The calendar changed. Please try again.", 409);
    throw error;
  }
}
