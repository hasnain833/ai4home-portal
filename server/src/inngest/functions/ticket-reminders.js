import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { notifyTicketReminder } from "../../services/notification-service.js";

/**
 * Stale-ticket reminders (FR: ticket reminders for homebuilders).
 *
 * A ticket that is still OPEN has not been actioned by anyone. We nag the
 * company admins on a fixed cycle until they move it out of OPEN, capped so a
 * forgotten ticket cannot mail somebody forever.
 *
 * Emergencies run on a much shorter cycle — an urgent leak sitting unread for
 * two days is the exact failure this is here to prevent.
 */

const HOUR = 60 * 60 * 1000;
const STANDARD_INTERVAL_HOURS = 48;
const EMERGENCY_INTERVAL_HOURS = 4;
const MAX_REMINDERS = 3;
const BATCH_SIZE = 200;

const isUrgent = (ticket) => ticket.isEmergency || ticket.priority === "URGENT";

export const intervalHoursFor = (ticket) =>
  isUrgent(ticket) ? EMERGENCY_INTERVAL_HOURS : STANDARD_INTERVAL_HOURS;

/** "3 hours" / "2 days" — used in the subject line, so it has to read naturally. */
export function formatAge(ms) {
  const hours = Math.floor(ms / HOUR);
  if (hours < 1) return "less than an hour";
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Whether this ticket is due for its next nag. The clock runs from the last
 * reminder, or from creation if none has been sent yet.
 */
export function reminderIsDue(ticket, now = Date.now()) {
  if (ticket.status !== "OPEN") return false;
  if ((ticket.reminderCount ?? 0) >= MAX_REMINDERS) return false;
  const since = (ticket.lastReminderAt || ticket.createdAt).getTime();
  return now - since >= intervalHoursFor(ticket) * HOUR;
}

export const ticketReminders = inngest.createFunction(
  { id: "ticket-reminders", triggers: [{ cron: "0 * * * *" }] },
  async ({ step }) => {
    const now = Date.now();

    return step.run("send-due-ticket-reminders", async () => {
      // Cheap pre-filter: nothing can be due before the shortest interval has
      // elapsed, so the database never hands us the whole open backlog.
      const candidates = await prisma.ticket.findMany({
        where: {
          status: "OPEN",
          reminderCount: { lt: MAX_REMINDERS },
          createdAt: { lte: new Date(now - EMERGENCY_INTERVAL_HOURS * HOUR) },
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
          // Leave the counter alone so the next run retries this ticket.
          console.error(`[Ticket Reminders] #${ticket.id} failed: ${result.error}`);
          continue;
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
