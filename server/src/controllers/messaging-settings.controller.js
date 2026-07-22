import prisma from "../lib/prisma.js";
import { MailService } from "../services/mail-service.js";
import { sendSms } from "../services/sms.service.js";
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
        platform: { in: ["BREVO_EMAIL", "TWILIO_SMS"] },
      },
    });

    const settings = {
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

    const smsInt = integrations.find(i => i.platform === "TWILIO_SMS");
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

    if (provider !== "TWILIO_SMS") {
      return res.status(400).json({ message: "Invalid SMS provider" });
    }

    await prisma.integration.deleteMany({
      where: {
        companyId,
        platform: { in: ["TWILIO_SMS", "BREVO_SMS"] },
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
    
    let smsConfig;
    if (config.apiKey?.includes("••••") || config.apiSecret?.includes("••••")) {
      const existing = await prisma.integration.findFirst({
        where: { companyId: req.user?.companyId || "demo-company", platform: "TWILIO_SMS" },
      });
      if (!existing) return res.status(400).json({ message: "SMS settings not found in database to test" });

      smsConfig = {
        provider: "TWILIO_SMS",
        accountSid: decryptSafe(existing.apiKey),
        authToken: decryptSafe(existing.secretKey),
        from: existing.senderName,
      };
    } else {
      smsConfig = {
        provider: "TWILIO_SMS",
        accountSid: config.apiKey,
        authToken: config.apiSecret,
        from: config.senderName,
      };
    }

    const result = await sendSms({
      to,
      body: "This is a test SMS from Warranty Care Portal to verify your configuration.",
      smsConfig,
    });

    return res.json({ success: true, message: "Test SMS sent successfully!", result });
  } catch (error) {
    console.error("[MessagingSettings] Test SMS failed:", error);
    return res.status(400).json({ message: error.message || "Failed to send SMS" });
  }
};
