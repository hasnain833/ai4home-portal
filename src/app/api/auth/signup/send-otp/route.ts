import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { MailService } from "@/lib/mail-service";

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ message: "Email is required" }, { status: 400 });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { message: "Account with this email already exists" },
        { status: 400 }
      );
    }

    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    console.log(`[SIGNUP OTP GENERATED] Email: ${email} | OTP: ${otp}`);
    
    // Send OTP via Brevo
    const emailResult = await MailService.sendVerificationOtp(email, otp);
    
    if (!emailResult.success) {
      console.warn("Failed to send email via Brevo. Make sure BREVO_API_KEY is set in .env");
    }

    return NextResponse.json({ 
      success: true, 
      otp, // Return to client for Option 1 state verification
      message: "OTP sent successfully to your email" 
    });
  } catch (error) {
    console.error("Failed to send OTP:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
