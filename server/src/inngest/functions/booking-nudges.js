import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { notifyTicketDispatched } from "../../services/ticket-appointment-service.js";

const HOUR = 60 * 60 * 1000;
const BATCH_SIZE = 100;

export const NUDGE_AFTER_HOURS = 48;
export const NUDGE_INTERVAL_HOURS = 72;
export const MAX_NUDGES = 2;


export function nudgeIsDue(ticket, now = Date.now()) {
  if (ticket.status !== "DISPATCHED") return false;
  if (!ticket.bookingToken) return false; // already booked — the token is cleared on booking
  if ((ticket.reminderCount ?? 0) >= MAX_NUDGES) return false;

  const last = ticket.lastReminderAt?.getTime() ?? null;
  const hours = last === null ? NUDGE_AFTER_HOURS : NUDGE_INTERVAL_HOURS;
  const since = last ?? ticket.updatedAt.getTime();
  return now - since >= hours * HOUR;
}

export const bookingNudges = inngest.createFunction(
  { id: "ticket-booking-nudges", triggers: [{ cron: "0 */6 * * *" }] },
  async ({ step }) => {
    const now = Date.now();

    return step.run("nudge-unbooked-dispatched-tickets", async () => {
      const candidates = await prisma.ticket.findMany({
        where: {
          status: "DISPATCHED",
          bookingToken: { not: null },
          reminderCount: { lt: MAX_NUDGES },
          appointments: { none: { status: "SCHEDULED" } },
        },
        select: {
          id: true,
          status: true,
          bookingToken: true,
          reminderCount: true,
          lastReminderAt: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "asc" },
        take: BATCH_SIZE,
      });

      let nudged = 0;
      let undelivered = 0;

      for (const ticket of candidates) {
        if (!nudgeIsDue(ticket, now)) continue;

        const result = await notifyTicketDispatched(ticket.id, { nudge: true });
        if (!result.ok) {
          console.error(
            `[Booking Nudges] ${ticket.id} not sent${result.error ? `: ${result.error}` : ""} — will retry.`,
          );
          continue;
        }
        if (result.homeownerDelivered === false) {
          console.error(
            `[Booking Nudges] ${ticket.id}: booking link still not reaching the homeowner. ` +
              `Needs a human to follow up.`,
          );
          undelivered++;
        }

        await prisma.ticket.update({
          where: { id: ticket.id },
          data: { reminderCount: { increment: 1 }, lastReminderAt: new Date() },
        });
        nudged++;
      }

      console.log(
        `[Booking Nudges] checked ${candidates.length}, nudged ${nudged}, undelivered ${undelivered}.`,
      );
      return { checked: candidates.length, nudged, undelivered };
    });
  },
);
