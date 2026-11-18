import prisma from "../lib/prisma.js";
import { MailService } from "../services/mail-service.js";
import { resolveDownloadUrl } from "../lib/storage.js";
import { Templates } from "../services/templates.js";
import { writeAuditLog } from "../lib/audit.js";
import { forgetCompanySuspension } from "../lib/company-suspension.js";
import { SMS_STATUS, forgetCompanySender, toE164 } from "../services/sms.service.js";
export const getCompanies = async (req, res) => {
  try {
    const session = req.user;

    if (!session || !(session.isSuperAdmin || req.adminAccess === true)) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const [companies, smsCounts, sharedNumberSends] = await Promise.all([
      prisma.company.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.messageUsage.groupBy({
        by: ["companyId"],
        where: { channel: "SMS", outcome: "sent", companyId: { not: null }, createdAt: { gte: monthStart } },
        _count: { _all: true },
      }),
      prisma.messageUsage.groupBy({
        by: ["companyId"],
        where: { channel: "SMS", outcome: "sent", companyId: { not: null }, fromNumber: null },
        _max: { createdAt: true },
      }),
    ]);
    const smsThisMonth = new Map(smsCounts.map((row) => [row.companyId, row._count._all]));
    const lastSharedSms = new Map(sharedNumberSends.map((row) => [row.companyId, row._max.createdAt]));
    const withSignedDocs = await Promise.all(
      companies.map(async (company) => ({
        ...company,
        smsThisMonth: smsThisMonth.get(company.id) || 0,
        smsLastSharedAt: lastSharedSms.get(company.id) || null,
        verificationDocUrl: await resolveDownloadUrl(company.verificationDocUrl, {
          expiresIn: 900,
        }),
        agreementDocUrl: await resolveDownloadUrl(company.agreementDocUrl, {
          expiresIn: 900,
        }),
      })),
    );

    return res.json(withSignedDocs);
  } catch (error) {
    console.error("Error fetching companies:", error);
    return res.status(500).json({ message: "Error fetching companies" });
  }
};

const OVERVIEW_COMPANIES = 6;

/** Totals and newest tenants for the admin home, without signing every company's documents. */
export const getCompaniesOverview = async (req, res) => {
  try {
    const session = req.user;
    if (!session || !(session.isSuperAdmin || req.adminAccess === true)) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const [total, verified, warranty, sales, recent] = await Promise.all([
      prisma.company.count(),
      prisma.company.count({ where: { verificationStatus: "VERIFIED" } }),
      prisma.company.count({ where: { warrantyEnabled: true } }),
      prisma.company.count({ where: { salesEnabled: true } }),
      prisma.company.findMany({
        orderBy: { createdAt: "desc" },
        take: OVERVIEW_COMPANIES,
        select: {
          id: true,
          name: true,
          email: true,
          verificationStatus: true,
          warrantyEnabled: true,
          salesEnabled: true,
        },
      }),
    ]);

    return res.json({ total, verified, warranty, sales, recent });
  } catch (error) {
    console.error("Error fetching companies overview:", error);
    return res.status(500).json({ message: "Error fetching companies overview" });
  }
};

