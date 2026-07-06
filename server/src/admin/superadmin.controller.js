import prisma from "../lib/prisma.js";

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
