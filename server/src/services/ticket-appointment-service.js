import prisma from "../lib/prisma.js";
import { MessagingService } from "./messaging-service.js";
import { MailService } from "./mail-service.js";
import { Templates } from "./templates.js";
import { companyAdmins, writeNotifications } from "./notification-service.js";

const portalUrl = () => process.env.NEXT_PUBLIC_URL || "";

const DEFAULT_TZ = "America/New_York";

export async function companyTimezone(companyId) {
  if (!companyId) return DEFAULT_TZ;
  const setting = await prisma.availabilitySetting
    .findUnique({ where: { companyId }, select: { timezone: true } })
    .catch(() => null);
  return setting?.timezone || DEFAULT_TZ;
}

export function formatWhen(date, timeZone = DEFAULT_TZ) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
      timeZone,
    }).format(new Date(date));
  } catch {
    return new Date(date).toISOString();
  }
}

function detailsFor(appointment, whenLabel) {
  const ticket = appointment.ticket || {};
  return {
    ticketId: appointment.ticketId,
    issueType: ticket.issueType || "Warranty issue",
    ticketCategory: ticket.ticketType || null,
    description: ticket.description || null,
    priority: ticket.priority || null,
    warrantyYear: ticket.warrantyYear ?? null,
    whenLabel,
    durationMinutes: appointment.durationMinutes || null,
    address: ticket.property?.address || appointment.location || null,
    // The assignee is stored on the appointment as tradeName/tradeEmail — the
    // columns predate staff assignment, so they carry the staff member now.
    tradeName: appointment.tradeName || null,
    staffName: appointment.tradeName || null,
    homeownerName: appointment.homeowner?.name || "Homeowner",
    homeownerEmail: appointment.homeowner?.email || null,
    notes: appointment.notes || null,
    // Self-service: the homeowner can move or cancel from any mail they get,
    // which is what "reminder gives ability to change appointment" means.
    manageUrl: appointment.rescheduleToken
      ? `${portalUrl()}/schedule/manage/${appointment.rescheduleToken}`
      : null,
  };
}

export function appointmentWithContext(id) {
  return prisma.ticketAppointment.findUnique({
    where: { id },
    include: {
      homeowner: true,
      company: true,
      ticket: {
        select: {
          issueType: true,
          ticketType: true,
          description: true,
          priority: true,
          warrantyYear: true,
          property: { select: { address: true } },
        },
      },
    },
  });
}

