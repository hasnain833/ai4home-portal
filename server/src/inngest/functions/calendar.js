import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";

export const scheduleCalendarItem = inngest.createFunction(
  {
    id: "schedule-calendar-item",
    name: "Schedule Calendar Item",
    triggers: [{ event: "calendar.item.scheduled" }]
  },
  async ({ event, step }) => {
    const { calendarId, scheduledAt } = event.data;

    await step.sleepUntil("wait-for-date", scheduledAt);

    const item = await step.run("fetch-calendar-item", async () => {
      return prisma.contentCalendar.findUnique({
        where: { id: calendarId },
      });
    });

    if (!item || item.status !== "Scheduled") {
      return { skipped: true, reason: "Item is no longer Scheduled" };
    }

    const dispatchResult = await step.run("dispatch-calendar-item", async () => {
      let success = true;
      let reason = "Dispatched";

      try {
        if (item.channel === "Email" || item.channel === "SMS") {
          console.warn(`[Calendar Executor] Dispatching ${item.channel} item ${item.id}. Audience logic pending SW-ANN.`);
        } else if (item.channel === "Blog" || item.channel === "Announcement") {
          console.log(`[Calendar Executor] Publishing ${item.channel} item ${item.id}.`);
        }
      } catch (err) {
        success = false;
        reason = err.message;
      }

      // Update status
      await prisma.contentCalendar.update({
        where: { id: item.id },
        data: { status: success ? (item.channel === "Blog" || item.channel === "Announcement" ? "Published" : "Sent") : "Failed" },
      });

      return { success, reason };
    });

    return { calendarId, dispatchResult };
  }
);
