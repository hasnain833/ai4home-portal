import prisma from "../lib/prisma.js";
import { computeAvailableSlots, formatSlotLabel } from "../lib/scheduling.js";
import { calendlyAvailableTimes, calendlyBookingFor, calendlyBusyFor } from "./calendly.service.js";

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


export async function availabilityForStaff(staffId, companyId, db = prisma) {
  const [own, company] = await Promise.all([
    staffId
      ? db.staffAvailability.findUnique({ where: { userId: staffId } }).catch(() => null)
      : null,
    companyId
      ? db.availabilitySetting.findUnique({ where: { companyId } }).catch(() => null)
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

async function busyFor(staffId, staffEmail, from, to, db = prisma, { withCalendly = true } = {}) {
  // ponytail: unassigned visits don't block each other, so two homeowners can pick
  // the same company slot; add a per-company capacity if builders need it.
  if (!staffId) return [];
  const busy = [];

  const visits = await db.ticketAppointment.findMany({
    where: {
      status: "SCHEDULED",
      scheduledAt: { gte: from, lte: to },
      OR: [
        ...(staffEmail ? [{ tradeEmail: staffEmail }] : []),
        { ticket: { assignedStaffId: staffId } },
      ],
    },
    select: { id: true, scheduledAt: true, durationMinutes: true },
  });
  for (const v of visits) {
    busy.push({
      appointmentId: v.id,
      start: v.scheduledAt,
      end: new Date(v.scheduledAt.getTime() + (v.durationMinutes || 60) * 60000),
    });
  }

  const salesAppts = await db.salesAppointment
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

  // Busy in their linked Calendly (trades connect it from their portal).
  if (withCalendly) busy.push(...(await calendlyBusyFor(staffId, from, to)));

  return busy;
}

/**
 * Open times from the trade's Calendly event type, minus portal visits they
 * already have (some may predate the Calendly link). Calendly unreachable:
 * no times rather than times the trade may not be free for.
 */
async function calendlySlots({ calendly, staffId, staffEmail, from, to, limit, excludeAppointmentId, setting, db }) {
  const slotDuration = calendly.eventDuration || setting.slotDuration;
  let times = [];
  try {
    times = await calendlyAvailableTimes(calendly, from, to);
  } catch (err) {
    console.error(`[Scheduling] Calendly times unavailable for ${staffId}:`, err.message);
  }
  const busy = (await busyFor(staffId, staffEmail, from, to, db, { withCalendly: false })).filter(
    (b) => !excludeAppointmentId || b.appointmentId !== excludeAppointmentId,
  );
  const open = times.filter((t) => {
    const end = t.getTime() + slotDuration * 60000;
    return !busy.some((b) => t.getTime() < b.end.getTime() && end > b.start.getTime());
  });
  return {
    timezone: setting.timezone,
    slotDuration,
    viaCalendly: true,
    slots: open.slice(0, limit).map((s) => ({ iso: s.toISOString(), label: formatSlotLabel(s, setting.timezone) })),
  };
}

export async function slotsForStaff({
  staffId,
  staffEmail,
  companyId,
  days = BOOKING_HORIZON_DAYS,
  limit = MAX_SLOTS,
  excludeAppointmentId = null,
  db = prisma,
}) {
  const setting = await availabilityForStaff(staffId, companyId, db);
  const from = new Date(Date.now() + MIN_LEAD_MINUTES * 60000);
  const to = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);

  // A trade with a Calendly event type is booked from its real open times.
  const calendly = await calendlyBookingFor(staffId);
  if (calendly) {
    return calendlySlots({ calendly, staffId, staffEmail, from, to, limit, excludeAppointmentId, setting, db });
  }

  let busy = await busyFor(staffId, staffEmail, from, to, db);

  if (excludeAppointmentId) {
    const current = await db.ticketAppointment.findUnique({
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


export async function isSlotBookable({
  staffId,
  staffEmail,
  companyId,
  startTime,
  excludeAppointmentId = null,
  db = prisma,
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
    db,
  });

  const match = slots.find((s) => s.iso === when.toISOString());
  if (!match) {
    return { ok: false, reason: "That slot has just been taken. Please pick another." };
  }
  return { ok: true, slotDuration, timezone };
}
