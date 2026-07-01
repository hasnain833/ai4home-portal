import { MailService } from "./mail-service.js";
import { sendSms } from "./sms.service.js";
import { ComplianceService } from "./compliance-service.js";

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
}
