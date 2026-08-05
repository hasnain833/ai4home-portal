import nodemailer from "nodemailer";
import { Templates } from "./templates.js";

export class MailService {
  static SMTP_HOST = process.env.SMTP_HOST || "smtp-relay.brevo.com";
  static SMTP_PORT = parseInt(process.env.SMTP_PORT || "587", 10);
  static SMTP_USER = process.env.SMTP_USER || "";
  static SMTP_PASS = process.env.SMTP_PASS || "";
  static SENDER_EMAIL = process.env.SENDER_EMAIL || "noreply@bitzsol.com";
  static SENDER_NAME = "Aiforhomebuilder";

  static transporter = (() => {
    console.log(`[Mail Service] Initializing default SMTP transporter: host=${MailService.SMTP_HOST}, port=${MailService.SMTP_PORT}`);
    return nodemailer.createTransport({
      host: MailService.SMTP_HOST,
      port: MailService.SMTP_PORT,
      secure: MailService.SMTP_PORT === 465,
      auth: {
        user: MailService.SMTP_USER,
        pass: MailService.SMTP_PASS,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      logger: false,
      debug: false,
    });
  })();

  static transporters = new Map();

  static getOrCreateTransporter(smtpConfig) {
    if (!smtpConfig) return this.transporter;

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

  static async sendEmail({ to, subject, html, fromName, fromEmail, smtpConfig, headers }) {
    if (!smtpConfig && (!this.SMTP_USER || !this.SMTP_PASS)) {
      console.warn("[Mail Service] SMTP credentials missing and no custom config provided. Email will not be sent.");
      return { success: false, error: "SMTP credentials missing" };
    }

    const senderName = smtpConfig?.senderName || fromName || this.SENDER_NAME;
    const senderEmail = smtpConfig?.senderEmail || fromEmail || this.SENDER_EMAIL;
    const fromString = `"${senderName}" <${senderEmail}>`;

    const activeTransporter = this.getOrCreateTransporter(smtpConfig);
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

      console.log(`[Mail Service] ✅ Email sent successfully to ${to}`);
      if (Array.isArray(info.rejected) && info.rejected.length > 0) {
        return {
          success: false,
          messageId: info.messageId,
          response: info.response,
          accepted: info.accepted || [],
          rejected: info.rejected,
          error: `SMTP rejected recipient(s): ${info.rejected.join(", ")}`,
        };
      }
      return {
        success: true,
        messageId: info.messageId,
        response: info.response,
        accepted: info.accepted || [],
        rejected: info.rejected || [],
      };
    } catch (error) {
      console.error(`[Mail Service] ❌ Failed to send email to ${to}`);
      return { success: false, error: error?.message || "Internal error" };
    }
  }

  static async sendTicketStatusUpdate(to, homeownerName, ticketId, status, company = null, smtpConfig = null) {
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

    return this.sendEmail({ to, subject, html, fromName: companyName, fromEmail: companyEmail, smtpConfig });
  }


}
