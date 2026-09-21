import nodemailer from "nodemailer";
import { Templates } from "./templates.js";
import { recordUsage } from "../lib/usage.js";

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

  // Every send goes out over the platform account. The tenant supplies only a
  // display identity: their name on the From line and their address as Reply-To,
  // so the mail stays aligned with the platform's SPF/DKIM records.
  static async sendEmail({ to, subject, html, fromName, fromEmail, replyTo, headers, companyId = null, source = null }) {
    if (!this.hasPlatformSender()) {
      console.warn(`[Mail Service] ⏭️ Platform SMTP credentials are not set — nothing sent to ${to}.`);
      return {
        success: false,
        outcome: MAIL_OUTCOME.NOT_CONFIGURED,
        error: "Platform SMTP credentials are not set.",
      };
    }

    const senderName = fromName || this.SENDER_NAME;
    const fromString = `"${senderName}" <${this.SENDER_EMAIL}>`;

    // Where a reply lands. With an inbound domain configured, it comes back to
    // us at reply+<companyId>@domain so the sales agent sees it and the tenant
    // is identified exactly. Without one, replies go straight to the tenant's
    // own address and the agent never sees them.
    // fromEmail is the tenant's own address; it cannot be the envelope sender
    // without breaking domain alignment, so it is only ever a reply target.
    const inboundDomain = String(process.env.INBOUND_EMAIL_DOMAIN || "").trim();
    const replyToAddress =
      replyTo ||
      (inboundDomain && companyId ? `reply+${companyId}@${inboundDomain}` : null) ||
      fromEmail ||
      null;

    const meter = (outcome) =>
      recordUsage({
        companyId,
        channel: "EMAIL",
        provider: "SMTP",
        units: 1,
        outcome,
        source,
        recipient: String(to || "").trim().toLowerCase(),
      });

    try {
      const info = await this.getPlatformTransporter().sendMail({
        from: fromString,
        ...(replyToAddress ? { replyTo: replyToAddress } : {}),
        to,
        subject,
        html,
        headers,
      });

      if (Array.isArray(info.rejected) && info.rejected.length > 0) {
        console.error(`[Mail Service] ❌ SMTP rejected recipient(s) for ${to}`);
        await meter("failed");
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
      await meter("sent");
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
      await meter("failed");
      return { success: false, outcome: MAIL_OUTCOME.FAILED, error: error?.message || "Internal error" };
    }
  }

  static async sendTicketStatusUpdate(to, homeownerName, ticketId, status, company = null, companyId = null) {
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

    return this.sendEmail({
      to,
      subject,
      html,
      fromName: companyName,
      fromEmail: companyEmail,
      companyId: companyId || company?.id || null,
      source: "ticket-status",
    });
  }


}
