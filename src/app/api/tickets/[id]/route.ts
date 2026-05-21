import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { MailService } from "@/lib/mail-service";
import { getServerSession } from "@/lib/session";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(request);
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        homeowner: true,
        property: true,
        conversation: {
          include: {
            messages: {
              orderBy: { timestamp: "asc" }
            }
          }
        }
      },
    });

    if (!ticket) {
      return NextResponse.json({ message: "Ticket not found" }, { status: 404 });
    }

    // Role-based authorization
    if (session.role === "HOMEOWNER") {
      if (ticket.homeownerId !== session.id) {
        return NextResponse.json({ message: "Forbidden" }, { status: 403 });
      }
    } else {
      // Admins/Staff must belong to the same company as the homeowner
      if (ticket.homeowner.companyId !== session.companyId) {
        return NextResponse.json({ message: "Forbidden" }, { status: 403 });
      }
    }

    return NextResponse.json(ticket);
  } catch (error) {
    return NextResponse.json({ message: "Error fetching ticket" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(request);
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // Homeowners are not allowed to update status/priority of tickets
    if (session.role === "HOMEOWNER") {
      return NextResponse.json({ message: "Forbidden: Homeowners cannot modify ticket details." }, { status: 403 });
    }

    const { id } = await params;
    const data = await request.json();
    const { status, priority, draftResponse, action } = data;

    // Get old ticket to check if status changed and verify company
    const oldTicket = await prisma.ticket.findUnique({
      where: { id },
      include: { 
        homeowner: true,
        conversation: true
      }
    });

    if (!oldTicket) {
      return NextResponse.json({ message: "Ticket not found" }, { status: 404 });
    }

    // Admins/Staff can only update tickets of homeowners within their company
    if (oldTicket.homeowner.companyId !== session.companyId) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const updatedData: any = {};
    if (status) updatedData.status = status;
    if (priority) updatedData.priority = priority;

    if (action === "approve") {
      const approvedText = draftResponse !== undefined ? draftResponse : oldTicket.draftResponse;
      if (!approvedText || !approvedText.trim()) {
        return NextResponse.json({ message: "Cannot approve an empty draft response" }, { status: 400 });
      }

      // Resolve or create conversation
      let conversation = oldTicket.conversation;
      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            ticketId: oldTicket.id,
            homeownerId: oldTicket.homeownerId
          }
        });
      }

      // Add as assistant chat message
      await prisma.chatMessage.create({
        data: {
          conversationId: conversation.id,
          role: "assistant",
          content: approvedText.trim(),
          timestamp: new Date()
        }
      });

      // Clear the draft from ticket
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
          const mailResult = await MailService.sendTicketStatusUpdate(
            oldTicket.homeowner.email,
            oldTicket.homeowner.name || "Homeowner",
            ticket.id,
            status
          );
          
          if (!mailResult.success) {
            console.error("[Ticket API] Mail failed to send but ticket updated:", mailResult.error);
          }
        } catch (mailError) {
          console.error("[Ticket API] Unexpected error sending status email:", mailError);
        }
      }
    }

    return NextResponse.json(ticket);
  } catch (error) {
    console.error("[Ticket API] Error updating ticket:", error);
    return NextResponse.json({ message: "Error updating ticket" }, { status: 500 });
  }
}

