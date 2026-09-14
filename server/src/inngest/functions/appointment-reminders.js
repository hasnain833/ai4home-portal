import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { notifyAppointmentReminder } from "../../services/ticket-appointment-service.js";

/**
 * Automated reminders for scheduled repair visits. Both sides — the homeowner
 * and the trade — are reminded, at 24 hours and again at 1 hour before the slot.
 *
 * Runs every 15 minutes so the 1-hour window is never missed by more than a
 * quarter hour. Each window has its own flag, so a reminder is sent at most once.
 */

const HOUR = 60 * 60 * 1000;
const BATCH_SIZE = 200;

/**
 * Which reminder, if any, is due for this appointment right now.
 * Returns "24h", "1h", or null.
 */
export function dueWindow(appointment, now = Date.now()) {
  if (appointment.status !== "SCHEDULED") return null;
  const hours = (new Date(appointment.scheduledAt).getTime() - now) / HOUR;
  if (hours <= 0) return null; // already started or passed
  if (!appointment.reminder24Sent && hours <= 24 && hours > 1) return "24h";
  if (!appointment.reminder1Sent && hours <= 1) return "1h";
  return null;
}

export const windowLabelFor = (window) => (window === "1h" ? "in about an hour" : "tomorrow");

export const ticketAppointmentReminders = inngest.createFunction(
  { id: "ticket-appointment-reminders", triggers: [{ cron: "*/15 * * * *" }] },
  async ({ step }) => {
    const now = Date.now();

    return step.run("send-due-appointment-reminders", async () => {
      const candidates = await prisma.ticketAppointment.findMany({
        where: {
          status: "SCHEDULED",
          scheduledAt: { gt: new Date(now), lte: new Date(now + 24 * HOUR) },
          OR: [{ reminder24Sent: false }, { reminder1Sent: false }],
        },
        include: {
          homeowner: true,
          company: true,
          ticket: { include: { property: { select: { address: true } } } },
        },
        orderBy: { scheduledAt: "asc" },
        take: BATCH_SIZE,
      });

      let sent = 0;

      for (const appointment of candidates) {
        const window = dueWindow(appointment, now);
        if (!window) continue;

        const result = await notifyAppointmentReminder(appointment, windowLabelFor(window));
        if (!result.ok) {
          // Leave the flag alone so the next run retries.
          console.error(`[Appointment Reminders] ${appointment.id} failed: ${result.error}`);
          continue;
        }

        await prisma.ticketAppointment.update({
          where: { id: appointment.id },
          data: window === "24h" ? { reminder24Sent: true } : { reminder1Sent: true },
        });
        sent++;
      }

      console.log(`[Appointment Reminders] checked ${candidates.length}, sent ${sent}.`);
      return { checked: candidates.length, sent };
    });
  },
);
