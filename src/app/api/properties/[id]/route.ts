import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "@/lib/session";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getServerSession(request);
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const { address, city, state, zipCode, coeDate, areaOfHome, homeownerId, coverageTerm } = await request.json();

    const property = await prisma.property.update({
      where: { id },
      data: {
        address,
        city: city || null,
        state: state || null,
        zipCode: zipCode || null,
        areaOfHome: areaOfHome || null,
        coeDate: coeDate ? new Date(coeDate) : null,
        coverageTerm: coverageTerm ? new Date(coverageTerm) : null,
        ...(homeownerId && { homeownerId }),
      },
      include: {
        homeowner: {
          select: { name: true, email: true },
        },
      },
    });

    return NextResponse.json(property);
  } catch (error) {
    console.error("Update property error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getServerSession(request);
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    await prisma.property.delete({ where: { id } });

    return NextResponse.json({ message: "Property deleted" });
  } catch (error) {
    console.error("Delete property error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
