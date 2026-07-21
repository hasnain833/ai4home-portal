import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { deadLetterJob } from "../../lib/dead-letter.js";

export const scheduleCalendarItem = inngest.createFunction(
  {
    id: "schedule-calendar-item",
    name: "Schedule Calendar Item",
    concurrency: [{ key: "event.data.companyId", limit: 3 }],
    triggers: [{ event: "calendar.item.scheduled" }],
    onFailure: async ({ event, error }) =>
      deadLetterJob({ functionId: "schedule-calendar-item", event, error }),
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
