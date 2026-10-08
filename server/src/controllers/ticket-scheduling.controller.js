import { randomUUID } from "node:crypto";
import prisma from "../lib/prisma.js";
import { slotsForStaff, isSlotBookable } from "../services/warranty-scheduling.service.js";
import {
  calendlyBookingFor,
  createCalendlyVisit,
  cancelCalendlyVisit,
  CalendlyBookingError,
} from "../services/calendly.service.js";
import { ticketRef } from "../lib/ticket-number.js";
import {
  notifyAppointmentScheduled,
  notifyAppointmentCancelled,
} from "../services/ticket-appointment-service.js";

const NOT_CONFIGURED_NOTICE =
  "Your appointment is booked, but the confirmation email could not be sent. " +
  "It is safely recorded — please contact us if you need the details.";

class BookingConflictError extends Error {}


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
    // Unassigned tickets book against the company's working hours.
    const availability = await slotsForStaff({
      staffId: ticket.assignedStaff?.id,
      staffEmail: ticket.assignedStaff?.email,
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
        homeowner: { select: { name: true, email: true, phone: true } },
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
    // createdById is required; with no assignee, a company admin stands in.
    const bookerId =
      ticket.assignedStaff?.id ||
      (await prisma.user.findFirst({
        where: { companyId: ticket.companyId, role: "ADMIN" },
        select: { id: true },
      }))?.id;
    if (!bookerId) {
      return res.status(409).json({ message: "This claim cannot be booked online yet. Please contact us." });
    }

    // A trade with a Calendly event type: book it there first. Calendly is
    // their calendar of record and turns away a slot that has gone.
    const calendly = await calendlyBookingFor(ticket.assignedStaff?.id);
    let calendlyEventUri = null;
    let slotDuration = null;
    if (calendly) {
      const check = await isSlotBookable({
        staffId: ticket.assignedStaff.id,
        staffEmail: ticket.assignedStaff.email,
        companyId: ticket.companyId,
        startTime,
      });
      if (!check.ok) return res.status(409).json({ message: check.reason });
      slotDuration = check.slotDuration;
      calendlyEventUri = await createCalendlyVisit(calendly, {
        startTime,
        name: ticket.homeowner?.name,
        email: ticket.homeowner?.email,
        phone: ticket.homeowner?.phone,
        timezone: check.timezone,
        address: ticket.property?.address,
        ticketRef: ticketRef(ticket),
      });
    }

    const appointment = await prisma.$transaction(
      async (tx) => {
        if (!calendly) {
          const check = await isSlotBookable({
            staffId: ticket.assignedStaff?.id,
            staffEmail: ticket.assignedStaff?.email,
            companyId: ticket.companyId,
            startTime,
            db: tx,
          });
          if (!check.ok) throw new BookingConflictError(check.reason);
          slotDuration = check.slotDuration;
        }

        const claimed = await tx.ticket.updateMany({
          where: {
            id: ticket.id,
            bookingToken: token,
            status: { not: "RESOLVED" },
            appointments: { none: { status: "SCHEDULED" } },
          },
          data: { bookingToken: null },
        });
        if (claimed.count !== 1) {
          throw new BookingConflictError("This booking link has already been used.");
        }

        return tx.ticketAppointment.create({
          data: {
            ticketId: ticket.id,
            companyId: ticket.companyId,
            homeownerId: ticket.homeownerId,
            scheduledAt: new Date(startTime),
            durationMinutes: slotDuration || 60,
            calendlyEventUri,
            tradeName: ticket.assignedStaff ? ticket.assignedStaff.name || ticket.assignedStaff.email : null,
            tradeEmail: ticket.assignedStaff?.email || null,
            location: ticket.property?.address || null,
            notes: ticket.dispatchNotes || null,
            // Self-booked, so the assignee is the closest thing to a booker.
            createdById: bookerId,
          },
        });
      },
      { isolationLevel: "Serializable" },
    ).catch(async (err) => {
      // Not saved on our side: don't leave the trade a Calendly booking nobody tracks.
      if (calendlyEventUri) {
        await cancelCalendlyVisit(ticket.assignedStaff.id, calendlyEventUri, "Booking could not be completed");
      }
      throw err;
    });

    const result = await notifyAppointmentScheduled(appointment.id);

    return res.status(201).json({
      success: true,
      scheduledAt: appointment.scheduledAt,
      manageToken: appointment.rescheduleToken,
      ...(result.emailConfigured === false ? { notice: NOT_CONFIGURED_NOTICE } : {}),
    });
  } catch (error) {
    if (error instanceof BookingConflictError || error instanceof CalendlyBookingError || error?.code === "P2034") {
      return res.status(409).json({
        message:
          error instanceof BookingConflictError || error instanceof CalendlyBookingError
            ? error.message
            : "That slot has just been taken. Please pick another.",
      });
    }
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
        homeowner: { select: { name: true, email: true, phone: true } },
        ticket: {
          select: {
            id: true,
            number: true,
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

    // Calendly: book the new time first, then drop the old event.
    const staffId = appointment.ticket?.assignedStaff?.id;
    const calendly = await calendlyBookingFor(staffId);
    let calendlyEventUri = appointment.calendlyEventUri;
    if (calendly) {
      try {
        calendlyEventUri = await createCalendlyVisit(calendly, {
          startTime,
          name: appointment.homeowner?.name,
          email: appointment.homeowner?.email,
          phone: appointment.homeowner?.phone,
          timezone: check.timezone,
          address: appointment.location,
          ticketRef: ticketRef(appointment.ticket),
        });
      } catch (err) {
        if (err instanceof CalendlyBookingError) return res.status(409).json({ message: err.message });
        throw err;
      }
    }

    const updated = await prisma.ticketAppointment.update({
      where: { id: appointment.id },
      data: {
        scheduledAt: new Date(startTime),
        durationMinutes: check.slotDuration || appointment.durationMinutes,
        calendlyEventUri,
        // A new time earns a fresh set of reminders.
        remindersSent: [],
        rescheduleCount: { increment: 1 },
      },
    });

    // After the save, so the cancellation echoing back by webhook matches nothing.
    if (calendly && appointment.calendlyEventUri) {
      await cancelCalendlyVisit(staffId, appointment.calendlyEventUri, "Moved to a new time");
    }

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
      include: { ticket: { select: { id: true, status: true, bookingToken: true, assignedStaffId: true } } },
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

    await cancelCalendlyVisit(appointment.ticket?.assignedStaffId, appointment.calendlyEventUri, "Cancelled by the homeowner");

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
