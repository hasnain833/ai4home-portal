import prisma from "../lib/prisma.js";
import { listTicketPhotos } from "../services/warranty-photos.service.js";
import { calculateWarrantyYear } from "../lib/utils.js";
import { MessagingService } from "../services/messaging-service.js";
import { MAIL_OUTCOME } from "../services/mail-service.js";
import { Templates } from "../services/templates.js";
import { notifyTicketDispatched } from "../services/ticket-appointment-service.js";
import { randomUUID } from "node:crypto";
import { syncTicketToERP } from "../services/erp-service.js";
import { notifyTicketCreated } from "../services/notification-service.js";
import {
  normalizePriority,
  STORABLE_PRIORITIES,
  RESOLVED_PRIORITY,
} from "../lib/warranty-classify.js";

const TICKET_STATUSES = ["OPEN", "DISPATCHED", "RESOLVED"];

// Dispatch is the normal way out of OPEN, because it is the only thing that
// names an assignee and sends the booking link. Staff can still move a ticket by
// hand to correct a mistake — the rules in updateTicket keep the row coherent
// when they do, rather than forbidding it outright.

const ASSIGNED_STAFF_SELECT = { select: { id: true, name: true, email: true } };

// The soonest still-standing visit, so the list can tell a dispatched ticket
// that has been booked from one still waiting on the homeowner.
const NEXT_VISIT_SELECT = {
  where: { status: "SCHEDULED" },
  orderBy: { scheduledAt: "asc" },
  take: 1,
  select: { scheduledAt: true },
};

/** Flattens the one-row appointment include into a plain field for the client. */
const withNextVisit = (ticket) => {
  const { appointments, ...rest } = ticket;
  return { ...rest, nextVisitAt: appointments?.[0]?.scheduledAt ?? null };
};

const DISPATCH_ROLES = ["ADMIN", "STAFF"];

export const getTickets = async (req, res) => {
  try {
    const session = req.user;
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    let tickets;

    if (session.role === "HOMEOWNER") {
      tickets = await prisma.ticket.findMany({
        where: { homeownerId: session.id },
        include: {
          homeowner: {
            select: {
              name: true,
              email: true,
            },
          },
          property: true,
          assignedStaff: ASSIGNED_STAFF_SELECT,
          appointments: NEXT_VISIT_SELECT,
        },
        orderBy: { createdAt: "desc" },
      });
    } else {
      // Staff and Admin see company-wide tickets
      const homeownerId = req.query.homeownerId;
      const propertyId = req.query.propertyId;

      // Scoping to one home is not just propertyId: a ticket the warranty agent
      // could not tie to a home is stored with propertyId null against its
      // homeowner, and those belong in the home's list too. Property.homeownerId
      // is unique — one home per owner — so that fallback is exact, never a
      // ticket from some other house.
      let propertyScope = {};
      if (propertyId) {
        const property = await prisma.property.findFirst({
          where: { id: propertyId, homeowner: { companyId: session.companyId } },
          select: { homeownerId: true },
        });
        // Unknown id, or one belonging to another company: no tickets, and no
        // signal about whether the property exists.
        if (!property) return res.json([]);
        propertyScope = {
          OR: [
            { propertyId },
            { propertyId: null, homeownerId: property.homeownerId },
          ],
        };
      }

      tickets = await prisma.ticket.findMany({
        where: {
          homeowner: { companyId: session.companyId },
          ...(homeownerId ? { homeownerId } : {}),
          ...propertyScope,
        },
        include: {
          homeowner: {
            select: {
              name: true,
              email: true,
            },
          },
          property: true,
          assignedStaff: ASSIGNED_STAFF_SELECT,
          appointments: NEXT_VISIT_SELECT,
        },
        orderBy: { createdAt: "desc" },
      });
    }

    return res.json(tickets.map(withNextVisit));
  } catch (error) {
    console.error("Failed to fetch tickets:", error);
    return res.status(500).json({ message: "Failed to fetch tickets" });
  }
};

