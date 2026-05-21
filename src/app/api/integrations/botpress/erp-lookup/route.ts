import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// Helper to check authentication
function isAuthorized(request: Request): boolean {
  const url = new URL(request.url);
  const secretParam = url.searchParams.get("secret");
  const authHeader = request.headers.get("authorization");
  const apiKeyHeader = request.headers.get("x-api-key");

  const secret = process.env.BOTPRESS_API_SECRET || process.env.SESSION_SECRET || "super_secret_key_change_me_in_production";

  if (secretParam === secret) return true;
  if (apiKeyHeader === secret) return true;
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (token === secret) return true;
  }

  return false;
}

// Generate realistic simulated dispatch details based on ticket ID
function getSimulatedDispatchDetails(ticketId: string, erpRef: string | null): string {
  if (!erpRef) return "Awaiting scheduling queue inside ERP system.";
  
  const suffix = ticketId.slice(-4);
  const code = parseInt(suffix, 16) || 0;
  const index = code % 4;

  const dispatches = [
    "Work Order Issued - ACME Contractors scheduled for onsite diagnostic inspection next Tuesday between 9 AM - 1 PM.",
    "Technician Assigned - Service specialist confirmed. Awaiting parts delivery from warehouse supplier (estimated delivery in 3 business days).",
    "Onsite Verification - Dispatcher scheduled drywall/painting specialist to repair drywall settling cracks next Friday afternoon.",
    "Service Work Completed - Technician verified repairs on primary systems, awaiting final signature off from homeowner or staff inspector."
  ];

  return dispatches[index];
}

export async function POST(request: Request) {
  try {
    // 1. Verify Authentication
    if (!isAuthorized(request)) {
      return NextResponse.json({ message: "Unauthorized integration request" }, { status: 401 });
    }

    const body = await request.json();
    const { ticketId, homeownerEmail } = body;

    if (!ticketId && !homeownerEmail) {
      return NextResponse.json({ 
        message: "ticketId or homeownerEmail must be specified in request body" 
      }, { status: 400 });
    }

    // Case 1: Look up a specific ticket
    if (ticketId) {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: { homeowner: true }
      });

      if (!ticket) {
        return NextResponse.json({ message: `Ticket with ID ${ticketId} not found` }, { status: 404 });
      }

      const dispatchDetails = getSimulatedDispatchDetails(ticket.id, ticket.erpReferenceId);

      return NextResponse.json({
        success: true,
        type: "TICKET_LOOKUP",
        ticket: {
          id: ticket.id,
          issueType: ticket.issueType,
          status: ticket.status,
          priority: ticket.priority,
          erpSyncStatus: ticket.erpSyncStatus,
          erpReferenceId: ticket.erpReferenceId,
          dispatchDetails,
          updatedAt: ticket.updatedAt
        }
      });
    }

    // Case 2: Look up tickets for a homeowner email
    if (homeownerEmail) {
      const homeowner = await prisma.user.findUnique({
        where: { email: homeownerEmail },
        include: {
          tickets: {
            orderBy: { createdAt: "desc" },
            take: 3
          }
        }
      });

      if (!homeowner) {
        return NextResponse.json({ 
          message: `Homeowner with email ${homeownerEmail} not found` 
        }, { status: 404 });
      }

      const formattedTickets = homeowner.tickets.map(ticket => ({
        id: ticket.id,
        issueType: ticket.issueType,
        status: ticket.status,
        priority: ticket.priority,
        erpSyncStatus: ticket.erpSyncStatus,
        erpReferenceId: ticket.erpReferenceId,
        dispatchDetails: getSimulatedDispatchDetails(ticket.id, ticket.erpReferenceId),
        createdAt: ticket.createdAt
      }));

      return NextResponse.json({
        success: true,
        type: "HOMEOWNER_TICKETS_LOOKUP",
        homeowner: {
          id: homeowner.id,
          name: homeowner.name,
          email: homeowner.email
        },
        tickets: formattedTickets
      });
    }

  } catch (error: any) {
    console.error("[ERP Webhook Lookup] Error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
