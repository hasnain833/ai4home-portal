import { randomUUID } from "node:crypto";
import prisma from "../lib/prisma.js";
import { slotsForStaff, isSlotBookable } from "../services/warranty-scheduling.service.js";
import {
  notifyAppointmentScheduled,
  notifyAppointmentCancelled,
} from "../services/ticket-appointment-service.js";

const NOT_CONFIGURED_NOTICE =
  "Your appointment is booked, but the confirmation email could not be sent. " +
  "It is safely recorded — please contact us if you need the details.";

/**
 * These endpoints are reached from an email link, with no session. The token IS
 * the authorisation, so each lookup is by token alone and every response says
 * only what the holder of that link already knows.
 */

function publicTicketView(ticket) {
  return {
    ticketId: ticket.id,
    issueType: ticket.issueType,
    address: ticket.property?.address || null,
    homeownerName: ticket.homeowner?.name || "there",
    staffName: ticket.assignedStaff?.name || ticket.assignedStaff?.email || null,
    companyName: ticket.company?.name || "Aiforhomebuilder",
  };
}

/** The booking page: what the visit is for, and the times going spare. */
export const publicGetBooking = async (req, res) => {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { bookingToken: req.params.token },
      include: {
        homeowner: { select: { name: true } },
        company: { select: { name: true } },
        assignedStaff: { select: { id: true, name: true, email: true } },
        property: { select: { address: true } },
        appointments: {
          where: { status: "SCHEDULED" },
          select: { id: true, scheduledAt: true },
        },
      },
    });

    if (!ticket) {
      return res.status(404).json({ message: "This booking link is not valid." });
    }
    if (ticket.status === "RESOLVED") {
      return res.status(410).json({ message: "This claim has already been resolved." });
    }
    if (ticket.appointments.length > 0) {
      return res.status(409).json({
        message: "A visit is already booked for this claim.",
        alreadyBooked: true,
      });
    }
    if (!ticket.assignedStaff) {
      return res.status(409).json({ message: "This claim has no one assigned yet." });
    }

    const availability = await slotsForStaff({
      staffId: ticket.assignedStaff.id,
      staffEmail: ticket.assignedStaff.email,
      companyId: ticket.companyId,
    });

    return res.json({ ...publicTicketView(ticket), ...availability });
  } catch (error) {
    console.error("[Ticket Scheduling] Failed to load booking:", error);
    return res.status(500).json({ message: "Something went wrong. Please try again." });
  }
};

/** The homeowner picks a slot. This is the moment the visit comes into being. */
export const publicBook = async (req, res) => {
  try {
    const { token, startTime } = req.body;
    if (!token || !startTime) {
      return res.status(400).json({ message: "Please choose a time." });
    }

    const ticket = await prisma.ticket.findUnique({
      where: { bookingToken: token },
      include: {
        assignedStaff: { select: { id: true, name: true, email: true } },
        property: { select: { address: true } },
        appointments: { where: { status: "SCHEDULED" }, select: { id: true } },
      },
    });

    if (!ticket) return res.status(404).json({ message: "This booking link is not valid." });
    if (ticket.status === "RESOLVED") {
      return res.status(410).json({ message: "This claim has already been resolved." });
    }
    if (ticket.appointments.length > 0) {
      return res.status(409).json({ message: "A visit is already booked for this claim." });
    }
    if (!ticket.assignedStaff) {
      return res.status(409).json({ message: "This claim has no one assigned yet." });
    }

    // Re-checked here rather than trusted from the page: someone else may have
    // taken the slot while this page was open.
    const check = await isSlotBookable({
      staffId: ticket.assignedStaff.id,
      staffEmail: ticket.assignedStaff.email,
      companyId: ticket.companyId,
      startTime,
    });
    if (!check.ok) return res.status(409).json({ message: check.reason });

    const appointment = await prisma.ticketAppointment.create({
      data: {
        ticketId: ticket.id,
        companyId: ticket.companyId,
        homeownerId: ticket.homeownerId,
        scheduledAt: new Date(startTime),
        durationMinutes: check.slotDuration || 60,
        tradeName: ticket.assignedStaff.name || ticket.assignedStaff.email,
        tradeEmail: ticket.assignedStaff.email,
        location: ticket.property?.address || null,
        notes: ticket.dispatchNotes || null,
        // Self-booked, so the assignee is the closest thing to a booker.
        createdById: ticket.assignedStaff.id,
      },
    });

    // The link has done its job. Clearing it means a forwarded email cannot be
    // used to book a second visit.
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { bookingToken: null },
    });

    const result = await notifyAppointmentScheduled(appointment.id);

    return res.status(201).json({
      success: true,
      scheduledAt: appointment.scheduledAt,
      manageToken: appointment.rescheduleToken,
      ...(result.emailConfigured === false ? { notice: NOT_CONFIGURED_NOTICE } : {}),
    });
  } catch (error) {
    console.error("[Ticket Scheduling] Failed to book:", error);
    return res.status(500).json({ message: "Could not book that time. Please try again." });
  }
};

async function appointmentByToken(token) {
  return prisma.ticketAppointment.findFirst({
    where: { OR: [{ rescheduleToken: token }, { cancelToken: token }] },
    include: {
      homeowner: { select: { name: true } },
      company: { select: { name: true } },
      ticket: {
        select: {
          id: true,
          issueType: true,
          status: true,
          companyId: true,
          assignedStaff: { select: { id: true, name: true, email: true } },
          property: { select: { address: true } },
        },
      },
    },
  });
}