export const createTicket = async (req, res) => {
  try {
    const session = req.user;
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const {
      issueType,
      ticketType,
      description,
      propertyId,
      priority,
      isEmergency,
      notifyHomeowner = true,
    } = req.body;
    let { homeownerId } = req.body;

    if (!String(issueType || "").trim()) {
      return res.status(400).json({ message: "issueType is required" });
    }
    if (!propertyId) {
      return res.status(400).json({ message: "propertyId is required" });
    }

    // Enforce homeownerId for homeowners
    if (session.role === "HOMEOWNER") {
      homeownerId = session.id;
    } else if (!homeownerId) {
      return res.status(400).json({ message: "homeownerId is required" });
    }

    // Fetch property to get coeDate
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { coeDate: true, address: true, homeownerId: true, homeowner: { select: { companyId: true } } }
    });

    if (!property) {
      return res.status(404).json({ message: "Property not found" });
    }

    // Ensure homeowner owns the property
    if (property.homeownerId !== homeownerId) {
      return res.status(403).json({ message: "Property does not belong to specified homeowner" });
    }

    const warrantyYear = calculateWarrantyYear(property.coeDate);

    const ticket = await prisma.ticket.create({
      data: {
        // id omitted — Supabase/Prisma auto-assigns a cuid
        issueType,
        ticketType,
        description: String(description || "").trim().slice(0, 5000) || null,
        propertyId,
        homeownerId,
        companyId: property.homeowner?.companyId ?? null,
        priority: normalizePriority(priority, {
          isEmergency: !!isEmergency,
          text: `${issueType || ""} ${ticketType || ""}`,
        }),
        isEmergency: !!isEmergency,
        warrantyYear,
        status: "OPEN",
      },
    });

    try {
      await syncTicketToERP(ticket.id, { reason: isEmergency ? "escalation" : "creation" });
    } catch (erpError) {
      console.error(`[Ticket API] ERP sync on creation failed for #${ticket.id}:`, erpError.message);
    }

    const notifyResult = await notifyTicketCreated(ticket.id, {
      sendEmail: notifyHomeowner !== false,
    });
    
    const notice =
      notifyResult.emailConfigured === false
        ? "Ticket created and visible in the portal, but no email was sent: email delivery " +
          "is temporarily unavailable. Please contact support if this continues."
        : null;

    return res.json(notice ? { ...ticket, notice } : ticket);
  } catch (error) {
    console.error("Failed to create ticket:", error);
    return res.status(500).json({ message: "Failed to create ticket" });
  }
};

export const getTicket = async (req, res) => {
  try {
    const session = req.user;
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { id } = req.params;
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        homeowner: true,
        property: true,
        assignedStaff: ASSIGNED_STAFF_SELECT,
        appointments: NEXT_VISIT_SELECT,
      },
    });

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    // Role-based authorization
    if (session.role === "HOMEOWNER") {
      if (ticket.homeownerId !== session.id) {
        return res.status(403).json({ message: "Forbidden" });
      }
    } else {
      // Admins/Staff must belong to the same company as the homeowner
      if (ticket.homeowner.companyId !== session.companyId) {
        return res.status(403).json({ message: "Forbidden" });
      }
    }

    // Photos are private; each comes back with a short-lived signed link.
    const photos = await listTicketPhotos(ticket.id).catch((err) => {
      console.error(`[Tickets] Could not load photos for #${ticket.id}:`, err.message);
      return [];
    });

    return res.json({ ...withNextVisit(ticket), photos });
  } catch (error) {
    console.error("Error fetching ticket:", error);
    return res.status(500).json({ message: "Error fetching ticket" });
  }
};

