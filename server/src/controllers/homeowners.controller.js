import prisma from "../lib/prisma.js";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import crypto from "crypto";

// Initialize Supabase Admin client
const getSupabaseAdmin = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Missing Supabase credentials");
  }
  return createClient(supabaseUrl, supabaseServiceKey);
};

export const getHomeowners = async (req, res) => {
  try {
    const session = req.user;
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return res.status(403).json({ message: "Forbidden" });
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

    return res.json(homeowners);
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const createHomeowner = async (req, res) => {
  try {
    const session = req.user;
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: "Email already in use" });
    }

    // Generate a cryptographically secure random password for database validation
    const systemPassword = crypto.randomUUID();
    const hashedPassword = await bcrypt.hash(systemPassword, 10);

    // Create user in Prisma DB only (no login account required)
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

    return res.json(homeowner);
  } catch (error) {
    console.error("Failed to create homeowner:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteHomeowner = async (req, res) => {
  try {
    const session = req.user;
    if (!session || session.role !== "ADMIN") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { homeownerId } = req.body;

    if (!homeownerId) {
      return res.status(400).json({ message: "Missing homeowner ID" });
    }

    // Find the homeowner record
    const homeowner = await prisma.user.findFirst({
      where: { id: homeownerId, companyId: session.companyId, role: "HOMEOWNER" }
    });

    if (!homeowner) {
      return res.status(404).json({ message: "Homeowner not found" });
    }

    // 1. Delete from Supabase Auth
    const supabaseAdmin = getSupabaseAdmin();
    const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
    const supabaseUser = usersData.users.find(u => u.email === homeowner.email);

    if (supabaseUser) {
      await supabaseAdmin.auth.admin.deleteUser(supabaseUser.id);
    }

    // 2. Delete from Prisma DB
    await prisma.user.delete({
      where: { id: homeownerId },
    });

    return res.json({ message: "Homeowner deleted" });
  } catch (error) {
    console.error("Failed to delete homeowner:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
