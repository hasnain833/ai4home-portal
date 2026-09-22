import prisma from "../lib/prisma.js";
import { computeAvailableSlots, formatSlotLabel } from "../lib/scheduling.js";

// How far ahead a homeowner may book, and how soon. The lead time stops someone
// grabbing a slot the assigned staff member has no chance of reaching.
export const BOOKING_HORIZON_DAYS = 21;
export const MIN_LEAD_MINUTES = 120;
export const MAX_SLOTS = 60;

const COMPANY_DEFAULTS = {
  dayStart: "09:00",
  dayEnd: "17:00",
  bufferMinutes: 15,
  slotDuration: 60,
  workingDays: "Mon,Tue,Wed,Thu,Fri",
  timezone: "America/New_York",
};

/**
 * The working hours to offer on behalf of one staff member.
 *
 * A staff member only needs a StaffAvailability row if their hours differ from
 * the company's — without one they inherit the company setting, so adding a new
 * staff member does not require configuring them before they can be booked.
 */
export async function availabilityForStaff(staffId, companyId) {
  const [own, company] = await Promise.all([
    staffId
      ? prisma.staffAvailability.findUnique({ where: { userId: staffId } }).catch(() => null)
      : null,
    companyId
      ? prisma.availabilitySetting.findUnique({ where: { companyId } }).catch(() => null)
      : null,
  ]);

  const base = { ...COMPANY_DEFAULTS, ...(company || {}) };
  if (!own || own.isActive === false) return base;

  return {
    ...base,
    dayStart: own.dayStart || base.dayStart,
    dayEnd: own.dayEnd || base.dayEnd,
    bufferMinutes: own.bufferMinutes ?? base.bufferMinutes,
    slotDuration: own.slotDuration ?? base.slotDuration,
    workingDays: own.workingDays || base.workingDays,
    // Null on the staff row means "whatever the company runs on".
    timezone: own.timezone || base.timezone,
  };
}

/**
 * Everything already on this staff member's plate, as busy intervals.
 *
 * Deliberately not company-wide: two staff members can be at two houses at the
 * same time. Sales appointments count too, because the same person can be both
 * an agent and a repair contact.
 */
async function busyFor(staffId, staffEmail, from, to) {
  const busy = [];

  // Repair visits are linked to the staff member by email, which is what the
  // appointment row carries (tradeEmail), plus the ticket's assignee.
  const visits = await prisma.ticketAppointment.findMany({
    where: {
      status: "SCHEDULED",
      scheduledAt: { gte: from, lte: to },
      OR: [
        ...(staffEmail ? [{ tradeEmail: staffEmail }] : []),
        { ticket: { assignedStaffId: staffId } },
      ],
    },
    select: { scheduledAt: true, durationMinutes: true },
  });
  for (const v of visits) {
    busy.push({
      start: v.scheduledAt,
      end: new Date(v.scheduledAt.getTime() + (v.durationMinutes || 60) * 60000),
    });
  }

  const salesAppts = await prisma.salesAppointment
    .findMany({
      where: { agentId: staffId, status: { not: "CANCELLED" }, time: { gte: from, lte: to } },
      select: { time: true, endTime: true, durationMinutes: true },
    })
    .catch(() => []);
  for (const a of salesAppts) {
    busy.push({
      start: a.time,
      end: a.endTime || new Date(a.time.getTime() + (a.durationMinutes || 30) * 60000),
    });
  }

  return busy;
}

/**
 * The slots a homeowner may choose from for one staff member.
 * `excludeAppointmentId` lets a reschedule ignore the visit being moved, so its
 * own current time is still offered.
 */
export async function slotsForStaff({
  staffId,
  staffEmail,
  companyId,
  days = BOOKING_HORIZON_DAYS,
  limit = MAX_SLOTS,
  excludeAppointmentId = null,
}) {
  const setting = await availabilityForStaff(staffId, companyId);
  const from = new Date(Date.now() + MIN_LEAD_MINUTES * 60000);
  const to = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);

  let busy = await busyFor(staffId, staffEmail, from, to);

  if (excludeAppointmentId) {
    const current = await prisma.ticketAppointment.findUnique({
      where: { id: excludeAppointmentId },
      select: { scheduledAt: true, durationMinutes: true },
    });
    if (current) {
      const startMs = current.scheduledAt.getTime();
      busy = busy.filter((b) => b.start.getTime() !== startMs);
    }
  }

  const slots = computeAvailableSlots({ setting, from, days, busy, limit });
  return {
    timezone: setting.timezone,
    slotDuration: setting.slotDuration,
    slots: slots.map((s) => ({
      iso: s.toISOString(),
      label: formatSlotLabel(s, setting.timezone),
    })),
  };
}

/**
 * Whether a specific time is still free for this staff member. Two homeowners
 * can be on the booking page at once, so the slot is checked again at the
 * moment of booking rather than trusted from the page that offered it.
 */
export async function isSlotBookable({
  staffId,
  staffEmail,
  companyId,
  startTime,
  excludeAppointmentId = null,
}) {
  const when = new Date(startTime);
  if (Number.isNaN(when.getTime())) return { ok: false, reason: "That is not a valid time." };
  if (when.getTime() < Date.now() + MIN_LEAD_MINUTES * 60000) {
    return { ok: false, reason: "That time is too soon. Please choose a later slot." };
  }

  const { slots, slotDuration, timezone } = await slotsForStaff({
    staffId,
    staffEmail,
    companyId,
    limit: 500,
    excludeAppointmentId,
  });

  const match = slots.find((s) => s.iso === when.toISOString());
  if (!match) {
    return { ok: false, reason: "That slot has just been taken. Please pick another." };
  }
  return { ok: true, slotDuration, timezone };
}
