import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "@/lib/session";
import { createClient } from "@supabase/supabase-js";

// Initialize Supabase Admin client for auth management
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

    // 1. Create user in Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });

    if (authError) {
      console.error("Supabase auth creation error:", authError);
      return NextResponse.json(
        { message: authError.message || "Failed to create authentication account" },
        { status: 400 }
      );
    }

    // 2. Create user in Prisma DB
    const newStaff = await prisma.user.create({
      data: {
        name,
        email,
        password: "supabase-managed", // Password managed by Supabase now
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

    // 1. Delete from Supabase Auth
    const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
    const supabaseUser = usersData.users.find(u => u.email === staff.email);
    
    if (supabaseUser) {
      await supabaseAdmin.auth.admin.deleteUser(supabaseUser.id);
    }

    // 2. Delete from Prisma DB
    await prisma.user.delete({ where: { id: staffId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete staff member:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
