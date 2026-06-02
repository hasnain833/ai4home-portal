import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "@/lib/session";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

// Initialize Supabase Admin client for auth management
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const homeowners = await prisma.user.findMany({
      where: {
        companyId: session.companyId || "demo-company",
        role: "HOMEOWNER",
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

    return NextResponse.json(homeowners);
  } catch (error) {
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let createdSupabaseUserId: string | null = null;
  try {
    const session = await getServerSession(request);
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const { name, email, password } = await request.json();

    if (!name || !email || !password) {
      return NextResponse.json({ message: "Missing fields" }, { status: 400 });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json({ message: "Email already in use" }, { status: 400 });
    }

    // 1. Create user in Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });

    if (authError) {
      console.error("Supabase homeowner auth creation error:", authError);
      return NextResponse.json(
        { message: authError.message || "Failed to create authentication account" },
        { status: 400 }
      );
    }

    createdSupabaseUserId = authData.user.id;

    // 2. Create user in Prisma DB
    const hashedPassword = await bcrypt.hash(password, 10);
    const homeowner = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: "HOMEOWNER",
        companyId: session.companyId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      }
    });

    return NextResponse.json(homeowner);
  } catch (error) {
    console.error("Failed to create homeowner:", error);
    // Roll back Supabase user if local DB insertion fails
    if (createdSupabaseUserId) {
      await supabaseAdmin.auth.admin.deleteUser(createdSupabaseUserId);
    }
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session || session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const { homeownerId } = await request.json();

    if (!homeownerId) {
      return NextResponse.json({ message: "Missing homeowner ID" }, { status: 400 });
    }

    // Find the homeowner record
    const homeowner = await prisma.user.findFirst({
      where: { id: homeownerId, companyId: session.companyId, role: "HOMEOWNER" }
    });

    if (!homeowner) {
      return NextResponse.json({ message: "Homeowner not found" }, { status: 404 });
    }

    // 1. Delete from Supabase Auth
    const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
    const supabaseUser = usersData.users.find(u => u.email === homeowner.email);

    if (supabaseUser) {
      await supabaseAdmin.auth.admin.deleteUser(supabaseUser.id);
    }

    // 2. Delete from Prisma DB
    await prisma.user.delete({
      where: { id: homeownerId },
    });

    return NextResponse.json({ message: "Homeowner deleted" });
  } catch (error) {
    console.error("Failed to delete homeowner:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
