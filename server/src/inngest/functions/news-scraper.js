import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { scrapeNewsForCompany } from "../../services/news-service.js";

export const scrapeNews = inngest.createFunction(
  {
    id: "scrape-housing-news",
    name: "Scrape Housing News (per-tenant, store for approval)",
    triggers: [{ cron: "0 9 * * *" }], // Run daily at 9:00 AM UTC
  },
  async ({ step }) => {
    const companies = await step.run("load-sales-companies", async () =>
      prisma.company.findMany({
        where: { salesEnabled: true },
        select: { id: true, name: true, newsSources: true },
      })
    );

    if (!companies.length) {
      return { message: "No sales-enabled companies." };
    }

    let totalSaved = 0;
    for (const company of companies) {
      const result = await step.run(`scrape-${company.id}`, async () =>
        scrapeNewsForCompany(company)
      );
      totalSaved += result.saved;
    }

    return { companies: companies.length, saved: totalSaved };
  }
);
