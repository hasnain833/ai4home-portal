import prisma from "../lib/prisma.js";
import { triggerAutomation } from "../lib/automation-events.js";
import { writeBackLeadToSalesforce, pushAppointmentToSalesforce } from "../services/salesforce-writeback.js";
import { appointmentTokenData, getOrCreateLeadBookingToken } from "../lib/public-tokens.js";
import { LEAD_STATUS } from "../lib/lead-statuses.js";
import { notifySalesAppointment } from "../services/notification-service.js";
import { getZonedParts } from "../lib/scheduling.js";

const STAFF_SCHEDULE_DEFAULTS = {
  dayStart: "09:00",
  dayEnd: "17:00",
  bufferMinutes: 15,
  workingDays: "Mon,Tue,Wed,Thu,Fri",
  timezone: "America/New_York",
};

function minutesOfDay(value, fallback) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  return Number(match[1]) * 60 + Number(match[2]);
}

function windowsOverlap(start, end, otherStart, otherEnd, bufferMinutes = 0) {
  const bufferMs = bufferMinutes * 60_000;
  return start.getTime() < otherEnd.getTime() + bufferMs && end.getTime() + bufferMs > otherStart.getTime();
}

async function availableStaffForAppointment(appointment, companyId, staffId = null) {
  const staff = await prisma.user.findMany({
    where: {
      companyId,
      role: "STAFF",
      ...(staffId ? { id: staffId } : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      avatar: true,
      staffAvailability: {
        select: {
          dayStart: true,
          dayEnd: true,
          bufferMinutes: true,
          workingDays: true,
          timezone: true,
          isActive: true,
        },
      },
    },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });
  if (!staff.length) return [];

  const companySetting = await prisma.availabilitySetting.findUnique({
    where: { companyId },
    select: { dayStart: true, dayEnd: true, bufferMinutes: true, workingDays: true, timezone: true },
  });
  const start = new Date(appointment.time);
  const end = appointment.endTime
    ? new Date(appointment.endTime)
    : new Date(start.getTime() + (appointment.durationMinutes || 30) * 60_000);
  const staffIds = staff.map((member) => member.id);
  const staffEmails = staff.map((member) => member.email).filter(Boolean);
  const historyFloor = new Date(start.getTime() - 24 * 60 * 60_000);

  const [salesConflicts, ticketConflicts] = await Promise.all([
    prisma.salesAppointment.findMany({
      where: {
        id: { not: appointment.id },
        agentId: { in: staffIds },
        status: { not: "CANCELLED" },
        time: { gte: historyFloor, lt: end },
      },
      select: { agentId: true, time: true, endTime: true, durationMinutes: true },
    }),
    prisma.ticketAppointment.findMany({
      where: {
        companyId,
        status: "SCHEDULED",
        scheduledAt: { gte: historyFloor, lt: end },
        OR: [
          { tradeEmail: { in: staffEmails } },
          { ticket: { assignedStaffId: { in: staffIds } } },
        ],
      },
      select: {
        tradeEmail: true,
        scheduledAt: true,
        durationMinutes: true,
        ticket: { select: { assignedStaffId: true } },
      },
    }),
  ]);

  return staff.filter((member) => {
    const own = member.staffAvailability;
    if (own?.isActive === false) return false;
    const schedule = { ...STAFF_SCHEDULE_DEFAULTS, ...(companySetting || {}), ...(own || {}) };
    const timezone = schedule.timezone || STAFF_SCHEDULE_DEFAULTS.timezone;
    const startParts = getZonedParts(start, timezone);
    const endParts = getZonedParts(end, timezone);
    const workingDays = String(schedule.workingDays || STAFF_SCHEDULE_DEFAULTS.workingDays)
      .split(",")
      .map((day) => day.trim().slice(0, 3).toLowerCase());
    const sameLocalDay =
      startParts.year === endParts.year && startParts.month === endParts.month && startParts.day === endParts.day;
    const startMinute = startParts.hour * 60 + startParts.minute;
    const endMinute = endParts.hour * 60 + endParts.minute;
    const withinWorkingHours =
      sameLocalDay &&
      workingDays.includes(startParts.weekday.slice(0, 3).toLowerCase()) &&
      startMinute >= minutesOfDay(schedule.dayStart, 9 * 60) &&
      endMinute <= minutesOfDay(schedule.dayEnd, 17 * 60);
    if (!withinWorkingHours) return false;

    const buffer = Number(schedule.bufferMinutes) || 0;
    const hasSalesConflict = salesConflicts.some((conflict) => {
      if (conflict.agentId !== member.id) return false;
      const conflictEnd = conflict.endTime || new Date(conflict.time.getTime() + (conflict.durationMinutes || 30) * 60_000);
      return windowsOverlap(start, end, conflict.time, conflictEnd, buffer);
    });
    if (hasSalesConflict) return false;

    return !ticketConflicts.some((conflict) => {
      const belongsToStaff =
        conflict.ticket?.assignedStaffId === member.id ||
        (conflict.tradeEmail && conflict.tradeEmail.toLowerCase() === member.email.toLowerCase());
      if (!belongsToStaff) return false;
      const conflictEnd = new Date(conflict.scheduledAt.getTime() + (conflict.durationMinutes || 60) * 60_000);
      return windowsOverlap(start, end, conflict.scheduledAt, conflictEnd, buffer);
    });
  });
}

export const getAppointments = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const companyId = req.user.companyId;
    const isHomeowner =
      String(req.user.role || "").toUpperCase() === "HOMEOWNER";

    const appointments = await prisma.salesAppointment.findMany({
      where: {
        lead: { companyId, ...(isHomeowner ? { ownerId: req.user.id } : {}) },
      },
      include: {
        lead: {
          select: { firstName: true, lastName: true, email: true, phone: true },
        },
        agent: {
          select: { name: true, email: true },
        },
      },
      orderBy: { time: "asc" },
    });

    return res.json(appointments);
  } catch (error) {
    console.error("[Appointments GET] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getAvailableAppointmentStaff = async (req, res) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ message: "No company associated" });

    const appointment = await prisma.salesAppointment.findFirst({
      where: { id: req.params.id, lead: { companyId } },
      select: {
        id: true,
        title: true,
        time: true,
        endTime: true,
        durationMinutes: true,
        status: true,
        agentId: true,
      },
    });
    if (!appointment) return res.status(404).json({ message: "Appointment not found" });
    if (appointment.status === "CANCELLED") {
      return res.status(400).json({ message: "A cancelled appointment cannot be assigned." });
    }

    const staff = await availableStaffForAppointment(appointment, companyId);
    return res.json({ appointment, staff });
  } catch (error) {
    console.error("[Appointment Staff Availability] Error:", error);
    return res.status(500).json({ message: "Could not load available staff" });
  }
};

