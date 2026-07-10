import { MailService } from "./mail-service.js";
import { sendSms } from "./sms.service.js";
import { ComplianceService } from "./compliance-service.js";
import prisma from "../lib/prisma.js";
import { getMessagingConfig } from "../lib/messaging-config.js";

export class MessagingService {

  static async sendEmail({ companyId, to, subject, html, fromName, fromEmail, smtpConfig }) {
    if (companyId && to) {
      const { suppressed, reason } = await ComplianceService.checkSuppression(companyId, "EMAIL", to);
      if (suppressed) {
        console.warn(`[Messaging] Email to ${to} blocked — on suppression list (${reason}).`);
        return { success: false, blocked: true, reason: `Suppressed (${reason})` };
      }
    }
    return MailService.sendEmail({ to, subject, html, fromName, fromEmail, smtpConfig });
  }

  static async sendSms({ companyId, to, body, smsConfig, addOptOut = true }) {
    if (companyId && to) {
      const { suppressed, reason } = await ComplianceService.checkSuppression(companyId, "SMS", to);
      if (suppressed) {
        console.warn(`[Messaging] SMS to ${to} blocked — on suppression list (${reason}).`);
        return { blocked: true, reason: `Suppressed (${reason})` };
      }
    }
    const finalBody = addOptOut ? ComplianceService.addSmsOptOutSuffix(body) : body;
    return sendSms({ to, body: finalBody, smsConfig });
  }

  static async sendTicketStatusUpdate({ companyId, to, homeownerName, ticketId, status, company, smtpConfig }) {
    if (companyId && to) {
      const { suppressed, reason } = await ComplianceService.checkSuppression(companyId, "EMAIL", to);
      if (suppressed) {
        console.warn(`[Messaging] Ticket-status email to ${to} blocked — on suppression list (${reason}).`);
        return { success: false, blocked: true, reason: `Suppressed (${reason})` };
      }
    }
    return MailService.sendTicketStatusUpdate(to, homeownerName, ticketId, status, company, smtpConfig);
  }

  // FR-16 proactive status reminders: send a status-change email for a ticket,
  // resolving the homeowner, company, and per-company SMTP config from the DB
  // (falls back to the platform default transporter only if the tenant has no
  // Brevo integration saved). Safe to call from any status-change path
  // (portal update or Botpress sync) — no-ops quietly if the homeowner has no email.
  static async notifyTicketStatusChange(ticketId, status) {
    try {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: { homeowner: { include: { company: true } } },
      });
      if (!ticket?.homeowner?.email) return { success: false, reason: "no email" };

      const companyId = ticket.homeowner.companyId;
      const { smtpConfig } = await getMessagingConfig(companyId);

      return await this.sendTicketStatusUpdate({
        companyId,
        to: ticket.homeowner.email,
        homeownerName: ticket.homeowner.name || "Homeowner",
        ticketId: ticket.id,
        status,
        company: ticket.homeowner.company,
        smtpConfig,
      });
    } catch (err) {
      console.error(`[Messaging] notifyTicketStatusChange failed for ${ticketId}:`, err.message);
      return { success: false, error: err.message };
    }
  }
}
