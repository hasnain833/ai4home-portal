import prisma from "../lib/prisma.js";
import { MailService } from "../services/mail-service.js";

export const getCompanies = async (req, res) => {
  try {
    const session = req.user;

    if (!session || !session.isSuperAdmin) {
      return res.status(403).json({ message: "Unauthorized" });
    }

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

export const getUsers = async (req, res) => {
  try {
    const session = req.user;
    if (!session || !session.isSuperAdmin) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const users = await prisma.user.findMany({
      include: {
        company: {
          select: {
            id: true,
            name: true,
            logo: true,
            warrantyEnabled: true,
            salesEnabled: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const payload = users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
      companyName: user.company?.name || "Global Super Admin",
      companyLogo: user.company?.logo || null,
      warrantyEnabled: user.company?.warrantyEnabled ?? true,
      salesEnabled: user.company?.salesEnabled ?? true,
      hasWarrantyAccess:
        user.role === "SUPER_ADMIN" ? true : user.hasWarrantyAccess,
      hasSalesAccess: user.role === "SUPER_ADMIN" ? true : user.hasSalesAccess,
      lastActiveWorkspace: user.lastActiveWorkspace,
      createdAt: user.createdAt,
      accountStatus:
        user.role === "SUPER_ADMIN"
          ? "Super Admin"
          : user.company
            ? user.company.warrantyEnabled || user.company.salesEnabled
              ? "Active"
              : "Paused"
            : "Unknown",
    }));

    return res.json(payload);
  } catch (error) {
    console.error("Error fetching users for Super Admin:", error);
    return res.status(500).json({ message: "Error fetching users" });
  }
};

export const updateCompanyWorkspaces = async (req, res) => {
  try {
    const session = req.user;
    if (!session || !session.isSuperAdmin) {
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
    if (typeof warrantyEnabled === "boolean") {
      updateData.warrantyEnabled = warrantyEnabled;
    }
    if (typeof salesEnabled === "boolean") {
      updateData.salesEnabled = salesEnabled;
    }

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

// Super Admin reviews a submitted verification document and approves or rejects
// the tenant. Approving unlocks (unblurs) their warranty workspace.
export const verifyCompany = async (req, res) => {
  try {
    const session = req.user;
    if (!session || !session.isSuperAdmin) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const { companyId } = req.params;
    const { action } = req.body; // "approve" | "reject"

    const existing = await prisma.company.findUnique({ where: { id: companyId } });
    if (!existing) {
      return res.status(404).json({ message: "Company not found" });
    }

    if (action === "reject") {
      // Send the tenant back to PENDING so they can re-upload a valid document.
      const company = await prisma.company.update({
        where: { id: companyId },
        data: {
          verificationStatus: "PENDING",
          verificationDocUrl: null,
          verificationSubmittedAt: null,
          verifiedAt: null,
        },
      });
      return res.json(company);
    }

    // Default: approve.
    const company = await prisma.company.update({
      where: { id: companyId },
      data: {
        verificationStatus: "VERIFIED",
        verifiedAt: new Date(),
        warrantyEnabled: true,
      },
    });

    // Best-effort welcome / activation email to the tenant.
    try {
      if (company.email) {
        const portalUrl = `${process.env.NEXT_PUBLIC_URL || ""}/warranty/dashboard`;
        await MailService.sendEmail({
          to: company.email,
          subject: "Your warranty workspace is now active",
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
              <h2 style="color: #0F3B3D;">You're all set, ${company.name}!</h2>
              <p>Your account has been verified and your <strong>Warranty Care</strong> workspace is now fully unlocked.</p>
              <div style="text-align: center; margin: 24px 0;">
                <a href="${portalUrl}" style="background-color: #0F3B3D; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Open Your Workspace</a>
              </div>
            </div>
          `,
        });
      }
    } catch (mailErr) {
      console.error("[Verification] Failed to send activation email:", mailErr);
    }

    return res.json(company);
  } catch (error) {
    console.error("Failed to verify company:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateUserAccess = async (req, res) => {
  try {
    const session = req.user;
    if (!session || !session.isSuperAdmin) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const { userId } = req.params;
    const { hasWarrantyAccess, hasSalesAccess } = req.body;

    if (hasWarrantyAccess === undefined && hasSalesAccess === undefined) {
      return res
        .status(400)
        .json({ message: "No access settings provided" });
    }

    const updateData = {};
    if (typeof hasWarrantyAccess === "boolean") {
      updateData.hasWarrantyAccess = hasWarrantyAccess;
    }
    if (typeof hasSalesAccess === "boolean") {
      updateData.hasSalesAccess = hasSalesAccess;
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    return res.json(user);
  } catch (error) {
    console.error("Failed to update user access:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