export const updateTicket = async (req, res) => {
  try {
    const session = req.user;
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Homeowners are not allowed to update status/priority of tickets
    if (session.role === "HOMEOWNER") {
      return res.status(403).json({ message: "Forbidden: Homeowners cannot modify ticket details." });
    }

    const { id } = req.params;
    const { status, priority, draftResponse, action } = req.body;

    // Get old ticket to check if status changed and verify company
    const oldTicket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        homeowner: {
          include: {
            company: true
          }
        }
      }
    });

    if (!oldTicket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    // Admins/Staff can only update tickets of homeowners within their company
    if (oldTicket.homeowner.companyId !== session.companyId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    if (status && !TICKET_STATUSES.includes(status)) {
      return res.status(400).json({
        message: `Invalid status. Expected one of: ${TICKET_STATUSES.join(", ")}`,
      });
    }
    // The one state that cannot be made coherent after the fact: dispatched to
    // nobody means no one to visit and no link for the homeowner to book with.
    if (status === "DISPATCHED" && status !== oldTicket.status && !oldTicket.assignedStaffId) {
      return res.status(400).json({
        message:
          "Assign someone first — use Dispatch to pick a staff member and send the homeowner a booking link.",
      });
    }
    if (priority && !STORABLE_PRIORITIES.includes(priority)) {
      return res.status(400).json({
        message: `Invalid priority. Expected one of: ${STORABLE_PRIORITIES.join(", ")}`,
      });
    }

    const updatedData = {};
    const statusChanged = status && status !== oldTicket.status;

    if (status) {
      updatedData.status = status;
      updatedData.reminderCount = 0;
      updatedData.lastReminderAt = null;
    }
    if (priority) updatedData.priority = priority;

    if (statusChanged && status === "RESOLVED" && !priority) {
      // Nobody is waiting on a resolved claim, so the urgency it was filed with
      // stops being true. An explicit priority in the same request still wins.
      updatedData.priority = RESOLVED_PRIORITY;
    }

    if (statusChanged && status === "OPEN") {
      // Reopening has to undo the dispatch, or the ticket keeps an assignee and
      // a booking link for work that is no longer assigned to them.
      updatedData.assignedStaffId = null;
      updatedData.bookingToken = null;
      updatedData.dispatchNotes = null;
      if (oldTicket.priority === RESOLVED_PRIORITY && !priority) {
        // HAPPY is meaningless on an open claim; fall back to the default.
        updatedData.priority = "MEDIUM";
      }
    }

    if (action === "approve") {
      const approvedText = draftResponse !== undefined ? draftResponse : oldTicket.draftResponse;
      if (!approvedText || !approvedText.trim()) {
        return res.status(400).json({ message: "Cannot approve an empty draft response" });
      }
      // Clear the draft from ticket on approval
      updatedData.draftResponse = null;
    } else if (action === "reject") {
      // Clear the draft from ticket
      updatedData.draftResponse = null;
    } else if (draftResponse !== undefined && draftResponse !== null) {
      // Standard draft update (e.g. auto-save or manual edit)
      updatedData.draftResponse = draftResponse;
    }

    const ticket = await prisma.ticket.update({
      where: { id },
      data: updatedData,
      include: { assignedStaff: ASSIGNED_STAFF_SELECT },
    });

    let notice = null;

    // If status changed, sync to ERP (escalation/resolution — SRS §4.2.7) and email the homeowner
    if (status && status !== oldTicket.status) {
      try {
        const reason =
          status === "RESOLVED" ? "resolution" : oldTicket.isEmergency ? "escalation" : "status-change";
        await syncTicketToERP(ticket.id, { reason });
      } catch (erpError) {
        console.error(`[Ticket API] ERP sync on status change failed for #${ticket.id}:`, erpError.message);
      }

      if (status === "OPEN") {
        await prisma.ticketAppointment
          .updateMany({
            where: { ticketId: ticket.id, status: "SCHEDULED" },
            data: { status: "CANCELLED" },
          })
          .catch((err) =>
            console.error(`[Ticket API] Could not clear visits for #${ticket.id}:`, err.message),
          );
      }

      if (status === "RESOLVED") {
        // A resolved ticket has no visit left to keep. Closing out the schedule
        // here is what stops reminders going out for a job that is already done.
        await prisma.ticketAppointment
          .updateMany({
            where: { ticketId: ticket.id, status: "SCHEDULED" },
            data: { status: "COMPLETED" },
          })
          .catch((err) =>
            console.error(`[Ticket API] Could not close visits for #${ticket.id}:`, err.message),
          );

        if (oldTicket.homeowner?.email) {
          try {
            const company = oldTicket.homeowner.company;
            const mailResult = await MessagingService.sendEmail({
              companyId: oldTicket.homeowner.companyId,
              to: oldTicket.homeowner.email,
              subject: `Your warranty claim #${ticket.id} is resolved`,
              html: Templates.getTicketResolvedEmail(
                {
                  ticketId: ticket.id,
                  issueType: ticket.issueType,
                  homeownerName: oldTicket.homeowner.name || "Homeowner",
                },
                process.env.NEXT_PUBLIC_URL || "",
                company?.name || "Aiforhomebuilder",
              ),
              fromName: company?.name || "Aiforhomebuilder",
              fromEmail: company?.email || undefined,
              source: "ticket-resolved",
            });

            if (mailResult.blocked) {
              console.warn(
                `[Ticket API] Resolved email suppressed for ${oldTicket.homeowner.email}: ${mailResult.reason}`,
              );
            } else if (mailResult.outcome === MAIL_OUTCOME.NOT_CONFIGURED) {
              // The ticket is resolved either way — only the thank-you did not
              // go out. Surfaced so staff know to follow up rather than assuming
              // the homeowner was told.
              notice =
                "Ticket resolved, but the homeowner was not emailed: email delivery is " +
                "temporarily unavailable. Please contact support if this continues.";
            } else if (!mailResult.success) {
              console.error("[Ticket API] Resolved email failed but ticket updated:", mailResult.error);
            }
          } catch (mailError) {
            console.error("[Ticket API] Unexpected error sending resolved email:", mailError);
          }
        }
      }
    }

    return res.json(notice ? { ...ticket, notice } : ticket);
  } catch (error) {
    console.error("[Ticket API] Error updating ticket:", error);
    return res.status(500).json({ message: "Error updating ticket" });
  }
};