async function dispatch(appointment, kind, { windowLabel = null, rescheduled = false } = {}) {
  const companyId = appointment.companyId;
  const company = appointment.company || null;
  const companyName = company?.name || "Aiforhomebuilder";
  const tz = await companyTimezone(companyId);
  const whenLabel = formatWhen(appointment.scheduledAt, tz);
  const details = detailsFor(appointment, whenLabel);

  const emailReady = MailService.hasPlatformSender();

  const admins = await companyAdmins(companyId);

  const notificationCopy = {
    scheduled: {
      type: "APPOINTMENT_SCHEDULED",
      title: `Visit booked for ticket #${appointment.ticketId}`,
      body: `${whenLabel} with ${details.homeownerName}${details.tradeName ? ` — ${details.tradeName}` : ""}.`,
    },
    reminder: {
      type: "APPOINTMENT_REMINDER",
      title: `Visit ${windowLabel} — ticket #${appointment.ticketId}`,
      body: `${whenLabel} with ${details.homeownerName}${details.tradeName ? ` — ${details.tradeName}` : ""}.`,
    },
    cancelled: {
      type: "APPOINTMENT_CANCELLED",
      title: `Visit cancelled for ticket #${appointment.ticketId}`,
      body: `The visit scheduled for ${whenLabel} was cancelled.`,
    },
  }[kind];

  // In-portal, for the trade side. Always written.
  if (companyId && admins.length) {
    await writeNotifications(
      admins.map((a) => ({
        companyId,
        userId: a.id,
        type: notificationCopy.type,
        title: notificationCopy.title,
        body: notificationCopy.body,
        link: `/warranty/tickets/${appointment.ticketId}`,
        ticketId: appointment.ticketId,
        emailFallback: !emailReady,
      })),
    );
  }

  if (!emailReady) {
    console.warn(
      `[Appointment Notify] ${appointment.id} (${kind}): in-portal only — no email credentials for this workspace.`,
    );
    return { ok: true, notified: admins.length, emailed: 0, emailConfigured: false };
  }

  // "scheduled" covers both the initial dispatch and a later reschedule. The two
  // sides get different mail: staff the full ticket, the homeowner just the visit.
  const htmlFor = (role) => {
    if (kind === "scheduled")
      return role === "homeowner"
        ? Templates.getTicketDispatchHomeownerEmail(details, portalUrl(), companyName, { rescheduled })
        : Templates.getTicketDispatchStaffEmail(details, portalUrl(), companyName, { rescheduled });
    if (kind === "reminder")
      return Templates.getTicketAppointmentReminderEmail(role, details, windowLabel, portalUrl(), companyName);
    return Templates.getTicketAppointmentCancelledEmail(role, details, portalUrl(), companyName);
  };

  const subjectFor = (role) => {
    const suffix = `ticket #${appointment.ticketId}`;
    if (kind === "scheduled") {
      if (rescheduled)
        return role === "homeowner"
          ? `Your repair visit has moved — ${whenLabel}`
          : `Visit rescheduled for ${suffix} — ${whenLabel}`;
      return role === "homeowner"
        ? `Your repair visit is booked — ${whenLabel}`
        : `You've been assigned ${suffix} — ${whenLabel}`;
    }
    if (kind === "reminder")
      return role === "homeowner"
        ? `Reminder: your repair visit is ${windowLabel}`
        : `Reminder: visit ${windowLabel} for ${suffix}`;
    return role === "homeowner"
      ? `Your repair visit has been cancelled`
      : `Visit cancelled for ${suffix}`;
  };

  const send = (to, role) =>
    MessagingService.sendEmail({
      companyId,
      to,
      subject: subjectFor(role),
      html: htmlFor(role),
      fromName: companyName,
      fromEmail: company?.email || undefined,
      companyId,
      source: "ticket-appointment",
    });

  let emailed = 0;
  let attempted = 0;

  let homeownerDelivered = null;
  if (appointment.homeowner?.email) {
    attempted++;
    const r = await send(appointment.homeowner.email, "homeowner");
    homeownerDelivered = Boolean(r.success);
    if (r.success) emailed++;
    else
      console.warn(
        `[Appointment Notify] ${appointment.id}: homeowner email not delivered — ${r.error || r.reason}`,
      );
  }

  // The assigned staff member is the one who needs the mail. Admins already have
  // the in-portal notification written above, so they are only mailed as a
  // fallback for legacy appointments that were booked without an assignee.
  const staffRecipients = new Set(
    appointment.tradeEmail ? [appointment.tradeEmail] : admins.map((a) => a.email).filter(Boolean),
  );

  for (const to of staffRecipients) {
    attempted++;
    const r = await send(to, "staff");
    if (r.success) emailed++;
    else
      console.warn(
        `[Appointment Notify] ${appointment.id}: staff email to ${to} not delivered — ${r.error || r.reason}`,
      );
  }

  const ok = attempted === 0 || emailed > 0;
  return {
    ok,
    notified: admins.length,
    emailed,
    attempted,
    homeownerDelivered,
    emailConfigured: true,
  };
}

export async function notifyAppointmentScheduled(appointmentId, { rescheduled = false } = {}) {
  try {
    const appointment = await appointmentWithContext(appointmentId);
    if (!appointment) return { ok: false, reason: "appointment not found" };
    return await dispatch(appointment, "scheduled", { rescheduled });
  } catch (err) {
    console.error(`[Appointment Notify] scheduled failed for ${appointmentId}:`, err.message);
    return { ok: false, error: err.message };
  }
}

export async function notifyAppointmentCancelled(appointmentId) {
  try {
    const appointment = await appointmentWithContext(appointmentId);
    if (!appointment) return { ok: false, reason: "appointment not found" };
    return await dispatch(appointment, "cancelled");
  } catch (err) {
    console.error(`[Appointment Notify] cancelled failed for ${appointmentId}:`, err.message);
    return { ok: false, error: err.message };
  }
}