export const assignAppointmentStaff = async (req, res) => {
  try {
    const companyId = req.user?.companyId;
    const staffId = String(req.body?.staffId || "").trim();
    if (!companyId) return res.status(403).json({ message: "No company associated" });
    if (!staffId) return res.status(400).json({ message: "Please choose a staff member." });

    const appointment = await prisma.salesAppointment.findFirst({
      where: { id: req.params.id, lead: { companyId } },
      include: { lead: { include: { company: true } } },
    });
    if (!appointment) return res.status(404).json({ message: "Appointment not found" });
    if (appointment.status === "CANCELLED") {
      return res.status(400).json({ message: "A cancelled appointment cannot be assigned." });
    }

    const available = await availableStaffForAppointment(appointment, companyId, staffId);
    if (!available.length) {
      return res.status(409).json({ message: "That staff member is no longer available at this appointment time." });
    }

    const updated = await prisma.salesAppointment.update({
      where: { id: appointment.id },
      data: { agentId: staffId },
      include: {
        agent: { select: { id: true, name: true, email: true, role: true } },
        lead: { include: { company: true } },
      },
    });
    await notifySalesAppointment("ASSIGNED", updated, { assignedOnly: true });
    return res.json(updated);
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({ message: "That staff member was just booked for this time." });
    }
    console.error("[Appointment Staff Assignment] Error:", error);
    return res.status(500).json({ message: "Could not assign staff" });
  }
};

