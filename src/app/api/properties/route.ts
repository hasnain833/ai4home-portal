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
      // Homeowners can only fetch their own properties
      const properties = await prisma.property.findMany({
        where: { homeownerId: session.id },
        orderBy: { createdAt: "desc" },
      });
      return NextResponse.json(properties);
    } else {
      // Admins and Staff can fetch all properties belonging to their company's homeowners
      const properties = await prisma.property.findMany({
        where: {
          homeowner: {
            companyId: session.companyId || "demo-company",
          },
        },
        include: {
          homeowner: {
            select: {
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });
      return NextResponse.json(properties);
    }
  } catch (error) {
    console.error("Fetch properties error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const { address, city, state, zipCode, coeDate, homeownerId } = await request.json();

    if (!address || !homeownerId) {
      return NextResponse.json(
        { message: "Address and Homeowner are required" },
        { status: 400 }
      );
    }

    // Verify homeowner exists and is in the same company
    const homeowner = await prisma.user.findFirst({
      where: {
        id: homeownerId,
        role: "HOMEOWNER",
        companyId: session.companyId || "demo-company",
      },
    });

    if (!homeowner) {
      return NextResponse.json(
        { message: "Selected homeowner not found or is in another company" },
        { status: 404 }
      );
    }

    const property = await prisma.property.create({
      data: {
        address,
        city,
        state,
        zipCode,
        coeDate: coeDate ? new Date(coeDate) : null,
        homeownerId,
      },
      include: {
        homeowner: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    return NextResponse.json(property);
  } catch (error) {
    console.error("Create property error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
