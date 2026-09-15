import prisma from "../lib/prisma.js";
import {
  notifyAppointmentScheduled,
  notifyAppointmentCancelled,
} from "../services/ticket-appointment-service.js";

const BOOKING_ROLES = ["ADMIN", "STAFF"];

const NOT_CONFIGURED_NOTICE =
  "Saved, and visible in the portal, but no email was sent: email is not configured " +
  "for this workspace. Add your SMTP credentials in Settings > Email, SMS & News.";


async function accessibleTicket(session, ticketId) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { homeowner: { select: { companyId: true } } },
  });
  if (!ticket) return null;

  const ticketCompany = ticket.companyId || ticket.homeowner?.companyId || null;
  if (session.role === "HOMEOWNER") {
    return ticket.homeownerId === session.id ? ticket : null;
  }
  return ticketCompany && ticketCompany === session.companyId ? ticket : null;
}

export const listAppointments = async (req, res) => {
  try {
    const session = req.user;
    if (!session) return res.status(401).json({ message: "Unauthorized" });

    const { ticketId } = req.query;
    if (!ticketId) return res.status(400).json({ message: "ticketId is required" });

    const ticket = await accessibleTicket(session, ticketId);
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });

    const appointments = await prisma.ticketAppointment.findMany({
      where: { ticketId },
      orderBy: { scheduledAt: "asc" },
      include: { homeowner: { select: { name: true, email: true } } },
    });

    return res.json(appointments);
  } catch (error) {
    console.error("[Appointments] Failed to list:", error);
    return res.status(500).json({ message: "Failed to fetch appointments" });
  }
};

export const createAppointment = async (req, res) => {
  try {
    const session = req.user;
    if (!session) return res.status(401).json({ message: "Unauthorized" });
    if (!BOOKING_ROLES.includes(session.role)) {
      return res.status(403).json({ message: "Only staff and admins can schedule appointments" });
    }

    const { ticketId, scheduledAt, durationMinutes, tradeName, tradeEmail, location, notes } =
      req.body;

    if (!ticketId || !scheduledAt) {
      return res.status(400).json({ message: "ticketId and scheduledAt are required" });
    }

    const when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime())) {
      return res.status(400).json({ message: "scheduledAt is not a valid date" });
    }
    if (when.getTime() <= Date.now()) {
      return res.status(400).json({ message: "scheduledAt must be in the future" });
    }

    const ticket = await accessibleTicket(session, ticketId);
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });

    const companyId = ticket.companyId || ticket.homeowner?.companyId;
    if (!companyId) {
      return res.status(400).json({ message: "Ticket is not linked to a company" });
    }

    const appointment = await prisma.ticketAppointment.create({
      data: {
        ticketId,
        companyId,
        homeownerId: ticket.homeownerId,
        scheduledAt: when,
        durationMinutes: Number(durationMinutes) || 60,
        tradeName: tradeName?.trim() || null,
        tradeEmail: tradeEmail?.trim() || null,
        location: location?.trim() || null,
        notes: notes?.trim() || null,
        createdById: session.id,
      },
    });

    const result = await notifyAppointmentScheduled(appointment.id);
    const notice = result.emailConfigured === false ? NOT_CONFIGURED_NOTICE : null;

    return res.status(201).json(notice ? { ...appointment, notice } : appointment);
  } catch (error) {
    console.error("[Appointments] Failed to create:", error);
    return res.status(500).json({ message: "Failed to schedule appointment" });
  }
};

export const updateAppointment = async (req, res) => {
  try {
    const session = req.user;
    if (!session) return res.status(401).json({ message: "Unauthorized" });
    if (!BOOKING_ROLES.includes(session.role)) {
      return res.status(403).json({ message: "Only staff and admins can change appointments" });
    }

    const existing = await prisma.ticketAppointment.findUnique({
      where: { id: req.params.id },
    });
    if (!existing || existing.companyId !== session.companyId) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    const { scheduledAt, durationMinutes, status, tradeName, tradeEmail, location, notes } =
      req.body;
    const data = {};

    if (scheduledAt !== undefined) {
      const when = new Date(scheduledAt);
      if (Number.isNaN(when.getTime())) {
        return res.status(400).json({ message: "scheduledAt is not a valid date" });
      }
      if (when.getTime() <= Date.now()) {
        return res.status(400).json({ message: "scheduledAt must be in the future" });
      }
      data.scheduledAt = when;
      // A new time deserves a fresh set of reminders.
      data.reminder24Sent = false;
      data.reminder1Sent = false;
    }

    if (status !== undefined) {
      if (!["SCHEDULED", "COMPLETED", "CANCELLED"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      data.status = status;
    }
    if (durationMinutes !== undefined) data.durationMinutes = Number(durationMinutes) || 60;
    if (tradeName !== undefined) data.tradeName = tradeName?.trim() || null;
    if (tradeEmail !== undefined) data.tradeEmail = tradeEmail?.trim() || null;
    if (location !== undefined) data.location = location?.trim() || null;
    if (notes !== undefined) data.notes = notes?.trim() || null;

    const appointment = await prisma.ticketAppointment.update({
      where: { id: existing.id },
      data,
    });

    let result = { emailConfigured: true };
    const nowCancelled = status === "CANCELLED" && existing.status !== "CANCELLED";
    const rescheduled = data.scheduledAt && appointment.status === "SCHEDULED";

    if (nowCancelled) result = await notifyAppointmentCancelled(appointment.id);
    else if (rescheduled) result = await notifyAppointmentScheduled(appointment.id);

    const notice = result.emailConfigured === false ? NOT_CONFIGURED_NOTICE : null;
    return res.json(notice ? { ...appointment, notice } : appointment);
  } catch (error) {
    console.error("[Appointments] Failed to update:", error);
    return res.status(500).json({ message: "Failed to update appointment" });
  }
};
