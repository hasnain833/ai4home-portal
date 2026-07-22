import prisma from "../lib/prisma.js";
import { MailService } from "../services/mail-service.js";
import { normalizeLeadStatuses } from "../lib/lead-statuses.js";
import { normalizeNewsSources } from "../lib/news-sources.js";
import { assertUploadSafe, buildStorageKey, UploadRejected } from "../lib/file-security.js";
import { BUCKETS, resolveDownloadUrl, uploadObject } from "../lib/storage.js";

export const getCompany = async (req, res) => {
  try {
    const session = req.user;
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const company = await prisma.company.findUnique({
      where: { id: session.companyId || "demo-company" }
    });

    return res.json(company);
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
      "leadStatuses",
      "newsSources",
    ];
    const data = {};
    for (const key of ALLOWED_FIELDS) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }

    if (data.leadStatuses !== undefined) {
      data.leadStatuses = normalizeLeadStatuses(data.leadStatuses);
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
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");

    return res.json(company);
  } catch (error) {
    console.error("Error fetching company branding:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const submitVerificationDocument = async (req, res) => {
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
    await assertUploadSafe(file, "verificationDoc");
    const originalName = file.originalname || "document.png";
    const { ref: url } = await uploadObject({
      bucket: BUCKETS.verificationDocs,
      key: buildStorageKey(companyId, originalName, "document.png"),
      buffer: file.buffer,
      contentType: file.mimetype,
      isPublic: false,
    });

    const company = await prisma.company.update({
      where: { id: companyId },
      data: {
        verificationDocUrl: url,
        verificationStatus: "SUBMITTED",
        verificationSubmittedAt: new Date(),
      },
    });

    try {
      const superAdminEmail = process.env.SUPERADMIN_EMAIL;
      if (superAdminEmail) {
        const adminUrl = `${process.env.NEXT_PUBLIC_URL || ""}/admin/verifications`;
        await MailService.sendEmail({
          to: superAdminEmail,
          subject: `Verification document submitted: ${company.name}`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
              <h2 style="color: #b48c3c;">Verification Document Submitted</h2>
              <p><strong>${company.name}</strong> (${company.email || "no email"}) uploaded a verification document and is awaiting your approval.</p>
              <div style="text-align: center; margin: 24px 0;">
                <a href="${adminUrl}" style="background-color: #b48c3c; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Review &amp; Approve</a>
              </div>
            </div>
          `,
        });
      }
    } catch (mailErr) {
      console.error("[Verification] Failed to notify super admin of submission:", mailErr);
    }

    return res.json({
      verificationStatus: company.verificationStatus,
      verificationDocUrl: await resolveDownloadUrl(company.verificationDocUrl),
    });
  } catch (error) {
    if (error instanceof UploadRejected) {
      return res.status(error.status).json({ message: error.message, code: error.code });
    }
    console.error("Error submitting verification document:", error);
    return res
      .status(error?.status || 500)
      .json({ message: error?.status ? error.message : "Error submitting verification document" });
  }
};

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
