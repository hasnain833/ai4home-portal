import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ message: "Email is required" }, { status: 400 });
    }

    // Use the Service Role Key to bypass RLS and generate a recovery link
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Generate the recovery link
    // It will redirect the user to the update password page on the frontend
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: {
        redirectTo: "http://localhost:3000/forgot-password/update"
      }
    });

    if (error) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }

    const actionLink = data.properties?.action_link;
    if (!actionLink) {
      return NextResponse.json({ message: "Failed to generate action link" }, { status: 500 });
    }

    // Send the custom email with Nodemailer
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: `"Ai.Lumen Warranty Care" <${process.env.SENDER_EMAIL}>`,
      to: email,
      subject: "Password Reset Request",
      text: `Please reset your password by clicking this link: ${actionLink}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #c59b4c;">Ai.Lumen Warranty Care</h2>
          <p>Hi,</p>
          <p>We received a request to reset your password. Click the button below to choose a new password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${actionLink}" style="background-color: #c59b4c; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Reset Password</a>
          </div>
          <p style="color: #666; font-size: 12px; margin-top: 20px;">If you did not request a password reset, please safely ignore this email.</p>
        </div>
      `,
    });

    return NextResponse.json({ message: "Password reset link sent successfully" });
  } catch (error) {
    console.error("Recovery link error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
