import prisma from "../lib/prisma.js";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

// Initialize Supabase Admin client
const getSupabaseAdmin = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Missing Supabase credentials");
  }
  return createClient(supabaseUrl, supabaseServiceKey);
};

export const getCompanies = async (req, res) => {
  try {
    const session = req.user;

    // Only Super Admin can fetch all companies
    if (!session || session.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Fetch all companies along with their user counts and integration counts
    const companies = await prisma.company.findMany({
      include: {
        _count: {
          select: {
            users: true,
            integrations: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json(companies);
  } catch (error) {
    console.error("Error fetching companies:", error);
    return res.status(500).json({ message: "Error fetching companies" });
  }
};

export const updateCompanyWorkspaces = async (req, res) => {
  try {
    const session = req.user;
    if (!session || session.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const { companyId } = req.params;
    const { warrantyEnabled, salesEnabled } = req.body;

    if (warrantyEnabled === undefined && salesEnabled === undefined) {
      return res
        .status(400)
        .json({ message: "No workspace settings provided" });
    }

    const updateData = {};
    if (typeof warrantyEnabled === "boolean")
      updateData.warrantyEnabled = warrantyEnabled;
    if (typeof salesEnabled === "boolean")
      updateData.salesEnabled = salesEnabled;

    const company = await prisma.company.update({
      where: { id: companyId },
      data: updateData,
    });

    return res.json(company);
  } catch (error) {
    console.error("Failed to update company workspace settings:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getStaff = async (req, res) => {
  try {
    const session = req.user;
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const staff = await prisma.user.findMany({
      where: {
        companyId: session.companyId,
        role: "STAFF",
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        avatar: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(staff);
  } catch (error) {
    console.error("Failed to list staff:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const createStaff = async (req, res) => {
  try {
    const session = req.user;
    if (!session || session.role !== "ADMIN") {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ message: "Name, email, and password are required" });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res
        .status(400)
        .json({ message: "An account with this email already exists" });
    }

    // 1. Create user in Supabase Auth
    const supabaseAdmin = getSupabaseAdmin();
    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name },
      });

    if (authError) {
      console.error("Supabase auth creation error:", authError);
      return res.status(400).json({
        message: authError.message || "Failed to create authentication account",
      });
    }

    // 2. Create user in Prisma DB
    const hashedPassword = await bcrypt.hash(password, 10);
    const newStaff = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword, // Hash using bcrypt
        role: "STAFF",
        companyId: session.companyId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        avatar: true,
      },
    });

    return res.status(201).json(newStaff);
  } catch (error) {
    console.error("Failed to create staff member:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateStaff = async (req, res) => {
  try {
    const session = req.user;
    if (!session || session.role !== "ADMIN") {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const { staffId, name, email, password } = req.body;

    if (!staffId || !name || !email) {
      return res
        .status(400)
        .json({ message: "Staff ID, name, and email are required" });
    }

    // Verify the staff belongs to the admin's company and has role STAFF
    const staff = await prisma.user.findFirst({
      where: { id: staffId, companyId: session.companyId, role: "STAFF" },
    });

    if (!staff) {
      return res.status(404).json({ message: "Staff member not found" });
    }

    // If email is changing, make sure it is not taken by anyone else
    if (email !== staff.email) {
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res
          .status(400)
          .json({ message: "An account with this email already exists" });
      }
    }

    // 1. Find corresponding Supabase Auth user
    const supabaseAdmin = getSupabaseAdmin();
    const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
    const supabaseUser = usersData.users.find((u) => u.email === staff.email);

    if (!supabaseUser) {
      return res
        .status(404)
        .json({ message: "Supabase user not found for this staff email" });
    }

    // 2. Update Supabase Auth user
    const updateData = {
      email,
      user_metadata: { name },
      email_confirm: true,
    };

    if (password) {
      if (password.length < 8) {
        return res
          .status(400)
          .json({ message: "Password must be at least 8 characters" });
      }
      updateData.password = password;
    }

    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
      supabaseUser.id,
      updateData,
    );

    if (authError) {
      console.error("Supabase auth update error:", authError);
      return res.status(400).json({
        message: authError.message || "Failed to update authentication account",
      });
    }

    // 3. Update Prisma DB user
    const dbUpdateData = {
      name,
      email,
    };

    if (password) {
      dbUpdateData.password = await bcrypt.hash(password, 10);
    }

    const updatedStaff = await prisma.user.update({
      where: { id: staffId },
      data: dbUpdateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        avatar: true,
      },
    });

    return res.json(updatedStaff);
  } catch (error) {
    console.error("Failed to update staff member:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteStaff = async (req, res) => {
  try {
    const session = req.user;
    if (!session || session.role !== "ADMIN") {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const staffId = req.body.staffId;
    if (!staffId) {
      return res.status(400).json({ message: "Staff ID is required" });
    }

    // Verify the staff belongs to the admin's company
    const staff = await prisma.user.findFirst({
      where: { id: staffId, companyId: session.companyId, role: "STAFF" },
    });

    if (!staff) {
      return res.status(404).json({ message: "Staff member not found" });
    }

    // 1. Delete from Supabase Auth
    const supabaseAdmin = getSupabaseAdmin();
    const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
    const supabaseUser = usersData.users.find((u) => u.email === staff.email);

    if (supabaseUser) {
      await supabaseAdmin.auth.admin.deleteUser(supabaseUser.id);
    }

    // 2. Delete from Prisma DB
    await prisma.user.delete({ where: { id: staffId } });

    return res.json({ success: true });
  } catch (error) {
    console.error("Failed to delete staff member:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
