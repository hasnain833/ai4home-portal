import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { MailService } from "@/lib/mail-service";

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ message: "Email is required" }, { status: 400 });
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return NextResponse.json(
        { message: "No account found with this email address" },
        { status: 404 }
      );
    }

    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    console.log(`[PASSWORD RESET OTP GENERATED] Email: ${email} | OTP: ${otp}`);
    
    // Send OTP via SMTP
    const emailResult = await MailService.sendPasswordResetOtp(email, otp);
    
    if (!emailResult.success) {
      console.warn("Failed to send email via SMTP. Make sure SMTP_USER and SMTP_PASS are set in .env");
    }

    return NextResponse.json({ 
      success: true, 
      otp, // Return to client for Option 1 state verification
      message: "Password reset verification code sent to your email" 
    });
  } catch (error) {
    console.error("Failed to send password reset OTP:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
