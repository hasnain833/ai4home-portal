import prisma from "../lib/prisma.js";
import { MailService } from "../services/mail-service.js";
import { sendSms, SMS_PROVIDERS, RETIRED_SMS_PROVIDERS } from "../services/sms.service.js";
import { encrypt, decryptSafe } from "../lib/crypto.js";

const last4 = (value) => {
  const plain = decryptSafe(value);
  return plain ? `••••${String(plain).slice(-4)}` : null;
};

export const getMessagingSettings = async (req, res) => {
  try {
    const session = req.user;
    if (!session) return res.status(401).json({ message: "Unauthorized" });

    const integrations = await prisma.integration.findMany({
      where: {
        companyId: session.companyId || "demo-company",
        platform: { in: ["BREVO_EMAIL", ...SMS_PROVIDERS] },
      },
    });

    const settings = {
      companyId: session.companyId || "demo-company",
      email: null,
      sms: null,
    };

    const emailInt = integrations.find(i => i.platform === "BREVO_EMAIL");
    if (emailInt) {
      settings.email = {
        id: emailInt.id,
        smtpHost: emailInt.smtpHost,
        smtpPort: emailInt.smtpPort,
        senderEmail: emailInt.senderEmail,
        senderName: emailInt.senderName,
        smtpUser: last4(emailInt.apiKey),
        smtpPass: last4(emailInt.secretKey),
        isActive: emailInt.isActive,
      };
    }

    const smsInt = integrations.find(i => SMS_PROVIDERS.includes(i.platform));
    if (smsInt) {
      settings.sms = {
        id: smsInt.id,
        provider: smsInt.platform,
        senderName: smsInt.senderName,
        apiKey: last4(smsInt.apiKey),
        apiSecret: last4(smsInt.secretKey),
        isActive: smsInt.isActive,
      };
    }

    return res.json(settings);
  } catch (error) {
    console.error("[MessagingSettings] GET failed:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const saveEmailSettings = async (req, res) => {
  try {
    const session = req.user;
    if (!session || session.role !== "ADMIN") return res.status(403).json({ message: "Unauthorized" });

    const { smtpHost, smtpPort, smtpUser, smtpPass, senderEmail, senderName, isActive } = req.body;
    const companyId = session.companyId || "demo-company";

    const existing = await prisma.integration.findFirst({
      where: { companyId, platform: "BREVO_EMAIL" },
    });

    const data = {
      platform: "BREVO_EMAIL",
      smtpHost,
      smtpPort: parseInt(smtpPort, 10) || 587,
      senderEmail,
      senderName,
      isActive: isActive ?? true,
    };

    if (smtpUser && !smtpUser.includes("••••")) data.apiKey = encrypt(smtpUser);
    if (smtpPass && !smtpPass.includes("••••")) data.secretKey = encrypt(smtpPass);

    let integration;
    if (existing) {
      integration = await prisma.integration.update({ where: { id: existing.id }, data });
    } else {
      integration = await prisma.integration.create({ data: { ...data, companyId } });
    }

    return res.json({ success: true, id: integration.id });
  } catch (error) {
    console.error("[MessagingSettings] Save Email failed:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const saveSmsSettings = async (req, res) => {
  try {
    const session = req.user;
    if (!session || session.role !== "ADMIN") return res.status(403).json({ message: "Unauthorized" });

    const { provider, apiKey, apiSecret, senderName, isActive } = req.body;
    const companyId = session.companyId || "demo-company";

    if (!SMS_PROVIDERS.includes(provider)) {
      return res.status(400).json({ message: "Invalid SMS provider" });
    }

    // Exactly one SMS provider is active per company — drop the others, plus any
    // rows left behind by a provider that's no longer offered.
    await prisma.integration.deleteMany({
      where: {
        companyId,
        platform: { in: [...SMS_PROVIDERS.filter((p) => p !== provider), ...RETIRED_SMS_PROVIDERS] },
      },
    });

    const existing = await prisma.integration.findFirst({
      where: { companyId, platform: provider },
    });

    const data = {
      platform: provider,
      senderName,
      isActive: isActive ?? true,
    };

    if (apiKey && !apiKey.includes("••••")) data.apiKey = encrypt(apiKey);
    if (apiSecret && !apiSecret.includes("••••")) data.secretKey = encrypt(apiSecret);

    let integration;
    if (existing) {
      integration = await prisma.integration.update({ where: { id: existing.id }, data });
    } else {
      integration = await prisma.integration.create({ data: { ...data, companyId } });
    }

    return res.json({ success: true, id: integration.id });
  } catch (error) {
    console.error("[MessagingSettings] Save SMS failed:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const testEmail = async (req, res) => {
  try {
    const { to, config } = req.body;
    if (!to) return res.status(400).json({ message: "Recipient email required" });
    
    let smtpConfig = config;
    if (config.smtpUser?.includes("••••") || config.smtpPass?.includes("••••")) {
      const existing = await prisma.integration.findFirst({
        where: { companyId: req.user?.companyId || "demo-company", platform: "BREVO_EMAIL" },
      });
      if (!existing) return res.status(400).json({ message: "Email settings not found in database to test" });
      
      smtpConfig = {
        host: existing.smtpHost,
        port: existing.smtpPort,
        user: decryptSafe(existing.apiKey),
        pass: decryptSafe(existing.secretKey),
        senderEmail: existing.senderEmail,
        senderName: existing.senderName,
      };
    } else {
      smtpConfig = {
        host: config.smtpHost,
        port: parseInt(config.smtpPort, 10),
        user: config.smtpUser,
        pass: config.smtpPass,
        senderEmail: config.senderEmail,
        senderName: config.senderName,
      };
    }

    const result = await MailService.sendEmail({
      to,
      subject: "Test Email from Warranty Care Portal",
      html: "<p>This is a test email to verify your SMTP configuration.</p>",
      fromName: smtpConfig.senderName,
      smtpConfig,
    });

    if (result.success) {
      return res.json({ success: true, message: "Test email sent successfully!" });
    } else {
      return res.status(400).json({ success: false, message: result.error?.message || "Failed to send email" });
    }
  } catch (error) {
    console.error("[MessagingSettings] Test Email failed:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

export const testSms = async (req, res) => {
  try {
    const { to, config } = req.body;
    if (!to) return res.status(400).json({ message: "Recipient phone number required" });
    
    const provider = SMS_PROVIDERS.includes(config?.provider) ? config.provider : "TWILIO_SMS";

    let smsConfig;
    if (config.apiKey?.includes("••••") || config.apiSecret?.includes("••••")) {
      const existing = await prisma.integration.findFirst({
        where: { companyId: req.user?.companyId || "demo-company", platform: provider },
      });
      if (!existing) return res.status(400).json({ message: "SMS settings not found in database to test" });

      smsConfig = {
        provider,
        // Masked fields fall back to what's stored; unmasked ones use what was typed.
        apiKey: config.apiKey?.includes("••••") ? decryptSafe(existing.apiKey) : config.apiKey,
        apiSecret: config.apiSecret?.includes("••••") ? decryptSafe(existing.secretKey) : config.apiSecret,
        from: config.senderName || existing.senderName,
      };
    } else {
      smsConfig = {
        provider,
        apiKey: config.apiKey,
        apiSecret: config.apiSecret,
        from: config.senderName,
      };
    }

    const result = await sendSms({
      to,
      body: "This is a test SMS from Warranty Care Portal to verify your configuration.",
      smsConfig,
    });

    // sendSms degrades to a simulated send when credentials are missing or the
    // provider rejects the message — surface that instead of a false success.
    if (result?.provider?.endsWith("_SIMULATED")) {
      return res.status(400).json({
        success: false,
        message: result.error
          ? `${provider.replace("_SMS", "")} rejected the message: ${result.error}`
          : "SMS was not delivered — the provider rejected it or credentials are incomplete.",
        result,
      });
    }

    return res.json({ success: true, message: "Test SMS sent successfully!", result });
  } catch (error) {
    console.error("[MessagingSettings] Test SMS failed:", error);
    return res.status(400).json({ message: error.message || "Failed to send SMS" });
  }
};
