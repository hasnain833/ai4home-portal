import { toE164 } from "../services/sms.service.js";
import prisma from "../lib/prisma.js";
import { createHomeownerAccount, getSupabaseAdmin } from "../lib/homeowner-account.js";
import bcrypt from "bcryptjs";
import { sendHomeownerWelcome } from "./leads.controller.js";
import { assertUploadSafe, buildStorageKey, UploadRejected } from "../lib/file-security.js";
import { BUCKETS, uploadObject, resolveDownloadUrl, deleteObject } from "../lib/storage.js";

// Signed long enough to outlive a working session on the Homeowners page.
const HOUSE_PHOTO_TTL = 60 * 60;

const PROPERTY_SELECT = {
  id: true,
  address: true,
  city: true,
  state: true,
  zipCode: true,
  coeDate: true,
  coverageTerm: true,
  photoUrl: true,
  community: { select: { name: true } },
};

async function withSignedPhoto(property) {
  if (!property) return null;
  return { ...property, photoUrl: await resolveDownloadUrl(property.photoUrl, { expiresIn: HOUSE_PHOTO_TTL }) };
}

export const getHomeowners = async (req, res) => {
  try {
    const session = req.user;
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const homeowners = await prisma.user.findMany({
      where: {
        companyId: session.companyId,
        role: "HOMEOWNER",
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        hasSalesAccess: true,
        createdAt: true,
        properties: { select: PROPERTY_SELECT, take: 1 },
      },
      orderBy: { createdAt: "desc" },
    });

    // One home per homeowner, so flatten the list to a single `property`.
    const result = await Promise.all(
      homeowners.map(async ({ properties, ...h }) => ({ ...h, property: await withSignedPhoto(properties[0]) })),
    );
    return res.json(result);
  } catch {
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

    if (!name || !email) {
      return res.status(400).json({ message: "Name and email are required" });
    }

    const phone = toE164(req.body.phone);
    if (phone === undefined) return res.status(400).json({ message: "Enter a valid phone number, e.g. (555) 123-4567 or +15551234567" });

    if (password && password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters" });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: "Email already in use" });
    }

    let homeowner;
    try {
      homeowner = await createHomeownerAccount({ name, email, phone, companyId: session.companyId, password: password || null });
    } catch (err) {
      if (err.status === 400) return res.status(400).json({ message: err.message });
      throw err;
    }

    // No password typed: the homeowner chooses their own from the welcome email.
    if (!password) {
      try {
        await sendHomeownerWelcome(session.companyId, homeowner.id);
      } catch (err) {
        console.error("[Homeowners] welcome email failed:", err.message);
        return res.status(201).json({
          ...homeowner,
          notice: "Homeowner added, but the welcome email did not send. They can use \"Forgot password\" on the sign-in page.",
        });
      }
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
        companyId: session.companyId,
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
    const { name, email, password, phone, hasSalesAccess } = req.body;

    const existingHomeowner = await prisma.user.findFirst({
      where: {
        id,
        companyId: session.companyId,
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

    const emailChanging = Boolean(email && email !== existingHomeowner.email);
    const touchesAuth = emailChanging || Boolean(password) || Boolean(name);

    if (touchesAuth) {
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
    }

    // 2. Update Prisma DB user
    const dbUpdateData = {};
    if (name) dbUpdateData.name = name;
    if (email) dbUpdateData.email = email;
    if (password) dbUpdateData.password = await bcrypt.hash(password, 10);
    // Phone lives only in our own table — Supabase auth is not involved, and an
    // empty string is a deliberate "clear it" rather than "leave it alone".
    if (phone !== undefined) {
      const e164 = toE164(phone);
      if (e164 === undefined) return res.status(400).json({ message: "Enter a valid phone number, e.g. (555) 123-4567 or +15551234567" });
      dbUpdateData.phone = e164;
    }

    // Sales workspace access for a homeowner (SRS 4.12). Only a builder admin
    // may grant it — staff can edit homeowner details but not widen access.
    if (typeof hasSalesAccess === "boolean") {
      if (session.role !== "ADMIN") {
        return res
          .status(403)
          .json({ message: "Only a workspace admin can change Sales access." });
      }
      if (hasSalesAccess) {
        // A tenant cannot grant access to a workspace it is not entitled to.
        const company = await prisma.company.findUnique({
          where: { id: session.companyId },
          select: { salesEnabled: true },
        });
        if (!company?.salesEnabled) {
          return res.status(400).json({
            message:
              "The Sales workspace is not enabled for this company, so access cannot be granted.",
          });
        }
      }
      dbUpdateData.hasSalesAccess = hasSalesAccess;
    }

    const updatedHomeowner = await prisma.user.update({
      where: { id },
      data: dbUpdateData,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        hasSalesAccess: true,
        createdAt: true,
      },
    });

    return res.json(updatedHomeowner);
  } catch (error) {
    console.error("Failed to update homeowner:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

async function findHomeownerProperty(session, homeownerId) {
  return prisma.property.findFirst({
    where: { homeownerId, homeowner: { companyId: session.companyId, role: "HOMEOWNER" } },
    select: { id: true, photoUrl: true },
  });
}

// One exterior photo per house. Kept private: a picture tied to a home address.
export const uploadHousePhoto = async (req, res) => {
  try {
    const session = req.user;
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return res.status(403).json({ message: "Forbidden" });
    }
    if (!req.file) return res.status(400).json({ message: "No photo provided" });

    const property = await findHomeownerProperty(session, req.params.id);
    if (!property) return res.status(404).json({ message: "This homeowner has no property yet. Add one in Properties first." });

    await assertUploadSafe(req.file, "image");
    const { ref } = await uploadObject({
      bucket: BUCKETS.warrantyPhotos,
      key: buildStorageKey(`${session.companyId}/houses/${property.id}`, req.file.originalname, "house.jpg"),
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
    });

    const updated = await prisma.property.update({ where: { id: property.id }, data: { photoUrl: ref }, select: PROPERTY_SELECT });
    if (property.photoUrl) await deleteObject(property.photoUrl);
    return res.json(await withSignedPhoto(updated));
  } catch (error) {
    if (error instanceof UploadRejected) return res.status(error.status).json({ message: error.message, code: error.code });
    console.error("Failed to upload house photo:", error);
    return res.status(500).json({ message: "Could not upload the photo" });
  }
};

export const deleteHousePhoto = async (req, res) => {
  try {
    const session = req.user;
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const property = await findHomeownerProperty(session, req.params.id);
    if (!property) return res.status(404).json({ message: "Property not found" });

    const updated = await prisma.property.update({ where: { id: property.id }, data: { photoUrl: null }, select: PROPERTY_SELECT });
    if (property.photoUrl) await deleteObject(property.photoUrl);
    return res.json(updated);
  } catch (error) {
    console.error("Failed to remove house photo:", error);
    return res.status(500).json({ message: "Could not remove the photo" });
  }
};
