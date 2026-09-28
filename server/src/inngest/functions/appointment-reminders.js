import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { notifyAppointmentReminder } from "../../services/ticket-appointment-service.js";

const HOUR = 60 * 60 * 1000;
const BATCH_SIZE = 200;

export const REMINDER_WINDOWS = [
  { tag: "48h", hours: 48, label: "within 2 days" },
  { tag: "24h", hours: 24, label: "within 24 hours" },
  { tag: "3h", hours: 3, label: "in a few hours" },
];

export const LOOKAHEAD_HOURS = REMINDER_WINDOWS[0].hours;

/** Return the current reminder window, unless it was already delivered. */
export function dueWindow(appointment, now = Date.now()) {
  if (appointment.status !== "SCHEDULED") return null;

  const hoursAway = (new Date(appointment.scheduledAt).getTime() - now) / HOUR;
  if (hoursAway <= 0) return null;

  const sent = new Set(appointment.remindersSent || []);

  // Never fall back to an older window after the current reminder was sent.
  for (let i = REMINDER_WINDOWS.length - 1; i >= 0; i--) {
    const w = REMINDER_WINDOWS[i];
    if (hoursAway <= w.hours) return sent.has(w.tag) ? null : w;
  }
  return null;
}

export const windowLabelFor = (window) => window?.label ?? "soon";

export async function sendDueAppointmentReminders({
  db = prisma,
  notify = notifyAppointmentReminder,
  now = Date.now(),
} = {}) {
  const candidates = await db.ticketAppointment.findMany({
    where: {
      status: "SCHEDULED",
      scheduledAt: { gt: new Date(now), lte: new Date(now + LOOKAHEAD_HOURS * HOUR) },
      // A resolved claim's visits are closed out, so they never reach here.
      ticket: { status: { not: "RESOLVED" } },
    },
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
          assignedStaff: { select: { id: true, name: true, email: true } },
          property: { select: { address: true } },
        },
      },
    },
    orderBy: { scheduledAt: "asc" },
    take: BATCH_SIZE,
  });

  let sent = 0;
  let failed = 0;

  for (const appointment of candidates) {
    const window = dueWindow(appointment, now);
    if (!window) continue;

    const result = await notify(appointment, window.label);
    if (!result.ok) {
      console.error(
        `[Appointment Reminders] ${appointment.id} not delivered to anyone` +
          `${result.error ? `: ${result.error}` : ""} — will retry.`,
      );
      failed++;
      continue;
    }
    if (result.homeownerDelivered !== true) {
      console.error(
        `[Appointment Reminders] ${appointment.id}: reminder did NOT reach the homeowner ` +
          `(staff may have been notified). Visit ${window.label}; will retry.`,
      );
      failed++;
      continue;
    }

    // Tag only after homeowner delivery; failures remain eligible for retry.
    await db.ticketAppointment.update({
      where: { id: appointment.id },
      data: { remindersSent: { push: window.tag } },
    });
    sent++;
  }

  console.log(
    `[Appointment Reminders] checked ${candidates.length}, sent ${sent}, undelivered ${failed}.`,
  );
  return { checked: candidates.length, sent, failed };
}

export const ticketAppointmentReminders = inngest.createFunction(
  { id: "ticket-appointment-reminders", triggers: [{ cron: "*/15 * * * *" }] },
  async ({ step }) => {
    const now = Date.now();
    return step.run("send-due-appointment-reminders", () =>
      sendDueAppointmentReminders({ now }),
    );
  },
);
