import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { notifyAppointmentReminder } from "../../services/ticket-appointment-service.js";

const HOUR = 60 * 60 * 1000;
const BATCH_SIZE = 200;

/**
 * The client asked for "2 days before, night before, morning of". These are
 * fixed offsets rather than wall-clock times, which is a deliberate trade: the
 * hour a reminder lands then depends on the appointment time.
 *
 * 3h is the last window because appointments fall between 09:00 and 17:00, so
 * it lands between 06:00 and 14:00 — the only offset in that range that never
 * sends in the middle of the night. 8h and 12h both do (a 09:00 visit would be
 * reminded at 01:00 and 21:00 respectively).
 *
 * Widest window first: whichever is the closest still-unsent window wins, so a
 * visit booked inside 48 hours does not get a burst of three emails at once.
 */
export const REMINDER_WINDOWS = [
  { tag: "48h", hours: 48, label: "in 2 days" },
  { tag: "24h", hours: 24, label: "tomorrow" },
  { tag: "3h", hours: 3, label: "in a few hours" },
];

export const LOOKAHEAD_HOURS = REMINDER_WINDOWS[0].hours;

/**
 * Which reminder, if any, is due for this appointment right now.
 * Returns the narrowest window that has come due and has not been sent.
 */
export function dueWindow(appointment, now = Date.now()) {
  if (appointment.status !== "SCHEDULED") return null;

  const hoursAway = (new Date(appointment.scheduledAt).getTime() - now) / HOUR;
  if (hoursAway <= 0) return null; // already started or passed

  const sent = new Set(appointment.remindersSent || []);

  // Narrowest first: if several windows have passed (a late-booked visit, or a
  // missed run) only the most urgent is worth sending.
  for (let i = REMINDER_WINDOWS.length - 1; i >= 0; i--) {
    const w = REMINDER_WINDOWS[i];
    if (!sent.has(w.tag) && hoursAway <= w.hours) return w;
  }
  return null;
}

export const windowLabelFor = (window) => window?.label ?? "soon";

export const ticketAppointmentReminders = inngest.createFunction(
  { id: "ticket-appointment-reminders", triggers: [{ cron: "*/15 * * * *" }] },
  async ({ step }) => {
    const now = Date.now();

    return step.run("send-due-appointment-reminders", async () => {
      const candidates = await prisma.ticketAppointment.findMany({
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

        const result = await notifyAppointmentReminder(appointment, window.label);
        if (!result.ok) {
          console.error(
            `[Appointment Reminders] ${appointment.id} not delivered to anyone` +
              `${result.error ? `: ${result.error}` : ""} — will retry.`,
          );
          failed++;
          continue;
        }
        if (result.homeownerDelivered === false) {
          console.error(
            `[Appointment Reminders] ${appointment.id}: reminder did NOT reach the homeowner ` +
              `(staff notified). Visit ${window.label}.`,
          );
        }

        // Tagged rather than flagged, so the set of windows can change without
        // a migration — and a skipped window stays skipped.
        await prisma.ticketAppointment.update({
          where: { id: appointment.id },
          data: { remindersSent: { push: window.tag } },
        });
        sent++;
      }

      console.log(
        `[Appointment Reminders] checked ${candidates.length}, sent ${sent}, undelivered ${failed}.`,
      );
      return { checked: candidates.length, sent, failed };
    });
  },
);