export const getUsers = async (req, res) => {
  try {
    const session = req.user;
    if (!session || !(session.isSuperAdmin || req.adminAccess === true)) {
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
  const session = req.user;
  if (!session || !(session.isSuperAdmin || req.adminAccess === true)) {
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
};

export const verifyCompany = async (req, res) => {
  const session = req.user;
  if (!session || !(session.isSuperAdmin || req.adminAccess === true)) {
    return res.status(403).json({ message: "Unauthorized" });
  }

  const { companyId } = req.params;
  const { action } = req.body; 

  const existing = await prisma.company.findUnique({ where: { id: companyId } });
  if (!existing) {
    return res.status(404).json({ message: "Company not found" });
  }

  if (action === "reject") {
    const company = await prisma.company.update({
      where: { id: companyId },
      data: {
        verificationStatus: "PENDING",
        verificationDocUrl: null,
        verificationSubmittedAt: null,
        verifiedAt: null,
        agreementDocUrl: null,
        agreementSubmittedAt: null,
        agreementVersion: null,
      },
    });
    return res.json(company);
  }

  const company = await prisma.company.update({
    where: { id: companyId },
    data: {
      verificationStatus: "VERIFIED",
      verifiedAt: new Date(),
      warrantyEnabled: true,
      contractSignedAt: existing.contractSignedAt ?? new Date(),
    },
  });

  try {
    if (company.email) {
      const portalUrl = `${process.env.NEXT_PUBLIC_URL || ""}/warranty/dashboard`;
      await MailService.sendEmail({
        to: company.email,
        subject: "Your documents are verified – workspace active",
        html: Templates.getWorkspaceActiveEmail(company.name, portalUrl),
        companyId,
        source: "workspace-activated",
        noReply: true,
      });
    }
  } catch (mailErr) {
    console.error("[Verification] Failed to send activation email:", mailErr);
  }

  return res.json(company);
};

export const updateUserAccess = async (req, res) => {
  const session = req.user;
  if (!session || !(session.isSuperAdmin || req.adminAccess === true)) {
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
};

export const setCompanySuspension = async (req, res) => {
  try {
    if (!req.user?.isSuperAdmin && req.adminAccess !== true) return res.status(403).json({ message: "Unauthorized" });
    if (typeof req.body?.suspended !== "boolean") {
      return res.status(400).json({ message: "suspended must be true or false" });
    }
    const company = await prisma.company.update({
      where: { id: req.params.companyId },
      data: { suspendedAt: req.body.suspended ? new Date() : null },
      select: { id: true, name: true, suspendedAt: true },
    });
    forgetCompanySuspension(company.id);
    await writeAuditLog({
      req,
      action: req.body.suspended ? "COMPANY_SUSPENDED" : "COMPANY_REACTIVATED",
      companyId: company.id,
      targetType: "Company",
      targetId: company.id,
      metadata: { name: company.name },
    });
    return res.json(company);
  } catch (error) {
    if (error?.code === "P2025") return res.status(404).json({ message: "Company not found" });
    console.error("Error updating company suspension:", error);
    return res.status(500).json({ message: "Could not update the company." });
  }
};

/** A builder's own texting number, registered in Telnyx; it sends only once APPROVED. */
export const updateCompanySms = async (req, res) => {
  try {
    if (!req.user?.isSuperAdmin && req.adminAccess !== true) return res.status(403).json({ message: "Unauthorized" });

    const data = {};
    if (req.body?.smsNumber !== undefined) {
      const number = toE164(req.body.smsNumber);
      if (number === undefined) return res.status(400).json({ message: "Enter a US or Canadian number, e.g. +1 555 123 4567." });
      if (number && number === toE164(process.env.TELNYX_FROM_NUMBER)) {
        return res.status(400).json({ message: "That's the shared AI4Home number. Each builder needs its own." });
      }
      data.smsNumber = number;
    }
    if (req.body?.smsStatus !== undefined) {
      if (!Object.values(SMS_STATUS).includes(req.body.smsStatus)) return res.status(400).json({ message: "Unknown status." });
      data.smsStatus = req.body.smsStatus;
      if (data.smsStatus !== SMS_STATUS.REJECTED) data.smsRejectReason = null;
    }

    const existing = await prisma.company.findUnique({ where: { id: req.params.companyId }, select: { smsNumber: true, smsStatus: true } });
    if (!existing) return res.status(404).json({ message: "Company not found" });
    const finalNumber = data.smsNumber !== undefined ? data.smsNumber : existing.smsNumber;
    const finalStatus = data.smsStatus ?? existing.smsStatus;
    if (finalStatus === SMS_STATUS.APPROVED && !finalNumber) {
      return res.status(400).json({ message: "Add the number before marking it approved." });
    }

    const company = await prisma.company.update({
      where: { id: req.params.companyId },
      data,
      select: { id: true, name: true, smsNumber: true, smsStatus: true, smsRejectReason: true },
    });
    forgetCompanySender(company.id);
    await writeAuditLog({
      req,
      action: "COMPANY_SMS_UPDATED",
      companyId: company.id,
      targetType: "Company",
      targetId: company.id,
      metadata: { smsNumber: company.smsNumber, smsStatus: company.smsStatus },
    });
    return res.json(company);
  } catch (error) {
    if (error?.code === "P2025") return res.status(404).json({ message: "Company not found" });
    if (error?.code === "P2002") return res.status(409).json({ message: "Another builder already has that number." });
    console.error("Error updating company SMS number:", error);
    return res.status(500).json({ message: "Could not update the texting number." });
  }
};

export const updateCompanyOnboarding = async (req, res) => {
  try {
    if (!req.user?.isSuperAdmin && req.adminAccess !== true) return res.status(403).json({ message: "Unauthorized" });

    const data = {};
    for (const field of ["contractSignedAt", "goLiveAt"]) {
      if (req.body?.[field] === undefined) continue;
      if (!req.body[field]) {
        data[field] = null;
        continue;
      }
      const date = new Date(req.body[field]);
      if (Number.isNaN(date.getTime())) return res.status(400).json({ message: `${field} is not a valid date` });
      data[field] = date;
    }

    const company = await prisma.company.update({
      where: { id: req.params.companyId },
      data,
      select: { id: true, contractSignedAt: true, goLiveAt: true },
    });
    return res.json(company);
  } catch (error) {
    if (error?.code === "P2025") return res.status(404).json({ message: "Company not found" });
    console.error("Error updating onboarding dates:", error);
    return res.status(500).json({ message: "Error updating onboarding dates" });
  }
};
