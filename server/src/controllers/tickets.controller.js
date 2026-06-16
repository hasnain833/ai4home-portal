import prisma from "../lib/prisma.js";
import { calculateWarrantyYear } from "../lib/utils.js";
import { generateTicketId } from "../lib/ticket-utils.js";
import { MailService } from "../lib/mail-service.js";

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
        },
        orderBy: { createdAt: "desc" },
      });
    } else {
      // Staff and Admin see company-wide tickets
      const homeownerId = req.query.homeownerId;

      tickets = await prisma.ticket.findMany({
        where: {
          homeowner: { companyId: session.companyId },
          ...(homeownerId ? { homeownerId } : {}),
        },
        include: {
          homeowner: {
            select: {
              name: true,
              email: true,
            },
          },
          property: true,
        },
        orderBy: { createdAt: "desc" },
      });
    }

    return res.json(tickets);
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

    const { issueType, ticketType, propertyId, priority, isEmergency } = req.body;
    let { homeownerId } = req.body;

    // Enforce homeownerId for homeowners
    if (session.role === "HOMEOWNER") {
      homeownerId = session.id;
    } else if (!homeownerId) {
      return res.status(400).json({ message: "homeownerId is required" });
    }

    // Fetch property to get coeDate
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { coeDate: true, address: true, homeownerId: true }
    });

    if (!property) {
      return res.status(404).json({ message: "Property not found" });
    }

    // Ensure homeowner owns the property
    if (property.homeownerId !== homeownerId) {
      return res.status(403).json({ message: "Property does not belong to specified homeowner" });
    }

    const warrantyYear = calculateWarrantyYear(property.coeDate);

    const ticketId = await generateTicketId();

    const ticket = await prisma.ticket.create({
      data: {
        id: ticketId,
        issueType,
        ticketType,
        propertyId,
        homeownerId,
        priority: isEmergency ? "URGENT" : (priority || "MEDIUM"),
        isEmergency: !!isEmergency,
        warrantyYear,
        status: isEmergency ? "ESCALATED" : "OPEN",
      },
    });

    return res.json(ticket);
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

    return res.json(ticket);
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
      include: { homeowner: true }
    });

    if (!oldTicket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    // Admins/Staff can only update tickets of homeowners within their company
    if (oldTicket.homeowner.companyId !== session.companyId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const updatedData = {};
    if (status) updatedData.status = status;
    if (priority) updatedData.priority = priority;

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
    } else if (draftResponse !== undefined) {
      // Standard draft update (e.g. auto-save or manual edit)
      updatedData.draftResponse = draftResponse;
    }

    const ticket = await prisma.ticket.update({
      where: { id },
      data: updatedData,
    });

    // If status changed, send email
    if (status && status !== oldTicket.status) {
      if (oldTicket.homeowner?.email) {
        try {
          // Attempting to send an email, not failing the request if mail fails
          if (MailService && typeof MailService.sendTicketStatusUpdate === 'function') {
            const mailResult = await MailService.sendTicketStatusUpdate(
              oldTicket.homeowner.email,
              oldTicket.homeowner.name || "Homeowner",
              ticket.id,
              status
            );
            
            if (!mailResult.success) {
              console.error("[Ticket API] Mail failed to send but ticket updated:", mailResult.error);
            }
          }
        } catch (mailError) {
          console.error("[Ticket API] Unexpected error sending status email:", mailError);
        }
      }
    }

    return res.json(ticket);
  } catch (error) {
    console.error("[Ticket API] Error updating ticket:", error);
    return res.status(500).json({ message: "Error updating ticket" });
  }
};
