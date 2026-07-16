import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { scrapeNewsForCompany } from "../../services/news-service.js";

/**
 * News Scraping Agent (SW-NEWS)
 *
 * Runs daily and scrapes + AI-summarizes housing-market news, then STORES it.
 *
 * Per SW-NEWS-001 each tenant has its own configurable set of sources
 * (`Company.newsSources`), so companies no longer share one global feed — the
 * scrape runs per company against that tenant's sources (platform default when
 * none configured). Per SW-NEWS-004, stored news only *feeds* downstream
 * surfaces (Market News feed, calendar suggestions, blog drafter); nothing is
 * sent to leads without human approval (SRS Constraint #4 / NFR-U-002).
 */
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
    // Isolate each tenant in its own step so one company's failure (or a
    // retry) doesn't re-run or block the others.
    for (const company of companies) {
      const result = await step.run(`scrape-${company.id}`, async () =>
        scrapeNewsForCompany(company)
      );
      totalSaved += result.saved;
    }

    return { companies: companies.length, saved: totalSaved };
  }
);
