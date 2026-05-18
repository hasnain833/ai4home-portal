import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { getServerSession } from "@/lib/session";

// GET — list all staff members for the admin's company
export async function GET(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session || session.role !== "ADMIN") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
    }

    const staff = await prisma.user.findMany({
      where: {
        companyId: session.companyId,
        role: "STAFF",
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(staff);
  } catch (error) {
    console.error("Failed to list staff:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// POST — create a new staff member (Admin only)
export async function POST(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session || session.role !== "ADMIN") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
    }

    const { name, email, password } = await request.json();

    if (!name || !email || !password) {
      return NextResponse.json({ message: "Name, email, and password are required" }, { status: 400 });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json(
        { message: "An account with this email already exists" },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newStaff = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: "STAFF",
        companyId: session.companyId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    return NextResponse.json(newStaff, { status: 201 });
  } catch (error) {
    console.error("Failed to create staff member:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// DELETE — remove a staff member (Admin only)
export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session || session.role !== "ADMIN") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
    }

    const { staffId } = await request.json();
    if (!staffId) {
      return NextResponse.json({ message: "Staff ID is required" }, { status: 400 });
    }

    // Verify the staff belongs to the admin's company
    const staff = await prisma.user.findFirst({
      where: { id: staffId, companyId: session.companyId, role: "STAFF" },
    });

    if (!staff) {
      return NextResponse.json({ message: "Staff member not found" }, { status: 404 });
    }

    await prisma.user.delete({ where: { id: staffId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete staff member:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
