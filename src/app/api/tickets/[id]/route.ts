import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

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

    const ticket = await prisma.ticket.update({
      where: { id },
      data: {
        status: status || undefined,
        priority: priority || undefined,
      },
    });

    return NextResponse.json(ticket);
  } catch (error) {
    return NextResponse.json({ message: "Error updating ticket" }, { status: 500 });
  }
}
