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
