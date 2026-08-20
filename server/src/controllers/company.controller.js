import prisma from "../lib/prisma.js";
import { MailService } from "../services/mail-service.js";
import { encrypt, decryptSafe } from "../lib/crypto.js";
import { normalizeNewsSources } from "../lib/news-sources.js";
import { assertUploadSafe, buildStorageKey, UploadRejected } from "../lib/file-security.js";
import { BUCKETS, resolveDownloadUrl, uploadObject } from "../lib/storage.js";
import { Templates, SmsTemplates } from "../services/templates.js";
import { sendSms, smsSent } from "../services/sms.service.js";
import { TENANT_AI_PROVIDERS, invalidateAiConfigCache } from "../lib/ai-config.js";
import { hasSalesPermission } from "../lib/permissions.js";

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
      aiGroqKeyMasked: mask(keyOf("GROQ")),
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

    // Company profile: any staff member may edit it. The warranty workspace
    // edits these same fields, so they must not require a sales permission.
    const PROFILE_FIELDS = [
      "name",
      "logo",
      "email",
      "phone",
      "address",
      "warrantyPolicy",
      "botColor",
    ];

    // Sales configuration: requires the settings permission.
    const SETTINGS_FIELDS = [
      "defaultLeadOwner",
      "voiceProfile",
      "campaignExitConditions",
      "campaignVersionPolicy",
      "newsSources",
    ];

    // Compliance controls. Turning off opt-in enforcement or quiet hours has
    // legal consequences for the tenant, so it is restricted to an admin.
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
    const aiFieldsSent = ["aiProvider", "aiAnthropicKey", "aiOpenAiKey", "aiGroqKey"].filter(
      (f) => req.body[f] !== undefined,
    );
    const refusedAi = canManageSettings ? [] : aiFieldsSent;

    // Named explicitly so a caller can tell which field was refused rather than
    // guessing why the whole request failed.
    const refused = [...refusedSettings, ...refusedCompliance, ...refusedAi];
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

    const aiProvider = ["platform", ...TENANT_AI_PROVIDERS.map((p) => p.toLowerCase())].includes(
      req.body.aiProvider,
    )
      ? req.body.aiProvider
      : undefined;
    const aiKeys = {
      ANTHROPIC: typeof req.body.aiAnthropicKey === "string" ? req.body.aiAnthropicKey.trim() : undefined,
      OPENAI: typeof req.body.aiOpenAiKey === "string" ? req.body.aiOpenAiKey.trim() : undefined,
      GROQ: typeof req.body.aiGroqKey === "string" ? req.body.aiGroqKey.trim() : undefined,
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
          // Platform-to-superadmin notice, not tenant mail.
          allowPlatformSender: true,
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

/**
 * A tenant admin asking the platform administrator to grant this workspace a
 * platform AI key. The grant itself is issued from Admin -> AI Keys; this only
 * raises the request and notifies the administrator by email and SMS.
 */
export const requestPlatformKey = async (req, res) => {
  try {
    const session = req.user;
    if (!session) return res.status(401).json({ message: "Unauthorized" });
    if (session.role !== "ADMIN" && session.role !== "admin") {
      return res.status(403).json({ message: "Only a workspace admin can request a platform key." });
    }

    const company = await prisma.company.findUnique({
      where: { id: session.companyId || "demo-company" },
    });
    if (!company) return res.status(404).json({ message: "Company not found" });

    if (company.aiPlatformGrant) {
      return res
        .status(400)
        .json({ message: "Your workspace already has a platform key. No request is needed." });
    }

    // One request per day: the administrator is notified by SMS, so a button
    // that can be pressed repeatedly is a way to spam them.
    const lastRequest = company.aiPlatformKeyRequestedAt;
    if (lastRequest && Date.now() - new Date(lastRequest).getTime() < 24 * 60 * 60 * 1000) {
      return res.status(429).json({
        message: "A request was already sent in the last 24 hours. Your administrator has it.",
        requestedAt: lastRequest,
      });
    }

    const provider = typeof req.body?.provider === "string" ? req.body.provider : null;
    const requesterName = session.name || session.email || "A workspace admin";
    const requesterEmail = session.email || "unknown";

    await prisma.company.update({
      where: { id: company.id },
      data: {
        aiPlatformKeyRequestedAt: new Date(),
        aiPlatformKeyRequestedBy: requesterEmail,
      },
    });

    // Notification failures must not lose the request: it is already recorded,
    // and the administrator can still see it in the admin screen.
    const adminNotifyEmail = process.env.ADMIN_NOTIFY_EMAIL;
    const adminNotifyPhone = process.env.ADMIN_NOTIFY_PHONE;
    const adminUrl = `${process.env.NEXT_PUBLIC_URL || ""}/admin/ai-keys`;
    const delivery = { email: false, sms: false };

    try {
      if (adminNotifyEmail) {
        await MailService.sendEmail({
          to: adminNotifyEmail,
          subject: `Platform AI key requested: ${company.name}`,
          html: Templates.getPlatformKeyRequestEmail(
            company.name,
            requesterName,
            requesterEmail,
            provider,
            adminUrl,
          ),
          allowPlatformSender: true,
        });
        delivery.email = true;
      } else {
        console.warn("[Platform Key] ADMIN_NOTIFY_EMAIL missing - skipping admin email.");
      }
    } catch (mailError) {
      console.error("[Platform Key] Failed to email the administrator:", mailError);
    }

    try {
      if (adminNotifyPhone) {
        const sms = await sendSms({
          to: adminNotifyPhone,
          tag: "platform-key-request",
          body: SmsTemplates.getPlatformKeyRequestSms(company.name, requesterEmail),
          smsConfig: "SYSTEM",
        });
        delivery.sms = smsSent(sms);
        if (!delivery.sms) {
          console.warn(`[Platform Key] Admin SMS not delivered (${sms.outcome}): ${sms.error}`);
        }
      } else {
        console.warn("[Platform Key] ADMIN_NOTIFY_PHONE missing - skipping admin SMS.");
      }
    } catch (smsError) {
      console.error("[Platform Key] Failed to text the administrator:", smsError);
    }

    return res.json({
      message: "Request sent. Your administrator will be in touch once it is reviewed.",
      requestedAt: new Date().toISOString(),
      delivery,
    });
  } catch (error) {
    console.error("[Platform Key] Request failed:", error);
    return res.status(500).json({ message: "Could not send the request. Please try again." });
  }
};