/**
 * Dispatch: the one door out of OPEN. Names the staff member who owns the fix
 * and sends the homeowner a link to pick a time from that person's availability.
 *
 * No time is chosen here on purpose — the homeowner picks it. So a dispatched
 * ticket may sit with no visit booked yet, which the tickets list surfaces as
 * "awaiting booking" rather than letting it go quiet.
 */
export const dispatchTicket = async (req, res) => {
  try {
    const session = req.user;
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (!DISPATCH_ROLES.includes(session.role)) {
      return res.status(403).json({ message: "Only staff and admins can dispatch tickets" });
    }

    const { id } = req.params;
    const { staffId, notes } = req.body;

    if (!staffId) {
      return res.status(400).json({ message: "Please choose a staff member to assign." });
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        homeowner: { include: { company: true } },
        property: { select: { address: true } },
      },
    });

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    const companyId = ticket.companyId || ticket.homeowner?.companyId || null;
    if (!companyId || companyId !== session.companyId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    if (ticket.status !== "OPEN") {
      return res.status(400).json({
        message:
          ticket.status === "DISPATCHED"
            ? "This ticket has already been dispatched."
            : "This ticket is resolved and can no longer be dispatched.",
      });
    }

    const staff = await prisma.user.findFirst({
      where: { id: staffId, companyId, role: { in: DISPATCH_ROLES } },
      select: { id: true, name: true, email: true },
    });
    if (!staff) {
      return res.status(400).json({ message: "That staff member is not part of this company." });
    }

    const updated = await prisma.ticket.update({
      where: { id },
      data: {
        status: "DISPATCHED",
        assignedStaffId: staff.id,
        bookingToken: randomUUID(),
        dispatchNotes: String(notes || "").trim().slice(0, 2000) || null,
        reminderCount: 0,
        lastReminderAt: null,
      },
      include: { assignedStaff: ASSIGNED_STAFF_SELECT },
    });

    try {
      await syncTicketToERP(id, { reason: ticket.isEmergency ? "escalation" : "status-change" });
    } catch (erpError) {
      console.error(`[Ticket API] ERP sync on dispatch failed for #${id}:`, erpError.message);
    }

    const result = await notifyTicketDispatched(id);

    // Email is the only way the homeowner gets their booking link, so a blocked
    // or unconfigured send is not a footnote — without it nothing can be booked.
    let notice = null;
    if (result.emailConfigured === false) {
      notice =
        "Ticket dispatched, but no emails were sent: email delivery is temporarily " +
        "unavailable, so the homeowner has not received a booking link. Please " +
        "contact support if this continues.";
    } else if (result.homeownerDelivered === false) {
      notice =
        "Ticket dispatched, but the booking link did not reach the homeowner. " +
        "They cannot schedule a visit until it does — please follow up directly.";
    }

    return res.json({ ...updated, ...(notice ? { notice } : {}) });
  } catch (error) {
    console.error("[Ticket API] Error dispatching ticket:", error);
    return res.status(500).json({ message: "Error dispatching ticket" });
  }
};
