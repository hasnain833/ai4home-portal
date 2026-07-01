import prisma from "../lib/prisma.js";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import crypto from "crypto";

// Initialize Supabase Admin client
const getSupabaseAdmin = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
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

    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required" });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters" });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: "Email already in use" });
    }

    // 1. Create Supabase Auth account — email_confirm: true means account is immediately active, no invite needed
    const supabaseAdmin = getSupabaseAdmin();
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });

    if (authError) {
      console.error("[Homeowner] Supabase auth creation error:", authError);
      return res.status(400).json({ message: authError.message || "Failed to create authentication account" });
    }

    // 2. Create user in Prisma DB
    const hashedPassword = await bcrypt.hash(password, 10);
    let homeowner;
    try {
      homeowner = await prisma.user.create({
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
        },
      });
    } catch (dbError) {
      // Rollback: delete the Supabase user if DB insert fails
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      throw dbError;
    }

    return res.status(201).json(homeowner);
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

export const getHomeowner = async (req, res) => {
  try {
    const session = req.user;
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { id } = req.params;

    const homeowner = await prisma.user.findFirst({
      where: {
        id,
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
    });

    if (!homeowner) {
      return res.status(404).json({ message: "Homeowner not found" });
    }

    return res.json(homeowner);
  } catch (error) {
    console.error("Error fetching homeowner:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateHomeowner = async (req, res) => {
  try {
    const session = req.user;
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { id } = req.params;
    const { name, email, password } = req.body;

    const existingHomeowner = await prisma.user.findFirst({
      where: {
        id,
        companyId: session.companyId || "demo-company",
        role: "HOMEOWNER",
      },
    });

    if (!existingHomeowner) {
      return res.status(404).json({ message: "Homeowner not found" });
    }

    // If email is changing, check for duplicates in DB
    if (email && email !== existingHomeowner.email) {
      const emailTaken = await prisma.user.findUnique({ where: { email } });
      if (emailTaken) {
        return res.status(400).json({ message: "Email already in use" });
      }
    }

    // 1. Find corresponding Supabase Auth user
    const supabaseAdmin = getSupabaseAdmin();
    const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
    const supabaseUser = usersData.users.find(u => u.email === existingHomeowner.email);

    if (supabaseUser) {
      const updateData = {};
      if (email) updateData.email = email;
      if (name) updateData.user_metadata = { name };
      if (password) {
        if (password.length < 8) {
          return res.status(400).json({ message: "Password must be at least 8 characters" });
        }
        updateData.password = password;
      }

      if (Object.keys(updateData).length > 0) {
        const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
          supabaseUser.id,
          updateData
        );
        if (authError) {
          console.error("[Homeowner] Supabase auth update error:", authError);
          return res.status(400).json({ message: authError.message || "Failed to update authentication account" });
        }
      }
    }

    // 2. Update Prisma DB user
    const dbUpdateData = {};
    if (name) dbUpdateData.name = name;
    if (email) dbUpdateData.email = email;
    if (password) dbUpdateData.password = await bcrypt.hash(password, 10);

    const updatedHomeowner = await prisma.user.update({
      where: { id },
      data: dbUpdateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    return res.json(updatedHomeowner);
  } catch (error) {
    console.error("Failed to update homeowner:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
