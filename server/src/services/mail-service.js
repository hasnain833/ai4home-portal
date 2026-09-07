import nodemailer from "nodemailer";
import { Templates } from "./templates.js";

export const MAIL_OUTCOME = {
  SENT: "sent",
  FAILED: "failed",
  NOT_CONFIGURED: "not_configured",
};

export const mailShouldPark = (result) => result?.outcome === MAIL_OUTCOME.FAILED;

export class MailService {
  static SMTP_HOST = process.env.SMTP_HOST || "smtp-relay.brevo.com";
  static SMTP_PORT = parseInt(process.env.SMTP_PORT || "587", 10);
  static SMTP_USER = process.env.SMTP_USER || "";
  static SMTP_PASS = process.env.SMTP_PASS || "";
  static SENDER_EMAIL = process.env.SENDER_EMAIL || "noreply@bitzsol.com";
  static SENDER_NAME = "Aiforhomebuilder";

  static platformTransporter = null;

  static getPlatformTransporter() {
    if (!this.platformTransporter) {
      console.log(`[Mail Service] Initializing platform SMTP transporter: host=${this.SMTP_HOST}, port=${this.SMTP_PORT}`);
      this.platformTransporter = nodemailer.createTransport({
        host: this.SMTP_HOST,
        port: this.SMTP_PORT,
        secure: this.SMTP_PORT === 465,
        auth: {
          user: this.SMTP_USER,
          pass: this.SMTP_PASS,
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
        logger: false,
        debug: false,
      });
    }
    return this.platformTransporter;
  }

  static hasPlatformSender() {
    return !!(this.SMTP_USER && this.SMTP_PASS);
  }

  static transporters = new Map();


  static getOrCreateTransporter(smtpConfig) {
    if (!smtpConfig) {
      throw new Error(
        "getOrCreateTransporter called without an SMTP config — tenant mail must not fall back to the platform sender.",
      );
    }

    const cacheKey = `${smtpConfig.host}:${smtpConfig.port}:${smtpConfig.user}`;
    if (!this.transporters.has(cacheKey)) {
      const newTransporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.port === 465,
        auth: {
          user: smtpConfig.user,
          pass: smtpConfig.pass,
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
        logger: false,
        debug: false,
      });
      this.transporters.set(cacheKey, newTransporter);
    }
    return this.transporters.get(cacheKey);
  }


  static async sendEmail({ to, subject, html, fromName, fromEmail, smtpConfig, headers, allowPlatformSender = false }) {
    if (!smtpConfig && !allowPlatformSender) {
      console.warn(`[Mail Service] ⏭️ No SMTP config for this workspace — nothing sent to ${to}.`);
      return {
        success: false,
        outcome: MAIL_OUTCOME.NOT_CONFIGURED,
        error: "Email is not configured for this workspace.",
      };
    }

    if (!smtpConfig && !this.hasPlatformSender()) {
      console.warn(`[Mail Service] ⏭️ Platform SMTP credentials are not set — nothing sent to ${to}.`);
      return {
        success: false,
        outcome: MAIL_OUTCOME.NOT_CONFIGURED,
        error: "Platform SMTP credentials are not set.",
      };
    }

    const senderName = smtpConfig?.senderName || fromName || this.SENDER_NAME;
    const senderEmail = smtpConfig?.senderEmail || fromEmail || this.SENDER_EMAIL;
    const fromString = `"${senderName}" <${senderEmail}>`;

    const activeTransporter = smtpConfig
      ? this.getOrCreateTransporter(smtpConfig)
      : this.getPlatformTransporter();
    const host = smtpConfig?.host || this.SMTP_HOST;
    const port = smtpConfig?.port || this.SMTP_PORT;

    try {
      const info = await activeTransporter.sendMail({
        from: fromString,
        to,
        subject,
        html,
        headers,
      });

      if (Array.isArray(info.rejected) && info.rejected.length > 0) {
        console.error(`[Mail Service] ❌ SMTP rejected recipient(s) for ${to}`);
        return {
          success: false,
          outcome: MAIL_OUTCOME.FAILED,
          messageId: info.messageId,
          response: info.response,
          accepted: info.accepted || [],
          rejected: info.rejected,
          error: `SMTP rejected recipient(s): ${info.rejected.join(", ")}`,
        };
      }
      console.log(`[Mail Service] ✅ Email sent successfully to ${to}`);
      return {
        success: true,
        outcome: MAIL_OUTCOME.SENT,
        messageId: info.messageId,
        response: info.response,
        accepted: info.accepted || [],
        rejected: info.rejected || [],
      };
    } catch (error) {
      console.error(`[Mail Service] ❌ Failed to send email to ${to}`);
      return { success: false, outcome: MAIL_OUTCOME.FAILED, error: error?.message || "Internal error" };
    }
  }

  static async sendTicketStatusUpdate(to, homeownerName, ticketId, status, company = null, smtpConfig = null, allowPlatformSender = false) {
    const statusLabel = status.replace("_", " ").toLowerCase();
    const subject = `Ticket Update: ${ticketId} is now ${statusLabel}`;

    const companyName = company?.name || "Aiforhomebuilder";
    const companyEmail = company?.email || this.SENDER_EMAIL;
    const portalUrl = process.env.NEXT_PUBLIC_URL || "";

    const html = Templates.getTicketUpdateEmail(
      homeownerName,
      ticketId,
      statusLabel,
      portalUrl,
      companyName
    );

    return this.sendEmail({ to, subject, html, fromName: companyName, fromEmail: companyEmail, smtpConfig, allowPlatformSender });
  }


}
