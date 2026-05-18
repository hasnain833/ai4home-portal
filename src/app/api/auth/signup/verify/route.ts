import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function POST(request: Request) {
  try {
    const { email, otp, fullName, password } = await request.json();

    if (!email || !otp) {
      return NextResponse.json({ message: "Email and OTP are required" }, { status: 400 });
    }

    const verification = await prisma.otpVerification.findUnique({
      where: { email },
    });

    if (!verification) {
      return NextResponse.json({ message: "No verification request found for this email" }, { status: 400 });
    }

    if (verification.otp !== otp) {
      return NextResponse.json({ message: "Invalid OTP" }, { status: 400 });
    }

    if (new Date() > verification.expiresAt) {
      return NextResponse.json({ message: "OTP has expired. Please request a new one." }, { status: 400 });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json(
        { message: "An account with this email already exists" },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Public signup ALWAYS creates a HOMEOWNER — no exceptions.
    // Admins create staff via the internal admin dashboard.
    await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: fullName,
        role: "HOMEOWNER",
      },
    });

    // Cleanup the OTP record
    await prisma.otpVerification.delete({ where: { email } });

    return NextResponse.json({
      success: true,
      message: "Account created successfully",
    });
  } catch (error) {
    console.error("Failed to verify OTP and create account:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
