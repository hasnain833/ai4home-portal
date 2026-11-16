import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { formatSlotLabel } from "../../lib/scheduling.js";
import { b2bLeadTimezone } from "../../lib/timezone.js";
import { getB2BAvailability } from "../../lib/b2b.js";
import { alertUnmarkedMeetings, insideSendWindow, sendMeetingReminder } from "../../lib/b2b-journey.js";
import { autoEnrollB2BLeads } from "../../services/b2b-auto-nurture.js";

const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Catches any new lead a creation path missed, and moves old journey leads into the 180-day nurture. */
export const b2bAutoNurtureSweep = inngest.createFunction(
  { id: "b2b-auto-nurture-sweep", triggers: [{ cron: "*/15 * * * *" }] },
  async ({ step }) => {
    const enrolled = await step.run("auto-enroll", () => autoEnrollB2BLeads());
    await step.run("unmarked-meetings", () => alertUnmarkedMeetings());
    return enrolled;
  },
);

export const b2bMeetingReminders = inngest.createFunction(
  { id: "b2b-meeting-reminders", triggers: [{ cron: "*/15 * * * *" }] },
  async ({ step }) =>
    step.run("send", async () => {
      const now = Date.now();
      const rows = await prisma.salesAgentAppointment.findMany({
        where: {
          status: "CONFIRMED",
          reminderSentAt: null,
          b2bLeadId: { not: null },
          startTime: { gt: new Date(now), lte: new Date(now + REMINDER_WINDOW_MS) },
          // A meeting booked for today already has a fresh confirmation.
          createdAt: { lte: new Date(now - 6 * 60 * 60 * 1000) },
        },
        include: { b2bLead: true },
        take: 100,
      });
      const setting = await getB2BAvailability();
      let sent = 0;
      for (const appointment of rows) {
        // Same 8am-9pm rule as every other text. Outside it, a later run picks this up;
        // a meeting that starts before the window opens just keeps its confirmation.
        if (!insideSendWindow(appointment.b2bLead, new Date(now))) continue;
        const { timezone, known } = b2bLeadTimezone(appointment.b2bLead);
        if (await sendMeetingReminder(appointment, formatSlotLabel(appointment.startTime, known ? timezone : setting.timezone))) sent++;
      }
      return { sent };
    }),
);
