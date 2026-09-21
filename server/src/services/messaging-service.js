import { MailService } from "./mail-service.js";
import { sendSms } from "./sms.service.js";
import { ComplianceService } from "./compliance-service.js";
import prisma from "../lib/prisma.js";

export class MessagingService {

  static async sendEmail({ companyId, to, subject, html, fromName, fromEmail, replyTo, source }) {
    if (companyId && to) {
      const { suppressed, reason } = await ComplianceService.checkSuppression(companyId, "EMAIL", to);
      if (suppressed) {
        console.warn(`[Messaging] Email to ${to} blocked — on suppression list (${reason}).`);
        return { success: false, outcome: "blocked", blocked: true, reason: `Suppressed (${reason})` };
      }
    }
    return MailService.sendEmail({ to, subject, html, fromName, fromEmail, replyTo, companyId, source });
  }

  static async sendSms({ companyId, to, body, addOptOut = true, tag, source }) {
    if (companyId && to) {
      const { suppressed, reason } = await ComplianceService.checkSuppression(companyId, "SMS", to);
      if (suppressed) {
        console.warn(`[Messaging] SMS to ${to} blocked — on suppression list (${reason}).`);
        return { outcome: "blocked", blocked: true, reason: `Suppressed (${reason})` };
      }
    }
    const finalBody = addOptOut ? ComplianceService.addSmsOptOutSuffix(body) : body;
    return sendSms({ to, body: finalBody, companyId, tag, source });
  }

  static async sendTicketStatusUpdate({ companyId, to, homeownerName, ticketId, status, company }) {
    if (companyId && to) {
      const { suppressed, reason } = await ComplianceService.checkSuppression(companyId, "EMAIL", to);
      if (suppressed) {
        console.warn(`[Messaging] Ticket-status email to ${to} blocked — on suppression list (${reason}).`);
        return { success: false, outcome: "blocked", blocked: true, reason: `Suppressed (${reason})` };
      }
    }
    return MailService.sendTicketStatusUpdate(to, homeownerName, ticketId, status, company, companyId);
  }

  static async notifyTicketStatusChange(ticketId, status) {
    try {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: { homeowner: { include: { company: true } } },
      });
      if (!ticket?.homeowner?.email) return { success: false, reason: "no email" };

      const companyId = ticket.homeowner.companyId;

      return await this.sendTicketStatusUpdate({
        companyId,
        to: ticket.homeowner.email,
        homeownerName: ticket.homeowner.name || "Homeowner",
        ticketId: ticket.id,
        status,
        company: ticket.homeowner.company,
      });
    } catch (err) {
      console.error(`[Messaging] notifyTicketStatusChange failed for ${ticketId}:`, err.message);
      return { success: false, error: err.message };
    }
  }
}
