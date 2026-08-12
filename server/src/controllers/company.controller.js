import prisma from "../lib/prisma.js";
import { MailService } from "../services/mail-service.js";
import { encrypt, decryptSafe } from "../lib/crypto.js";
import { normalizeNewsSources } from "../lib/news-sources.js";
import { assertUploadSafe, buildStorageKey, UploadRejected } from "../lib/file-security.js";
import { BUCKETS, resolveDownloadUrl, uploadObject } from "../lib/storage.js";
import { Templates } from "../services/templates.js";
import { TENANT_AI_PROVIDERS, invalidateAiConfigCache } from "../lib/ai-config.js";

export const getCompany = async (req, res) => {
  try {
    const session = req.user;
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const company = await prisma.company.findUnique({
      where: { id: session.companyId || "demo-company" }
    });
    const aiIntegrations = await prisma.integration.findMany({
      where: {
        companyId: session.companyId || "demo-company",
        platform: { in: TENANT_AI_PROVIDERS },
      },
      select: { platform: true, apiKey: true, isActive: true },
    });
    const mask = (value) => {
      const plain = decryptSafe(value || "");
      return plain ? `••••${plain.slice(-4)}` : "";
    };
    const keyOf = (platform) =>
      aiIntegrations.find((i) => i.platform === platform)?.apiKey;
    const activeProvider =
      aiIntegrations.find((i) => i.isActive)?.platform?.toLowerCase() ||
      "platform";

    return res.json({
      ...(company || {}),
      aiProvider: activeProvider,
      aiPlatformGrant: company?.aiPlatformGrant || null,
      aiAnthropicKeyMasked: mask(keyOf("ANTHROPIC")),
      aiOpenAiKeyMasked: mask(keyOf("OPENAI")),
    });
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
      "newsSources",
    ];
    const data = {};
    for (const key of ALLOWED_FIELDS) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }

    if (data.newsSources !== undefined) {
      data.newsSources = normalizeNewsSources(data.newsSources);
    }

    const aiProvider = ["platform", "anthropic", "openai"].includes(req.body.aiProvider)
      ? req.body.aiProvider
      : undefined;
    const aiKeys = {
      ANTHROPIC: typeof req.body.aiAnthropicKey === "string" ? req.body.aiAnthropicKey.trim() : undefined,
      OPENAI: typeof req.body.aiOpenAiKey === "string" ? req.body.aiOpenAiKey.trim() : undefined,
    };

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

    if (aiProvider !== undefined || Object.values(aiKeys).some(Boolean)) {
      for (const platform of TENANT_AI_PROVIDERS) {
        await saveAiIntegration(
          companyId,
          platform,
          aiProvider === platform.toLowerCase(),
          aiKeys[platform],
        );
      }
      invalidateAiConfigCache(companyId);
    }

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

async function saveAiIntegration(companyId, platform, isActive, apiKey) {
  const existing = await prisma.integration.findFirst({
    where: { companyId, platform },
    select: { id: true },
  });
  const data = {
    isActive,
    environment: "production",
    ...(apiKey && !apiKey.includes("••••") ? { apiKey: encrypt(apiKey) } : {}),
  };
  if (existing) {
    await prisma.integration.update({ where: { id: existing.id }, data });
  } else if (isActive || apiKey) {
    await prisma.integration.create({
      data: {
        companyId,
        platform,
        ...data,
      },
    });
  }
}

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
          html: Templates.getAdminVerificationDocEmail(company.name, adminUrl),
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
