import nodemailer from "nodemailer";
import { fileURLToPath } from "node:url";
import { ticketRef } from "../lib/ticket-number.js";
import { Templates, isPlatformEmail, prepareOutgoingEmail } from "./templates.js";
import prisma from "../lib/prisma.js";
import { recordUsage } from "../lib/usage.js";
import { isCompanySuspended } from "../lib/company-suspension.js";

export const MAIL_OUTCOME = {
  SENT: "sent",
  FAILED: "failed",
  NOT_CONFIGURED: "not_configured",
  // Tenant is suspended: nothing is sent, nothing is billed, nothing is parked for retry.
  SUSPENDED: "suspended",
};

export const mailShouldPark = (result) => result?.outcome === MAIL_OUTCOME.FAILED;

/** True when NEXT_PUBLIC_URL is a public HTTPS address a mail app can load the logo from. */
function hasPublicLogoUrl() {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_URL || "");
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

// Files in public/ that emails reference, and their inline ids for local development.
const INLINE_IMAGES = [
  { file: "logo-email.png", cid: "ai4hb-logo", type: "image/png" },
  { file: "ceo-email.jpg", cid: "ai4hb-ceo", type: "image/jpeg" },
];

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

  static async sendEmail({ to, subject, html, fromName, fromEmail, replyTo, headers, companyId = null, source = null, noReply = false, track = null, branding, attachments = [] }) {
    if (await isCompanySuspended(companyId)) {
      return { success: false, outcome: MAIL_OUTCOME.SUSPENDED, error: "Company is suspended." };
    }
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
    const inboundDomain = String(process.env.INBOUND_EMAIL_DOMAIN || "").trim();
    const replyToAddress = noReply ? null :
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
        track,
      });

    try {
      // A builder's email carries their uploaded logo; a failed lookup falls back to ours.
      const builder = isPlatformEmail({ companyId, source, branding })
        ? null
        : await prisma.company.findUnique({ where: { id: companyId }, select: { name: true, logo: true } }).catch(() => null);
      // Our logo loads from the public site, so mail apps don't list it as an attachment.
      // Only without a public HTTPS address (local development) is it embedded in the email.
      // Builder logos are always public storage URLs.
      let emailHtml = prepareOutgoingEmail(html, { companyId, source, branding, builder });
      // Our own images (logo, CEO photo) load from the public site; without one they ride along inline.
      const embedded = [];
      if (!hasPublicLogoUrl()) {
        for (const img of INLINE_IMAGES) {
          const re = new RegExp(`(<img\\b[^>]*\\bsrc\\s*=\\s*)(["'])(?:https?:\\/\\/[^"']*\\/${img.file.replace(".", "\\.")}(?:\\?[^"']*)?|cid:${img.cid})\\2`, "gi");
          emailHtml = emailHtml.replace(re, (_match, prefix, quote) => {
            if (!embedded.includes(img)) embedded.push(img);
            return `${prefix}${quote}cid:${img.cid}${quote}`;
          });
        }
      }
      const info = await this.getPlatformTransporter().sendMail({
        from: fromString,
        ...(replyToAddress ? { replyTo: replyToAddress } : {}),
        to,
        subject,
        html: emailHtml,
        attachments: [
          ...attachments,
          ...embedded.map((img) => ({
            filename: img.file,
            path: fileURLToPath(new URL(`../../../public/${img.file}`, import.meta.url)),
            cid: img.cid,
            contentType: img.type,
            contentDisposition: "inline",
          })),
        ],
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

  static async sendTicketStatusUpdate(to, homeownerName, ticket, status, company = null, companyId = null) {
    const statusLabel = status.replace("_", " ").toLowerCase();
    const subject = `Ticket Update: ${ticketRef(ticket)} is now ${statusLabel}`;

    const companyName = company?.name || "Aiforhomebuilder";
    const companyEmail = company?.email || this.SENDER_EMAIL;
    const portalUrl = process.env.NEXT_PUBLIC_URL || "";

    const html = Templates.getTicketUpdateEmail(
      homeownerName,
      ticket,
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