/** The manage page, reached from a confirmation or reminder email. */
export const publicGetManage = async (req, res) => {
  try {
    const appointment = await appointmentByToken(req.params.token);
    if (!appointment) {
      return res.status(404).json({ message: "This link is not valid." });
    }

    const closed =
      appointment.status !== "SCHEDULED" || appointment.ticket?.status === "RESOLVED";

    const availability = closed
      ? { slots: [], timezone: null, slotDuration: null }
      : await slotsForStaff({
          staffId: appointment.ticket?.assignedStaff?.id,
          staffEmail: appointment.ticket?.assignedStaff?.email,
          companyId: appointment.companyId,
          excludeAppointmentId: appointment.id,
        });

    return res.json({
      ticketId: appointment.ticketId,
      issueType: appointment.ticket?.issueType || "Warranty issue",
      address: appointment.ticket?.property?.address || appointment.location || null,
      homeownerName: appointment.homeowner?.name || "there",
      staffName: appointment.tradeName || null,
      companyName: appointment.company?.name || "Aiforhomebuilder",
      scheduledAt: appointment.scheduledAt,
      durationMinutes: appointment.durationMinutes,
      status: appointment.status,
      closed,
      ...availability,
    });
  } catch (error) {
    console.error("[Ticket Scheduling] Failed to load manage page:", error);
    return res.status(500).json({ message: "Something went wrong. Please try again." });
  }
};

/** Moving a visit needs the reschedule token specifically — a cancel link cannot. */
export const publicReschedule = async (req, res) => {
  try {
    const { token, startTime } = req.body;
    if (!token || !startTime) {
      return res.status(400).json({ message: "Please choose a new time." });
    }

    const appointment = await prisma.ticketAppointment.findUnique({
      where: { rescheduleToken: token },
      include: {
        ticket: {
          select: {
            status: true,
            companyId: true,
            assignedStaff: { select: { id: true, email: true } },
          },
        },
      },
    });

    if (!appointment) return res.status(404).json({ message: "This link is not valid." });
    if (appointment.status !== "SCHEDULED") {
      return res.status(409).json({ message: "This visit is no longer active." });
    }
    if (appointment.ticket?.status === "RESOLVED") {
      return res.status(410).json({ message: "This claim has already been resolved." });
    }

    const check = await isSlotBookable({
      staffId: appointment.ticket?.assignedStaff?.id,
      staffEmail: appointment.ticket?.assignedStaff?.email,
      companyId: appointment.companyId,
      startTime,
      excludeAppointmentId: appointment.id,
    });
    if (!check.ok) return res.status(409).json({ message: check.reason });

    const updated = await prisma.ticketAppointment.update({
      where: { id: appointment.id },
      data: {
        scheduledAt: new Date(startTime),
        durationMinutes: check.slotDuration || appointment.durationMinutes,
        // A new time earns a fresh set of reminders.
        remindersSent: [],
      },
    });

    const result = await notifyAppointmentScheduled(updated.id, { rescheduled: true });

    return res.json({
      success: true,
      scheduledAt: updated.scheduledAt,
      ...(result.emailConfigured === false ? { notice: NOT_CONFIGURED_NOTICE } : {}),
    });
  } catch (error) {
    console.error("[Ticket Scheduling] Failed to reschedule:", error);
    return res.status(500).json({ message: "Could not move that visit. Please try again." });
  }
};

/** Cancelling hands the ticket back its booking link, so a new time can be picked. */
export const publicCancel = async (req, res) => {
  try {
    const { token, reason } = req.body;
    if (!token) return res.status(400).json({ message: "This link is not valid." });

    const appointment = await prisma.ticketAppointment.findFirst({
      where: { OR: [{ cancelToken: token }, { rescheduleToken: token }] },
      include: { ticket: { select: { id: true, status: true, bookingToken: true } } },
    });

    if (!appointment) return res.status(404).json({ message: "This link is not valid." });
    if (appointment.status === "CANCELLED") {
      return res.json({ success: true, alreadyCancelled: true });
    }
    if (appointment.status !== "SCHEDULED") {
      return res.status(409).json({ message: "This visit is no longer active." });
    }
    if (appointment.ticket?.status === "RESOLVED") {
      return res.status(410).json({ message: "This claim has already been resolved." });
    }

    await prisma.ticketAppointment.update({
      where: { id: appointment.id },
      data: {
        status: "CANCELLED",
        notes: reason?.trim()
          ? `${appointment.notes ? `${appointment.notes}\n\n` : ""}[Cancelled by homeowner] ${String(reason).trim().slice(0, 500)}`
          : appointment.notes,
      },
    });

    // Without a fresh token the ticket would be stuck: dispatched, no visit, and
    // no way for the homeowner to pick another time.
    await prisma.ticket.update({
      where: { id: appointment.ticketId },
      data: { bookingToken: appointment.ticket?.bookingToken || randomUUID() },
    });

    const result = await notifyAppointmentCancelled(appointment.id);

    return res.json({
      success: true,
      ...(result.emailConfigured === false
        ? { notice: "Your visit is cancelled, but the confirmation email could not be sent." }
        : {}),
    });
  } catch (error) {
    console.error("[Ticket Scheduling] Failed to cancel:", error);
    return res.status(500).json({ message: "Could not cancel that visit. Please try again." });
  }
};