export async function notifyAppointmentReminder(appointment, windowLabel) {
  try {
    return await dispatch(appointment, "reminder", { windowLabel });
  } catch (err) {
    console.error(`[Appointment Notify] reminder failed for ${appointment?.id}:`, err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Dispatch: the homeowner gets a booking link, the staff member gets the job.
 * No visit exists yet, so this deliberately does not go through the appointment
 * notifier — there is nothing to confirm until a time is picked.
 *
 * `nudge` re-sends the same invitation to a homeowner who never booked.
 */
export async function notifyTicketDispatched(ticketId, { nudge = false } = {}) {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        homeowner: true,
        company: true,
        assignedStaff: { select: { name: true, email: true } },
        property: { select: { address: true } },
      },
    });
    if (!ticket) return { ok: false, reason: "ticket not found" };
    if (!ticket.bookingToken) return { ok: false, reason: "ticket has no booking token" };

    const companyId = ticket.companyId || ticket.homeowner?.companyId || null;
    const company = ticket.company || null;
    const companyName = company?.name || "Aiforhomebuilder";
    const staffName = ticket.assignedStaff?.name || ticket.assignedStaff?.email || null;

    const details = {
      ticketId: ticket.id,
      issueType: ticket.issueType || "Warranty issue",
      ticketCategory: ticket.ticketType || null,
      description: ticket.description || null,
      priority: ticket.priority || null,
      warrantyYear: ticket.warrantyYear ?? null,
      address: ticket.property?.address || null,
      staffName,
      homeownerName: ticket.homeowner?.name || "Homeowner",
      homeownerEmail: ticket.homeowner?.email || null,
      notes: ticket.dispatchNotes || null,
    };

    const emailReady = MailService.hasPlatformSender();

    const admins = await companyAdmins(companyId);
    if (companyId && admins.length) {
      await writeNotifications(
        admins.map((a) => ({
          companyId,
          userId: a.id,
          type: "APPOINTMENT_SCHEDULED",
          title: `Ticket #${ticket.id} dispatched to ${staffName || "a staff member"}`,
          body: `Awaiting the homeowner's chosen time.`,
          link: `/warranty/tickets/${ticket.id}`,
          ticketId: ticket.id,
          emailFallback: !emailReady,
        })),
      );
    }

    if (!emailReady) {
      console.warn(
        `[Dispatch Notify] ${ticket.id}: in-portal only — no email credentials for this workspace.`,
      );
      return { ok: true, emailed: 0, emailConfigured: false, homeownerDelivered: false };
    }

    const bookingUrl = `${portalUrl()}/schedule/${ticket.bookingToken}`;

    const send = (to, subject, html) =>
      MessagingService.sendEmail({
        companyId,
        to,
        subject,
        html,
        fromName: companyName,
        fromEmail: company?.email || undefined,
        source: "ticket-dispatch",
      });

    let homeownerDelivered = null;
    if (ticket.homeowner?.email) {
      const r = await send(
        ticket.homeowner.email,
        nudge
          ? `Reminder: pick a time for your repair visit`
          : `Choose a time for your repair visit — claim #${ticket.id}`,
        Templates.getTicketBookingInviteEmail(details, bookingUrl, companyName, { nudge }),
      );
      homeownerDelivered = Boolean(r.success);
      if (!r.success) {
        console.warn(
          `[Dispatch Notify] ${ticket.id}: booking link did NOT reach the homeowner — ${r.error || r.reason}`,
        );
      }
    } else {
      homeownerDelivered = false;
      console.warn(`[Dispatch Notify] ${ticket.id}: homeowner has no email address on file.`);
    }

    // A nudge is aimed at the homeowner alone; the staff member already knows.
    if (!nudge && ticket.assignedStaff?.email) {
      const r = await send(
        ticket.assignedStaff.email,
        `You've been assigned ticket #${ticket.id}`,
        Templates.getTicketAssignmentEmail(details, portalUrl(), companyName),
      );
      if (!r.success) {
        console.warn(
          `[Dispatch Notify] ${ticket.id}: assignment email to ${ticket.assignedStaff.email} not delivered — ${r.error || r.reason}`,
        );
      }
    }

    return { ok: true, emailConfigured: true, homeownerDelivered };
  } catch (err) {
    console.error(`[Dispatch Notify] failed for ${ticketId}:`, err.message);
    return { ok: false, error: err.message };
  }
}
