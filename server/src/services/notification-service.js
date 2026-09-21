import prisma from "../lib/prisma.js";
import { MessagingService } from "./messaging-service.js";
import { Templates } from "./templates.js";
import { MailService } from "./mail-service.js";


const portalUrl = () => process.env.NEXT_PUBLIC_URL || "";

const emailIsConfigured = () => MailService.hasPlatformSender();

export async function companyAdmins(companyId) {
  if (!companyId) return [];
  return prisma.user.findMany({
    where: { companyId, role: "ADMIN" },
    select: { id: true, email: true, name: true },
  });
}

export async function writeNotifications(rows) {
  if (!rows.length) return [];
  await prisma.notification.createMany({ data: rows });
  return rows;
}

export async function notifyTicketCreated(ticketId, { sendEmail = true } = {}) {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        homeowner: { include: { company: true } },
        property: { select: { address: true } },
      },
    });
    if (!ticket) return { ok: false, reason: "ticket not found" };

    const companyId = ticket.companyId || ticket.homeowner?.companyId || null;
    const company = ticket.homeowner?.company || null;
    const companyName = company?.name || "Aiforhomebuilder";
    const homeownerName = ticket.homeowner?.name || "Homeowner";
    const address = ticket.property?.address || null;
    const link = `/warranty/tickets/${ticket.id}`;

    const admins = await companyAdmins(companyId);

    const emailConfigured = emailIsConfigured();
    const emailReady = sendEmail && emailConfigured;
    const emailFallback = sendEmail && !emailConfigured;

    if (companyId && admins.length) {
      await writeNotifications(
        admins.map((a) => ({
          companyId,
          userId: a.id,
          type: "TICKET_CREATED",
          title: ticket.isEmergency
            ? `Emergency ticket #${ticket.id}`
            : `New ticket #${ticket.id}`,
          body: `${homeownerName} reported "${ticket.issueType}"${address ? ` at ${address}` : ""}.`,
          link,
          ticketId: ticket.id,
          emailFallback,
        })),
      );
    }

    if (!sendEmail) {
      console.info(
        `[Ticket Notify] #${ticket.id}: in-portal only — email suppressed by the creator.`,
      );
      return {
        ok: true,
        notified: admins.length,
        emailed: 0,
        emailConfigured: null,
        emailSkipped: true,
      };
    }

    if (!emailReady) {
      console.warn(
        `[Ticket Notify] #${ticket.id}: in-portal only — workspace has no email credentials configured.`,
      );
      return { ok: true, notified: admins.length, emailed: 0, emailConfigured: false };
    }

    let emailed = 0;

    if (ticket.homeowner?.email) {
      const result = await MessagingService.sendEmail({
        companyId,
        to: ticket.homeowner.email,
        source: "ticket-created-homeowner",
        subject: `We have received your warranty request — ticket #${ticket.id}`,
        html: Templates.getTicketCreatedHomeownerEmail(
          homeownerName,
          ticket.id,
          ticket.issueType,
          portalUrl(),
          companyName,
        ),
        fromName: companyName,
        fromEmail: company?.email || undefined,
      });
      if (result.success) emailed++;
      else
        console.warn(
          `[Ticket Notify] #${ticket.id}: homeowner email not delivered — ${result.error || result.reason}`,
        );
    }

    for (const admin of admins) {
      if (!admin.email) continue;
      const result = await MessagingService.sendEmail({
        companyId,
        to: admin.email,
        source: "ticket-created-admin",
        subject: ticket.isEmergency
          ? `Emergency warranty ticket #${ticket.id} — ${ticket.issueType}`
          : `New warranty ticket #${ticket.id} — ${ticket.issueType}`,
        html: Templates.getTicketCreatedAdminEmail(
          ticket.id,
          ticket.issueType,
          ticket.priority,
          ticket.isEmergency,
          homeownerName,
          address,
          portalUrl(),
          companyName,
        ),
        fromName: companyName,
        fromEmail: company?.email || undefined,
      });
      if (result.success) emailed++;
      else
        console.warn(
          `[Ticket Notify] #${ticket.id}: admin email to ${admin.email} not delivered — ${result.error || result.reason}`,
        );
    }

    return { ok: true, notified: admins.length, emailed, emailConfigured: true };
  } catch (err) {
    console.error(`[Ticket Notify] notifyTicketCreated failed for #${ticketId}:`, err.message);
    return { ok: false, error: err.message };
  }
}

export async function notifyTicketReminder(ticket, ageLabel) {
  try {
    const companyId = ticket.companyId || ticket.homeowner?.companyId || null;
    const company = ticket.homeowner?.company || null;
    const companyName = company?.name || "Aiforhomebuilder";
    const homeownerName = ticket.homeowner?.name || "Homeowner";
    const admins = await companyAdmins(companyId);
    if (!admins.length) return { ok: true, notified: 0, emailed: 0 };

    const emailReady = emailIsConfigured();

    await writeNotifications(
      admins.map((a) => ({
        companyId,
        userId: a.id,
        type: "TICKET_REMINDER",
        title: `Ticket #${ticket.id} still open`,
        body: `Open for ${ageLabel} with no action. ${homeownerName} reported "${ticket.issueType}".`,
        link: `/warranty/tickets/${ticket.id}`,
        ticketId: ticket.id,
        emailFallback: !emailReady,
      })),
    );

    if (!emailReady) {
      return { ok: true, notified: admins.length, emailed: 0, emailConfigured: false };
    }

    let emailed = 0;
    let attempted = 0;
    for (const admin of admins) {
      if (!admin.email) continue;
      const result = await MessagingService.sendEmail({
        companyId,
        to: admin.email,
        source: "ticket-reminder",
        subject: `Reminder: ticket #${ticket.id} has been open for ${ageLabel}`,
        html: Templates.getTicketReminderEmail(
          ticket.id,
          ticket.issueType,
          ticket.priority,
          ticket.isEmergency,
          homeownerName,
          ageLabel,
          portalUrl(),
          companyName,
        ),
        fromName: companyName,
        fromEmail: company?.email || undefined,
      });
      if (result.success) emailed++;
      else
        console.warn(
          `[Ticket Notify] #${ticket.id}: reminder email to ${admin.email} not delivered — ${result.error || result.reason}`,
        );
      attempted++;
    }

    return { ok: true, notified: admins.length, emailed, attempted, emailConfigured: true };
  } catch (err) {
    console.error(`[Ticket Notify] notifyTicketReminder failed for #${ticket?.id}:`, err.message);
    return { ok: false, error: err.message };
  }
}
