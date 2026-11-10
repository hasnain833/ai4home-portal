import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { scrapePlatformNews } from "../../services/news-service.js";
import { appUrl, notifySuperAdmin } from "../../lib/b2b.js";

export const scrapeNews = inngest.createFunction(
  {
    id: "scrape-housing-news",
    name: "Scrape Housing News (platform, for Super Admin review)",
    triggers: [{ cron: "0 9 * * *" }], // Run daily at 9:00 AM UTC
  },
  async ({ step }) => {
    const result = await step.run("scrape-platform-sources", () => scrapePlatformNews());

    if (result.saved > 0) {
      await step.run("tell-super-admin", async () => {
        const waiting = await prisma.newsPost.count({ where: { status: "CANDIDATE" } });
        await notifySuperAdmin(
          `${waiting} news ${waiting === 1 ? "article" : "articles"} to review`,
          `<p>${result.saved} new ${result.saved === 1 ? "article was" : "articles were"} fetched today. ${waiting} ${waiting === 1 ? "is" : "are"} waiting for review.</p>` +
            `<p>Builders only see news once it's published.</p>` +
            `<p><a href="${appUrl()}/admin/news">Review news</a></p>`,
        );
      });
    }
    return result;
  },
);
