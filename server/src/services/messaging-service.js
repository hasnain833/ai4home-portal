import { MailService } from "./mail-service.js";
import { sendSms } from "./sms.service.js";
import { ComplianceService } from "./compliance-service.js";
import prisma from "../lib/prisma.js";
import { SmsTemplates } from "./templates.js";
import { ticketRef } from "../lib/ticket-number.js";

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

  static async sendWarrantySms({ companyId, to, body, source }) {
    if (!to) return { outcome: "skipped", reason: "no phone" };
    try {
      const r = await this.sendSms({
        companyId,
        to,
        body: `${body} Replies are not monitored; reply STOP to opt out.`,
        source: `warranty-${source}`,
      });
      if (r?.outcome !== "sent") console.warn(`[Warranty SMS] ${source} to ${to} not sent — ${r?.error || r?.reason || r?.outcome}`);
      return r;
    } catch (err) {
      console.error(`[Warranty SMS] ${source} to ${to} failed:`, err.message);
      return { outcome: "failed", error: err.message };
    }
  }

  static async sendTicketStatusUpdate({ companyId, to, homeownerName, ticket, status, company }) {
    if (companyId && to) {
      const { suppressed, reason } = await ComplianceService.checkSuppression(companyId, "EMAIL", to);
      if (suppressed) {
        console.warn(`[Messaging] Ticket-status email to ${to} blocked — on suppression list (${reason}).`);
        return { success: false, outcome: "blocked", blocked: true, reason: `Suppressed (${reason})` };
      }
    }
    return MailService.sendTicketStatusUpdate(to, homeownerName, ticket, status, company, companyId);
  }

  static async notifyTicketStatusChange(ticketId, status) {
    try {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: { homeowner: { include: { company: true } } },
      });
      if (!ticket?.homeowner) return { success: false, reason: "no homeowner" };

      const companyId = ticket.homeowner.companyId;

      await this.sendWarrantySms({
        companyId,
        to: ticket.homeowner.phone,
        body: SmsTemplates.getTicketStatusSms(
          ticketRef(ticket),
          status.replace("_", " ").toLowerCase(),
          `${process.env.NEXT_PUBLIC_URL || ""}/warranty/tickets/${ticket.id}`,
        ),
        source: "ticket-status",
      });
      if (!ticket.homeowner.email) return { success: false, reason: "no email" };

      return await this.sendTicketStatusUpdate({
        companyId,
        to: ticket.homeowner.email,
        homeownerName: ticket.homeowner.name || "Homeowner",
        ticket,
        status,
        company: ticket.homeowner.company,
      });
    } catch (err) {
      console.error(`[Messaging] notifyTicketStatusChange failed for ${ticketId}:`, err.message);
      return { success: false, error: err.message };
    }
  }
}
