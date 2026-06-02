import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const { companyName, companyEmail, password, companyPhone, companyAddress } = await request.json();

    if (!companyName || !companyEmail || !password) {
      return NextResponse.json({ message: "Missing required fields" }, { status: 400 });
    }

    // Check if user already exists locally
    const existingUser = await prisma.user.findUnique({ where: { email: companyEmail } });
    if (existingUser) {
      return NextResponse.json({ message: "User already exists" }, { status: 400 });
    }

    // 1. Hash the password for the local database (just like the older users)
    const hashedPassword = await bcrypt.hash(password, 10);

    // 2. Create the Company and User in the local Prisma Database FIRST
    const newCompany = await prisma.company.create({
      data: {
        name: companyName,
        email: companyEmail,
        phone: companyPhone || null,
        address: companyAddress || null,
      }
    });

    await prisma.user.create({
      data: {
        email: companyEmail,
        password: hashedPassword, // Saving the hashed password!
        name: companyName,
        role: "ADMIN",
        companyId: newCompany.id,
      }
    });

    // 3. Use the Service Role Key to bypass RLS and generate a signup link via Supabase
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Generate the signup link (Supabase handles creating the user in an unverified state)
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "signup",
      email: companyEmail,
      password,
      options: {
        data: {
          name: companyName,
          role: "ADMIN",
          companyName,
          companyEmail,
          companyPhone,
          companyAddress
        },
      },
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
      to: companyEmail,
      subject: "Verify Your Account",
      text: `Please verify your account by clicking this link: ${actionLink}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #c59b4c;">Welcome to Ai.Lumen Warranty Care!</h2>
          <p>Hi ${companyName},</p>
          <p>Thank you for signing up. Please click the button below to verify your email address and activate your account:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${actionLink}" style="background-color: #c59b4c; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Verify Email Address</a>
          </div>
          <p style="color: #666; font-size: 12px; margin-top: 20px;">If you did not request this, please safely ignore this email.</p>
        </div>
      `,
    });

    return NextResponse.json({ message: "Verification email sent successfully" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("Signup link error:", error);
    return NextResponse.json({ message }, { status: 500 });
  }
}
