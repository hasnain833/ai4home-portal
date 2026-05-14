import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function POST(request: Request) {
  try {
    const { email, password, role } = await request.json();

    if (!email || !password || !role) {
      return NextResponse.json(
        { message: "Missing required fields" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { company: true },
    });

    if (!user) {
      return NextResponse.json(
        { message: "Invalid credentials" },
        { status: 401 }
      );
    }

    // Check if role matches
    if (user.role !== role.toUpperCase()) {
      return NextResponse.json(
        { message: "Role mismatch" },
        { status: 401 }
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return NextResponse.json(
        { message: "Invalid credentials" },
        { status: 401 }
      );
    }

    // In a real app, we would generate a JWT here
    // For now, we return the user data as requested
    const userData = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role.toLowerCase(),
      companyName: user.company?.name || null,
      online: true,
      lastSeen: new Date(),
    };

    return NextResponse.json(userData);
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
