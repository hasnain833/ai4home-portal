import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { calculateWarrantyYear } from "@/lib/utils";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const homeownerId = searchParams.get("homeownerId");

    const tickets = await prisma.ticket.findMany({
      where: homeownerId ? { homeownerId } : {},
      include: {
        homeowner: {
          select: {
            name: true,
            email: true,
          },
        },
        property: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json(tickets);
  } catch (error) {
    console.error("Failed to fetch tickets:", error);
    return NextResponse.json(
      { message: "Failed to fetch tickets" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const data = await request.json();
    const { issueType, propertyId, homeownerId, priority, isEmergency, conversationId } = data;

    // Fetch property to get coeDate
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { coeDate: true, address: true }
    });

    if (!property) {
      return NextResponse.json({ message: "Property not found" }, { status: 404 });
    }

    const warrantyYear = calculateWarrantyYear(property.coeDate);

    const ticket = await prisma.ticket.create({
      data: {
        issueType,
        propertyId,
        homeownerId,
        priority: isEmergency ? "URGENT" : (priority || "MEDIUM"),
        isEmergency: !!isEmergency,
        warrantyYear,
        status: isEmergency ? "ESCALATED" : "OPEN",
        conversation: conversationId ? {
          connect: { id: conversationId }
        } : undefined
      },
    });

    return NextResponse.json(ticket);
  } catch (error) {
    console.error("Failed to create ticket:", error);
    return NextResponse.json(
      { message: "Failed to create ticket" },
      { status: 500 }
    );
  }
}
