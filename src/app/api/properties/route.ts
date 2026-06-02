import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "@/lib/session";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (session.role === "HOMEOWNER") {
      const properties = await prisma.property.findMany({
        where: { homeownerId: session.id },
        orderBy: { createdAt: "desc" },
      });
      return NextResponse.json(properties);
    } else {
      // Admins and Staff: fetch all properties under their company
      const properties = await prisma.property.findMany({
        where: {
          homeowner: {
            companyId: session.companyId || undefined,
          },
        },
        include: {
          homeowner: {
            select: { name: true, email: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });
      return NextResponse.json(properties);
    }
  } catch (error) {
    console.error("Fetch properties error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { address, city, state, zipCode, coeDate, areaOfHome, homeownerId } = await request.json();

    if (!address) {
      return NextResponse.json({ message: "Address is required" }, { status: 400 });
    }

    let assignedHomeownerId: string;

    if (session.role === "HOMEOWNER") {
      assignedHomeownerId = session.id;
    } else if (session.role === "ADMIN" || session.role === "STAFF") {
      if (!homeownerId) {
        return NextResponse.json({ message: "Homeowner is required" }, { status: 400 });
      }
      assignedHomeownerId = homeownerId;
    } else {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const property = await prisma.property.create({
      data: {
        address,
        city: city || null,
        state: state || null,
        zipCode: zipCode || null,
        areaOfHome: areaOfHome || null,
        coeDate: coeDate ? new Date(coeDate) : null,
        homeownerId: assignedHomeownerId,
      },
      include: {
        homeowner: {
          select: { name: true, email: true },
        },
      },
    });

    return NextResponse.json(property);
  } catch (error) {
    console.error("Create property error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
