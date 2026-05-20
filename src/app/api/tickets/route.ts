import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { calculateWarrantyYear } from "@/lib/utils";
import { getServerSession } from "@/lib/session";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
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
      const { searchParams } = new URL(request.url);
      const homeownerId = searchParams.get("homeownerId");

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
    const session = await getServerSession(request);
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const data = await request.json();
    const { issueType, propertyId, priority, isEmergency, conversationId } = data;
    let { homeownerId } = data;

    // Enforce homeownerId for homeowners
    if (session.role === "HOMEOWNER") {
      homeownerId = session.id;
    } else if (!homeownerId) {
      return NextResponse.json({ message: "homeownerId is required" }, { status: 400 });
    }

    // Fetch property to get coeDate
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { coeDate: true, address: true, homeownerId: true }
    });

    if (!property) {
      return NextResponse.json({ message: "Property not found" }, { status: 404 });
    }

    // Ensure homeowner owns the property
    if (property.homeownerId !== homeownerId) {
      return NextResponse.json({ message: "Property does not belong to specified homeowner" }, { status: 403 });
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

