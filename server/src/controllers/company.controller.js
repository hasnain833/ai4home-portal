import prisma from "../lib/prisma.js";
import { MailService } from "../services/mail-service.js";
import { normalizeNewsSources } from "../lib/news-sources.js";
import { assertUploadSafe, buildStorageKey, UploadRejected } from "../lib/file-security.js";
import { BUCKETS, resolveDownloadUrl, uploadObject } from "../lib/storage.js";
import { Templates } from "../services/templates.js";
import { hasSalesPermission } from "../lib/permissions.js";

// Bump together with the PDF in public/legal/ and the constants in
// VerificationGate.tsx, so a stored agreementVersion always names the
// wording that was actually signed.
const AGREEMENT_VERSION = "1.0";

export const getCompany = async (req, res) => {
  try {
    const session = req.user;
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const company = await prisma.company.findUnique({
      where: { id: session.companyId || "demo-company" }
    });

    return res.json({ ...(company || {}) });
  } catch (error) {
    console.error("Error fetching company details:", error);
    return res.status(500).json({ message: "Error fetching company" });
  }
};

export const updateCompany = async (req, res) => {
  try {
    const session = req.user;
    if (!session || (session.role !== "STAFF" && session.role !== "ADMIN")) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const companyId = session.companyId || "demo-company";
    const PROFILE_FIELDS = [
      "name",
      "logo",
      "email",
      "phone",
      "address",
      "warrantyPolicy",
      "botColor",
    ];

    const SETTINGS_FIELDS = [
      "defaultLeadOwner",
      "voiceProfile",
      "campaignExitConditions",
      "campaignVersionPolicy",
      "newsSources",
    ];

    const COMPLIANCE_FIELDS = [
      "complianceOptInRequired",
      "smsQuietHoursEnabled",
      "quietHoursStart",
      "quietHoursEnd",
      "quietHoursTimezone",
    ];

    const isAdmin = String(session.role).toUpperCase() === "ADMIN" || session.isSuperAdmin === true;
    const canManageSettings = hasSalesPermission(session, "settings.manage");

    const sent = (fields) => fields.filter((f) => req.body[f] !== undefined);
    const refusedSettings = canManageSettings ? [] : sent(SETTINGS_FIELDS);
    const refusedCompliance = isAdmin ? [] : sent(COMPLIANCE_FIELDS);
    // Named explicitly so a caller can tell which field was refused rather than
    // guessing why the whole request failed.
    const refused = [...refusedSettings, ...refusedCompliance];
    if (refused.length) {
      return res.status(403).json({
        message: `You do not have permission to change: ${refused.join(", ")}.`,
        fields: refused,
      });
    }

    const ALLOWED_FIELDS = [
      "name",
      "logo",
      "email",
      "phone",
      "address",
      "warrantyPolicy",
      "botColor",
      "defaultLeadOwner",
      "voiceProfile",
      "complianceOptInRequired",
      "campaignExitConditions",
      "campaignVersionPolicy",
      "smsQuietHoursEnabled",
      "quietHoursStart",
      "quietHoursEnd",
      "quietHoursTimezone",
      "newsSources",
    ];
    const data = {};
    for (const key of ALLOWED_FIELDS) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }

    if (data.newsSources !== undefined) {
      data.newsSources = normalizeNewsSources(data.newsSources);
    }

    const clampHour = (v, fallback) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(24, Math.max(0, Math.round(n))) : fallback;
    };
    if (data.quietHoursStart !== undefined) data.quietHoursStart = clampHour(data.quietHoursStart, 8);
    if (data.quietHoursEnd !== undefined) data.quietHoursEnd = clampHour(data.quietHoursEnd, 21);
    if (data.smsQuietHoursEnabled !== undefined) data.smsQuietHoursEnabled = !!data.smsQuietHoursEnabled;
    if (data.quietHoursTimezone !== undefined) {
      const tz = String(data.quietHoursTimezone || "").trim();
      data.quietHoursTimezone = tz || null;
    }

    const company = await prisma.company.update({
      where: { id: companyId },
      data,
    });

    if (
      data.campaignExitConditions !== undefined ||
      data.campaignVersionPolicy !== undefined
    ) {
      const campaignSync = {};
      if (data.campaignExitConditions !== undefined) {
        campaignSync.exitConditions = data.campaignExitConditions;
      }
      if (data.campaignVersionPolicy !== undefined) {
        campaignSync.versionPolicy = data.campaignVersionPolicy;
      }
      await prisma.campaign.updateMany({
        where: { companyId },
        data: campaignSync,
      });
    }

    if (session.role === "ADMIN" && data.name) {
      await prisma.user.updateMany({
        where: { email: session.email },
        data: { name: data.name }
      });
    }

    return res.json(company);
  } catch (error) {
    console.error("Error updating company details:", error);
    return res.status(500).json({ message: "Error updating company" });
  }
};
export const getCompanyBranding = async (req, res) => {
  try {
    const id = req.query.id;

    if (!id) {
      return res.status(400).json({ message: "Missing company id" });
    }

    const company = await prisma.company.findUnique({
      where: { id: id },
      select: {
        name: true,
        logo: true,
        botColor: true,
      }
    });

    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

    return res.json(company);
  } catch (error) {
    console.error("Error fetching company branding:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

function nextVerificationStatus(current, { verificationDocUrl, agreementDocUrl }) {
  if (current === "VERIFIED") return "VERIFIED";
  return verificationDocUrl && agreementDocUrl ? "SUBMITTED" : "PENDING";
}

async function notifySuperAdminOfSubmission(company) {
  try {
    const superAdminEmail = process.env.SUPERADMIN_EMAIL;
    if (!superAdminEmail) return;
    const adminUrl = `${process.env.NEXT_PUBLIC_URL || ""}/admin/verifications`;
    await MailService.sendEmail({
      to: superAdminEmail,
      subject: `Onboarding documents submitted: ${company.name}`,
      html: Templates.getAdminVerificationDocEmail(company.name, adminUrl),
      companyId: company.id,
      source: "verification-submitted",
    });
  } catch (mailErr) {
    console.error("[Verification] Failed to notify super admin of submission:", mailErr);
  }
}

async function storeOnboardingDocument(req, res, { profile, bucket, fallbackName, columnsFor, errorLabel }) {
  try {
    const session = req.user;

    if (!session || session.role !== "ADMIN") {
      return res.status(403).json({ message: "Unauthorized" });
    }

    if (!session.companyId) {
      return res.status(400).json({ message: "No company associated with this account" });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ message: "No file provided" });
    }

    const companyId = session.companyId;
    await assertUploadSafe(file, profile);

    const existing = await prisma.company.findUnique({
      where: { id: companyId },
      select: { verificationStatus: true, verificationDocUrl: true, agreementDocUrl: true },
    });
    if (!existing) {
      return res.status(404).json({ message: "Company not found" });
    }

    const originalName = file.originalname || fallbackName;
    const { ref: url } = await uploadObject({
      bucket,
      key: buildStorageKey(companyId, originalName, fallbackName),
      buffer: file.buffer,
      contentType: file.mimetype,
      isPublic: false,
    });

    const columns = columnsFor(url);
    const merged = { ...existing, ...columns };
    const status = nextVerificationStatus(existing.verificationStatus, merged);

    const company = await prisma.company.update({
      where: { id: companyId },
      data: { ...columns, verificationStatus: status },
    });

    // Only worth the Super Admin's attention once there is a complete set to review.
    if (status === "SUBMITTED" && existing.verificationStatus !== "SUBMITTED") {
      await notifySuperAdminOfSubmission(company);
    }

    return res.json({
      verificationStatus: company.verificationStatus,
      verificationDocUrl: await resolveDownloadUrl(company.verificationDocUrl),
      agreementDocUrl: await resolveDownloadUrl(company.agreementDocUrl),
      agreementVersion: company.agreementVersion,
    });
  } catch (error) {
    if (error instanceof UploadRejected) {
      return res.status(error.status).json({ message: error.message, code: error.code });
    }
    console.error(`Error submitting ${errorLabel}:`, error);
    return res
      .status(error?.status || 500)
      .json({ message: error?.status ? error.message : `Error submitting ${errorLabel}` });
  }
}

export const submitVerificationDocument = (req, res) =>
  storeOnboardingDocument(req, res, {
    profile: "verificationDoc",
    bucket: BUCKETS.verificationDocs,
    fallbackName: "document.png",
    columnsFor: (url) => ({
      verificationDocUrl: url,
      verificationSubmittedAt: new Date(),
    }),
    errorLabel: "verification document",
  });

export const submitAgreementDocument = (req, res) =>
  storeOnboardingDocument(req, res, {
    profile: "agreementDoc",
    bucket: BUCKETS.agreementDocs,
    fallbackName: "signed-agreement.pdf",
    columnsFor: (url) => ({
      agreementDocUrl: url,
      agreementSubmittedAt: new Date(),
      agreementVersion: AGREEMENT_VERSION,
    }),
    errorLabel: "signed agreement",
  });

export const uploadCompanyLogo = async (req, res) => {
  try {
    const session = req.user;

    if (!session || (session.role !== "STAFF" && session.role !== "ADMIN")) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: "No file provided" });
    }

    const companyId = session.companyId || "demo-company";
    await assertUploadSafe(file, "image");

    const { publicUrl } = await uploadObject({
      bucket: BUCKETS.companyLogos,
      key: buildStorageKey(companyId, file.originalname, "logo.png"),
      buffer: file.buffer,
      contentType: file.mimetype,
      isPublic: true,
    });

    await prisma.company.update({
      where: { id: companyId },
      data: { logo: publicUrl },
    });

    return res.json({ url: publicUrl });
  } catch (error) {
    if (error instanceof UploadRejected) {
      return res.status(error.status).json({ message: error.message, code: error.code });
    }
    console.error("Error uploading logo:", error);
    return res
      .status(error?.status || 500)
      .json({ message: error?.status ? error.message : "Error uploading logo" });
  }
};

