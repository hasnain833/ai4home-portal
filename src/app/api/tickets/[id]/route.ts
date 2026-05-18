import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { MailService } from "@/lib/mail-service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
    const { id } = await params;
    const data = await request.json();
    const { status, priority } = data;

    // Get old ticket to check if status changed
    const oldTicket = await prisma.ticket.findUnique({
      where: { id },
      include: { homeowner: true }
    });

    if (!oldTicket) {
      return NextResponse.json({ message: "Ticket not found" }, { status: 404 });
    }

    const ticket = await prisma.ticket.update({
      where: { id },
      data: {
        status: status || undefined,
        priority: priority || undefined,
      },
    });

    // If status changed, send email
    if (status && status !== oldTicket.status) {
      if (oldTicket.homeowner?.email) {
        await MailService.sendTicketStatusUpdate(
          oldTicket.homeowner.email,
          oldTicket.homeowner.name || "Homeowner",
          ticket.id,
          status
        );
      }
    }

    return NextResponse.json(ticket);
  } catch (error) {
    console.error("[Ticket API] Error updating ticket:", error);
    return NextResponse.json({ message: "Error updating ticket" }, { status: 500 });
  }
}