export const bookAppointment = async (req, res) => {
  try {
    const { leadId, title, time, agentId } = req.body;
    const companyId = req.user?.companyId;

    if (!leadId || !title || !time) {
      return res
        .status(400)
        .json({ message: "Missing required fields: leadId, title, time" });
    }
    if (!companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const lead = await prisma.lead.findFirst({
      where: { id: leadId, companyId },
    });
    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    let assignedAgentId = agentId;
    if (!assignedAgentId) {
      if (lead?.ownerId) {
        assignedAgentId = lead.ownerId;
      } else {
        const company = await prisma.company.findUnique({
          where: { id: lead.companyId },
          include: { users: true },
        });
        const fallback =
          company?.defaultLeadOwner ||
          company?.users.find((u) => u.role === "ADMIN")?.id;
        if (!fallback) {
          return res
            .status(400)
            .json({ message: "No agent available to assign appointment." });
        }
        assignedAgentId = fallback;
      }
    }

    const assignedAgent = await prisma.user.findFirst({
      where: { id: assignedAgentId, companyId },
      select: { id: true },
    });
    if (!assignedAgent) {
      return res.status(400).json({ message: "Assigned agent is not available for this company." });
    }

    const appointment = await prisma.salesAppointment.create({
      data: {
        leadId,
        title,
        time: new Date(time),
        agentId: assignedAgentId,
        status: "CONFIRMED",
        locationType: "ONSITE",
        ...appointmentTokenData(),
      },
    });

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        status: LEAD_STATUS.APPOINTMENT_SET,
      },
    });

    const { inngest } = await import("../lib/inngest.js");
    await inngest.send({
      name: "campaign.exit",
      data: {
        leadId,
        reason: "APPOINTMENT",
      },
    });

    const apptLead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { companyId: true },
    });
    if (apptLead?.companyId) {
      await triggerAutomation({
        companyId: apptLead.companyId,
        leadId,
        event: "APPOINTMENT_BOOKED",
        context: { appointmentId: appointment.id, bookedVia: "CTA" },
      });
      pushAppointmentToSalesforce(appointment.id)
        .then(() => writeBackLeadToSalesforce(apptLead.companyId, leadId, {
          status: LEAD_STATUS.APPOINTMENT_SET,
        }))
        .catch((e) =>
        console.error(
          "[Appointment Book] Salesforce write-back failed:",
          e?.message || e,
        ),
      );
    }

    await notifySalesAppointment("BOOKED", { ...appointment, bookedVia: "STAFF" });

    return res.status(201).json(appointment);
  } catch (error) {
    console.error("[Appointment Book] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getSlots = async (req, res) => {
  try {
    if (!req.user?.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }
    const { date } = req.query;
    const queryDate = date ? new Date(date) : new Date();
    const slots = [];
    const baseHour = 9;
    for (let i = 0; i < 8; i++) {
      const hour = baseHour + i;
      const timeString = `${hour.toString().padStart(2, "0")}:00`;
      slots.push({
        time: timeString,
        available: true,
        dateTimeString: new Date(
          queryDate.setHours(hour, 0, 0, 0),
        ).toISOString(),
      });
    }

    return res.json(slots);
  } catch (error) {
    console.error("[Get Slots] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const triggerCta = async (req, res) => {
  try {
    const { leadId } = req.body;
    const companyId = req.user?.companyId;

    if (!leadId) {
      return res.status(400).json({ message: "leadId is required" });
    }
    if (!companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const lead = await prisma.lead.findFirst({
      where: { id: leadId, companyId },
    });

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    const bookingToken = await getOrCreateLeadBookingToken(leadId);

    return res.json({
      success: true,
      message: "CTA click recorded",
      bookingUrl: `${process.env.NEXT_PUBLIC_URL || ""}/book/${bookingToken}`,
    });
  } catch (error) {
    console.error("[CTA Trigger] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
