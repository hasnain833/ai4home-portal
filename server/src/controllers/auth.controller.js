import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import prisma from "../lib/prisma.js";

export const getMe = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const dbUser = await prisma.user.findUnique({
      where: { email: req.user.email },
      include: { company: true },
    });

    if (!dbUser) {
      return res
        .status(404)
        .json({ message: "User profile not found in local database." });
    }

    const isAdmin = dbUser.role === "ADMIN";
    const isStaff = dbUser.role === "STAFF";
    const avatarUrl = isAdmin
      ? dbUser.company?.logo || null
      : dbUser.avatar || null;

    const hasWarrantyAccess =
      isAdmin || isStaff ? true : dbUser.hasWarrantyAccess;
    const hasSalesAccess = isAdmin || isStaff ? true : dbUser.hasSalesAccess;

    return res.json({
      ...dbUser,
      hasWarrantyAccess,
      hasSalesAccess,
      avatar: avatarUrl,
      companyLogo: dbUser.company?.logo || null,
      companyName: dbUser.company?.name || null,
      role: dbUser.role.toLowerCase(),
      online: true,
    });
  } catch (error) {
    console.error("Auth me error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateProfile = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { name, avatar } = req.body;

    const updateData = {};
    if (name) updateData.name = name;
    if (avatar !== undefined) updateData.avatar = avatar;

    if (Object.keys(updateData).length === 0) {
      return res.status(200).json({ message: "No db fields updated" });
    }

    const updatedDbUser = await prisma.user.update({
      where: { email: req.user.email },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        companyId: true,
      },
    });

    return res.json({
      ...updatedDbUser,
      role: updatedDbUser.role.toLowerCase(),
    });
  } catch (error) {
    console.error("Profile update error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const signup = async (req, res) => {
  try {
    const {
      companyName,
      companyEmail,
      password,
      companyPhone,
      companyAddress,
    } = req.body;

    if (!companyName || !companyEmail || !password) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: companyEmail },
    });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newCompany = await prisma.company.create({
      data: {
        name: companyName,
        email: companyEmail,
        phone: companyPhone || null,
        address: companyAddress || null,
      },
    });

    await prisma.user.create({
      data: {
        email: companyEmail,
        password: hashedPassword,
        name: companyName,
        role: "ADMIN",
        companyId: newCompany.id,
      },
    });

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "signup",
      email: companyEmail,
      password,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_URL}/login?signup=success`,
        data: {
          name: companyName,
          role: "ADMIN",
          companyName,
          companyEmail,
          companyPhone,
          companyAddress,
        },
      },
    });

    if (error) {
      await prisma.user.delete({ where: { email: companyEmail } });
      await prisma.company.delete({ where: { id: newCompany.id } });
      return res.status(400).json({ message: error.message });
    }

    const actionLink = data.properties?.action_link;
    if (!actionLink) {
      await prisma.user.delete({ where: { email: companyEmail } });
      await prisma.company.delete({ where: { id: newCompany.id } });
      return res
        .status(500)
        .json({ message: "Failed to generate action link" });
    }

    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: false,
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
    } catch (mailError) {
      console.error(
        "Email send failure, rolling back registration:",
        mailError
      );
      await prisma.user.delete({ where: { email: companyEmail } });
      await prisma.company.delete({ where: { id: newCompany.id } });

      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
      const supabaseUser = usersData.users.find(
        (u) => u.email === companyEmail
      );
      if (supabaseUser) {
        await supabaseAdmin.auth.admin.deleteUser(supabaseUser.id);
      }

      return res
        .status(500)
        .json({
          message:
            "Failed to send verification email. Account creation rolled back.",
        });
    }

    return res.json({ message: "Verification email sent successfully" });
  } catch (error) {
    console.error("Signup link error:", error);
    return res
      .status(500)
      .json({ message: error.message || "Internal server error" });
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res
        .status(404)
        .json({ message: "No account found with this email address." });
    }

    // All roles are allowed to reset their password
    // if (user.role !== "ADMIN") {
    //   return res
    //     .status(403)
    //     .json({ message: "Only administrators are allowed to reset passwords." });
    // }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_URL}/forgot-password/update`,
      },
    });

    if (error) {
      return res.status(400).json({ message: error.message });
    }

    const actionLink = data.properties?.action_link;
    if (!actionLink) {
      return res
        .status(500)
        .json({ message: "Failed to generate action link" });
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
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

    return res.json({ message: "Password reset link sent successfully" });
  } catch (error) {
    console.error("Recovery link error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
