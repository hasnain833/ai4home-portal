import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { notifyTicketReminder } from "../../services/notification-service.js";


const HOUR = 60 * 60 * 1000;
const STANDARD_INTERVAL_HOURS = 48;
const EMERGENCY_INTERVAL_HOURS = 4;
const MAX_REMINDERS = 3;
const BATCH_SIZE = 200;
const CHASEABLE_STATUSES = ["OPEN", "ESCALATED"];

const isUrgent = (ticket) => ticket.isEmergency || ticket.priority === "URGENT";

export const intervalHoursFor = (ticket) =>
  isUrgent(ticket) ? EMERGENCY_INTERVAL_HOURS : STANDARD_INTERVAL_HOURS;

export function formatAge(ms) {
  const hours = Math.floor(ms / HOUR);
  if (hours < 1) return "less than an hour";
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function reminderIsDue(ticket, now = Date.now()) {
  if (!CHASEABLE_STATUSES.includes(ticket.status)) return false;
  if ((ticket.reminderCount ?? 0) >= MAX_REMINDERS) return false;
  const since = (ticket.lastReminderAt || ticket.createdAt).getTime();
  return now - since >= intervalHoursFor(ticket) * HOUR;
}

export const ticketReminders = inngest.createFunction(
  { id: "ticket-reminders", triggers: [{ cron: "0 * * * *" }] },
  async ({ step }) => {
    const now = Date.now();

    return step.run("send-due-ticket-reminders", async () => {

      const urgentCutoff = new Date(now - EMERGENCY_INTERVAL_HOURS * HOUR);
      const standardCutoff = new Date(now - STANDARD_INTERVAL_HOURS * HOUR);
      const dueSince = (cutoff) => ({
        OR: [
          { lastReminderAt: { lte: cutoff } },
          { lastReminderAt: null, createdAt: { lte: cutoff } },
        ],
      });

      const candidates = await prisma.ticket.findMany({
        where: {
          status: { in: CHASEABLE_STATUSES },
          reminderCount: { lt: MAX_REMINDERS },
          OR: [
            {
              AND: [
                { OR: [{ isEmergency: true }, { priority: "URGENT" }] },
                dueSince(urgentCutoff),
              ],
            },
            {
              AND: [
                { isEmergency: false, priority: { not: "URGENT" } },
                dueSince(standardCutoff),
              ],
            },
          ],
        },
        include: { homeowner: { include: { company: true } } },
        orderBy: { createdAt: "asc" },
        take: BATCH_SIZE,
      });

      let sent = 0;
      let skipped = 0;

      for (const ticket of candidates) {
        if (!reminderIsDue(ticket, now)) {
          skipped++;
          continue;
        }

        const ageLabel = formatAge(now - ticket.createdAt.getTime());
        const result = await notifyTicketReminder(ticket, ageLabel);

        if (!result.ok) {
          console.error(`[Ticket Reminders] #${ticket.id} failed: ${result.error}`);
          continue;
        }
        if (result.emailConfigured && result.emailed === 0 && result.attempted > 0) {
          console.warn(
            `[Ticket Reminders] #${ticket.id}: in-portal only — all ${result.attempted} reminder email(s) failed.`,
          );
        }

        await prisma.ticket.update({
          where: { id: ticket.id },
          data: { reminderCount: { increment: 1 }, lastReminderAt: new Date(now) },
        });
        sent++;
      }

      console.log(`[Ticket Reminders] checked ${candidates.length}, sent ${sent}, not due ${skipped}.`);
      return { checked: candidates.length, sent, skipped };
    });
  },
);
