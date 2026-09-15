import prisma from "../lib/prisma.js";
import { MessagingService } from "./messaging-service.js";
import { getMessagingConfig } from "../lib/messaging-config.js";
import { Templates } from "./templates.js";
import { companyAdmins, writeNotifications, emailIsConfigured } from "./notification-service.js";

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
  return {
    ticketId: appointment.ticketId,
    issueType: appointment.ticket?.issueType || "Warranty issue",
    whenLabel,
    address: appointment.ticket?.property?.address || appointment.location || null,
    tradeName: appointment.tradeName || null,
    homeownerName: appointment.homeowner?.name || "Homeowner",
    notes: appointment.notes || null,
  };
}

export function appointmentWithContext(id) {
  return prisma.ticketAppointment.findUnique({
    where: { id },
    include: {
      homeowner: true,
      company: true,
      ticket: { include: { property: { select: { address: true } } } },
    },
  });
}

async function dispatch(appointment, kind, { windowLabel = null } = {}) {
  const companyId = appointment.companyId;
  const company = appointment.company || null;
  const companyName = company?.name || "Aiforhomebuilder";
  const tz = await companyTimezone(companyId);
  const whenLabel = formatWhen(appointment.scheduledAt, tz);
  const details = detailsFor(appointment, whenLabel);

  const { smtpConfig } = await getMessagingConfig(companyId);
  const emailReady = emailIsConfigured(smtpConfig);

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

  const htmlFor = (role) => {
    if (kind === "scheduled")
      return Templates.getTicketAppointmentEmail(role, details, portalUrl(), companyName);
    if (kind === "reminder")
      return Templates.getTicketAppointmentReminderEmail(role, details, windowLabel, portalUrl(), companyName);
    return Templates.getTicketAppointmentCancelledEmail(role, details, portalUrl(), companyName);
  };

  const subjectFor = (role) => {
    const suffix = `ticket #${appointment.ticketId}`;
    if (kind === "scheduled")
      return role === "homeowner"
        ? `Your repair visit is booked — ${whenLabel}`
        : `Visit booked for ${suffix} — ${whenLabel}`;
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
      smtpConfig,
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

  const tradeRecipients = new Set(admins.map((a) => a.email).filter(Boolean));
  if (appointment.tradeEmail) tradeRecipients.add(appointment.tradeEmail);

  for (const to of tradeRecipients) {
    attempted++;
    const r = await send(to, "trade");
    if (r.success) emailed++;
    else
      console.warn(
        `[Appointment Notify] ${appointment.id}: trade email to ${to} not delivered — ${r.error || r.reason}`,
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

export async function notifyAppointmentScheduled(appointmentId) {
  try {
    const appointment = await appointmentWithContext(appointmentId);
    if (!appointment) return { ok: false, reason: "appointment not found" };
    return await dispatch(appointment, "scheduled");
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
