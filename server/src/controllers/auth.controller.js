import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import crypto from "crypto";
import prisma from "../lib/prisma.js";
import { createSuperadminSessionToken } from "../lib/superadmin-session.js";
import { resolveDownloadUrl } from "../lib/storage.js";
import { sendSms, smsSent } from "../services/sms.service.js";
import { MailService } from "../services/mail-service.js";
import { Templates, SmsTemplates } from "../services/templates.js";

const safeEqual = (a, b) => {
  const ab = Buffer.from(String(a ?? ""), "utf8");
  const bb = Buffer.from(String(b ?? ""), "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
};

// Initialize Supabase Admin client
const getSupabaseAdmin = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Missing Supabase credentials");
  }
  return createClient(supabaseUrl, supabaseServiceKey);
};

export const getMe = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (req.user.isSuperAdmin && req.user.id === "env-superadmin") {
      return res.json({
        id: "env-superadmin",
        email: req.user.email,
        name: req.user.name || "Super Admin",
        role: "admin",
        isSuperAdmin: true,
        hasWarrantyAccess: true,
        hasSalesAccess: true,
        verificationStatus: "VERIFIED",
        verificationDocUrl: null,
        companyLogo: null,
        companyName: "System Administration",
        avatar: null,
        online: true,
      });
    }

    const dbUser = await prisma.user.findUnique({
      where: { email: req.user.email },
      include: { company: true, properties: true },
    });

    if (!dbUser) {
      return res
        .status(404)
        .json({ message: "User profile not found in local database." });
    }

    const isAdmin = dbUser.role === "ADMIN" || dbUser.role === "SUPER_ADMIN";
    const isSuperAdmin = dbUser.role === "SUPER_ADMIN";
    const isStaff = dbUser.role === "STAFF";
    const avatarUrl = isAdmin
      ? dbUser.company?.logo || null
      : dbUser.avatar || null;

    const companyWarrantyEnabled = dbUser.company?.warrantyEnabled ?? true;
    const companySalesEnabled = dbUser.company?.salesEnabled ?? true;

    const hasWarrantyAccess = isSuperAdmin
      ? true
      : (isAdmin || isStaff || dbUser.hasWarrantyAccess) &&
        companyWarrantyEnabled;
    const hasSalesAccess = isSuperAdmin
      ? true
      : (isAdmin || isStaff || dbUser.hasSalesAccess) && companySalesEnabled;

    const verificationStatus = isSuperAdmin
      ? "VERIFIED"
      : dbUser.company?.verificationStatus || "VERIFIED";

    return res.json({
      ...dbUser,
      hasWarrantyAccess,
      hasSalesAccess,
      verificationStatus,
      // NFR-S-006: stored as a private storage reference — sign it for display.
      verificationDocUrl: await resolveDownloadUrl(
        dbUser.company?.verificationDocUrl,
      ),
      avatar: avatarUrl,
      companyLogo: dbUser.company?.logo || null,
      companyName: dbUser.company?.name || null,
      role: isSuperAdmin ? "admin" : dbUser.role.toLowerCase(),
      isSuperAdmin,
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

    const { name, avatar, email, lastActiveWorkspace } = req.body;

    const updateData = {};
    if (name) updateData.name = name;
    if (avatar !== undefined) updateData.avatar = avatar;
    if (lastActiveWorkspace)
      updateData.lastActiveWorkspace = lastActiveWorkspace;

    if (email && email.toLowerCase() !== req.user.email.toLowerCase()) {
      const emailLower = email.toLowerCase();
      // 1. Verify email is not already taken in DB
      const existingUser = await prisma.user.findUnique({
        where: { email: emailLower },
      });
      if (existingUser) {
        return res
          .status(400)
          .json({ message: "An account with this email already exists" });
      }

      // 2. Find corresponding Supabase Auth user
      const supabaseAdmin = getSupabaseAdmin();
      const { data: usersData, error: listError } =
        await supabaseAdmin.auth.admin.listUsers();
      if (listError) {
        console.error("Supabase user list error:", listError);
        return res
          .status(500)
          .json({ message: "Failed to verify authentication account" });
      }

      const supabaseUser = usersData.users.find(
        (u) => u.email.toLowerCase() === req.user.email.toLowerCase(),
      );

      if (!supabaseUser) {
        return res
          .status(404)
          .json({ message: "Supabase user not found for current email" });
      }

      // 3. Update Supabase Auth user email and automatically confirm it
      const { error: authError } =
        await supabaseAdmin.auth.admin.updateUserById(supabaseUser.id, {
          email: emailLower,
          email_confirm: true,
        });

      if (authError) {
        console.error("Supabase auth email update error:", authError);
        return res.status(400).json({
          message:
            authError.message || "Failed to update authentication account",
        });
      }

      updateData.email = emailLower;
    }

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
        avatar: true,
        lastActiveWorkspace: true,
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

export const superadminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    const envEmail = process.env.SUPERADMIN_EMAIL;
    const envPassword = process.env.SUPERADMIN_PASSWORD;
    const emailMatches =
      !!envEmail &&
      String(email).trim().toLowerCase() === envEmail.trim().toLowerCase();

    if (
      envEmail &&
      envPassword &&
      emailMatches &&
      safeEqual(password, envPassword)
    ) {
      const token = createSuperadminSessionToken({
        id: "env-superadmin",
        email: email,
        name: "Super Admin",
        role: "SUPER_ADMIN",
        companyId: null,
      });

      const secureCookie = process.env.NODE_ENV === "production";
      res.cookie("superadmin_session", token, {
        httpOnly: true,
        secure: secureCookie,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 1000,
      });

      return res.json({ message: "Authenticated", isSuperAdmin: true });
    }

    const dbUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!dbUser || dbUser.role !== "SUPER_ADMIN") {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const passwordMatch = await bcrypt.compare(password, dbUser.password);
    if (!passwordMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = createSuperadminSessionToken({
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name || "Super Admin",
      role: dbUser.role,
      companyId: dbUser.companyId || null,
    });

    const secureCookie = process.env.NODE_ENV === "production";
    res.cookie("superadmin_session", token, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 1000,
    });

    return res.json({ message: "Authenticated", isSuperAdmin: true });
  } catch (error) {
    console.error("Superadmin login error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const logout = async (req, res) => {
  res.clearCookie("superadmin_session", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  return res.json({ message: "Logged out" });
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
        warrantyEnabled: true,
        salesEnabled: false,
        verificationStatus: "PENDING",
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
      process.env.SUPABASE_SERVICE_ROLE_KEY,
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

    // Registration mail is platform-owned — the tenant has no SMTP config yet.
    const verificationMail = await MailService.sendEmail({
      to: companyEmail,
      subject: "Verify Your Account",
      html: Templates.getSignupVerificationEmail(companyName, actionLink),
      allowPlatformSender: true,
    });

    if (!verificationMail.success) {
      console.error(
        "Email send failure, rolling back registration:",
        verificationMail.error,
      );
      await prisma.user.delete({ where: { email: companyEmail } });
      await prisma.company.delete({ where: { id: newCompany.id } });

      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
      const supabaseUser = usersData.users.find(
        (u) => u.email === companyEmail,
      );
      if (supabaseUser) {
        await supabaseAdmin.auth.admin.deleteUser(supabaseUser.id);
      }

      return res.status(500).json({
        message:
          "Failed to send verification email. Account creation rolled back.",
      });
    }

    try {
      const adminNotifyEmail = process.env.ADMIN_NOTIFY_EMAIL;
      const adminNotifyPhone = process.env.ADMIN_NOTIFY_PHONE;
      const adminUrl = `${process.env.NEXT_PUBLIC_URL || ""}/admin/verifications`;

      if (adminNotifyEmail) {
        await MailService.sendEmail({
          to: adminNotifyEmail,
          subject: `New tenant registration: ${companyName}`,
          html: Templates.getAdminNewTenantEmail(companyName, companyEmail, companyPhone, adminUrl),
          allowPlatformSender: true,
        });
      } else {
        console.warn(
          "[Signup] ADMIN_NOTIFY_EMAIL missing - skipping admin email notification.",
        );
      }

      if (adminNotifyPhone) {
        const adminSms = await sendSms({
          to: adminNotifyPhone,
          tag: "tenant-registration",
          body: SmsTemplates.getAdminNewTenantSms(companyName, companyEmail, companyPhone),
          smsConfig: "SYSTEM",
        });
        if (!smsSent(adminSms)) {
          console.warn(
            `[Signup] Admin SMS not delivered (${adminSms.outcome}): ${adminSms.error}`,
          );
        }
      } else {
        console.warn(
          "[Signup] ADMIN_NOTIFY_PHONE missing - skipping admin SMS notification.",
        );
      }
    } catch (adminMailError) {
      console.error(
        "[Signup] Failed to notify admin of new registration:",
        adminMailError,
      );
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

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
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
      from: `"Aiforhomebuilder" <${process.env.SENDER_EMAIL}>`,
      to: email,
      subject: "Password Reset Request",
      text: `Please reset your password by clicking this link: ${actionLink}`,
      html: Templates.getForgotPasswordEmail(actionLink),
    });

    return res.json({ message: "Password reset link sent successfully" });
  } catch (error) {
    console.error("Recovery link error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
