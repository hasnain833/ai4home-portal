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

    // Only a blog post linked to this item can go out from the calendar. Emails, texts and
    // announcements are sent from Campaigns and Announcements, so they are never marked Sent here.
    const dispatchResult = await step.run("dispatch-calendar-item", async () => {
      const post = item.channel === "Blog"
        ? await prisma.blogPost.findFirst({ where: { calendarEventId: item.id, companyId: item.companyId } })
        : null;
      let reason;
      if (!post) reason = "No blog post is linked to this calendar item";
      else if (post.status === "PUBLISHED") reason = "Already published";
      else if (post.status !== "APPROVED" || !post.approvedAt) reason = "The linked blog post isn't approved";

      if (!reason) {
        const slug = post.slug || `${post.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "post"}-${post.id.slice(-6)}`;
        await prisma.blogPost.update({ where: { id: post.id }, data: { status: "PUBLISHED", publishedAt: new Date(), slug } });
      }
      const success = !reason || reason === "Already published";
      await prisma.contentCalendar.update({ where: { id: item.id }, data: { status: success ? "Published" : "Failed" } });
      return { success, reason: reason || "Published" };
    });

    return { calendarId, dispatchResult };
  }
);
