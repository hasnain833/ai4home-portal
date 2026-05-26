import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "@/lib/session";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
    }

    const communities = await prisma.community.findMany({
      where: { companyId: session.companyId || "demo-company" },
      orderBy: { createdAt: "desc" },
    });
    
    return NextResponse.json(communities);
  } catch (error) {
    console.error("Error fetching communities:", error);
    return NextResponse.json({ message: "Error fetching communities" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(request);
    // Only STAFF can create a community
    if (!session || session.role !== "STAFF") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
    }

    const { name, color } = await request.json();
    if (!name) {
      return NextResponse.json({ message: "Name is required" }, { status: 400 });
    }

    const companyId = session.companyId || "demo-company";

    const community = await prisma.community.create({
      data: {
        name,
        color: color || "#0F3B3D",
        companyId,
      },
    });

    return NextResponse.json(community);
  } catch (error) {
    console.error("Error creating community:", error);
    return NextResponse.json({ message: "Error creating community" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(request);
    // Only STAFF can delete
    if (!session || session.role !== "STAFF") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) return NextResponse.json({ message: "ID required" }, { status: 400 });

    const community = await prisma.community.findFirst({
      where: { id, companyId: session.companyId || "demo-company" }
    });

    if (!community) {
      return NextResponse.json({ message: "Community not found" }, { status: 404 });
    }

    await prisma.community.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting community:", error);
    return NextResponse.json({ message: "Error deleting community" }, { status: 500 });
  }
}
