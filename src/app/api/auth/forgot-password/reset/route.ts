import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function POST(request: Request) {
  try {
    const { email, otp, password } = await request.json();

    if (!email || !otp || !password) {
      return NextResponse.json(
        { message: "Email, OTP, and new password are required" },
        { status: 400 }
      );
    }

    const verification = await prisma.otpVerification.findUnique({
      where: { email },
    });

    if (!verification) {
      return NextResponse.json(
        { message: "No active password reset request found for this email" },
        { status: 400 }
      );
    }

    if (verification.otp !== otp) {
      return NextResponse.json({ message: "Invalid verification code" }, { status: 400 });
    }

    if (new Date() > verification.expiresAt) {
      return NextResponse.json(
        { message: "Verification code has expired. Please request a new one." },
        { status: 400 }
      );
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update user password
    await prisma.user.update({
      where: { email },
      data: { password: hashedPassword },
    });

    // Cleanup the OTP record
    await prisma.otpVerification.delete({
      where: { email },
    });

    return NextResponse.json({
      success: true,
      message: "Password reset successfully. You can now log in with your new password.",
    });
  } catch (error) {
    console.error("Failed to reset password:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
