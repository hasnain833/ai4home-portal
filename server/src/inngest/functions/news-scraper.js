import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import Parser from "rss-parser";
import { chat, hasLLM } from "../../lib/llm.js";
const parser = new Parser();
import crypto from "crypto";

/**
 * News Scraping Agent (SW-NEWS)
 *
 * Runs daily to fetch and AI-summarize housing-market news, then STORES it.
 *
 * Per SRS SW-NEWS-004, scraped news only *feeds* downstream surfaces — the
 * "Market news" feed page (`/api/sales/news`), the content-calendar suggestion
 * engine (SW-CAL-002), and the blog drafter (SW-BLOG). It does NOT send anything
 * to leads directly: SRS Constraint #4 / NFR-U-002 require human approval before
 * any AI-generated content goes out. A human approves a calendar item or blog
 * post first; sending then happens through the normal (compliance-gated) paths.
 */
export const scrapeNews = inngest.createFunction(
  {
    id: "scrape-housing-news",
    name: "Scrape Housing News (store for approval)",
    triggers: [{ cron: "0 9 * * *" }], // Run daily at 9:00 AM UTC
  },
  async ({ step }) => {
    // 1. Fetch News from Google News RSS
    const articles = await step.run("fetch-rss-news", async () => {
      try {
        const feed = await parser.parseURL(
          "https://news.google.com/rss/search?q=housing+market+real+estate&hl=en-US&gl=US&ceid=US:en"
        );
        // Get top 3 articles to process
        return feed.items.slice(0, 3).map((item) => ({
          title: item.title,
          link: item.link,
          pubDate: item.pubDate,
          contentSnippet: item.contentSnippet,
        }));
      } catch (error) {
        console.error("Failed to fetch RSS:", error);
        return [];
      }
    });

    if (!articles || articles.length === 0) {
      return { message: "No news fetched." };
    }

    let savedCount = 0;

    // Process each article
    for (const article of articles) {
      // 2. Deduplicate. Google News URLs rotate, so we key off a hash of the title.
      const titleHash = crypto.createHash("md5").update(article.title).digest("hex");

      const isDuplicate = await step.run(`check-duplicate-${titleHash}`, async () => {
        const existing = await prisma.scrapedNews.findFirst({
          where: { title: article.title },
        });
        return !!existing;
      });

      if (isDuplicate) continue;

      // 3. Summarize with Claude (SW-NEWS-003). Store summaries + links only — never
      // full article text (SW-NEWS-005).
      const summary = await step.run(`summarize-${titleHash}`, async () => {
        if (!hasLLM()) {
          return article.contentSnippet || "No summary available.";
        }
        try {
          const text = await chat({
            system:
              "You are an expert real estate content marketer. You rewrite news snippets into engaging, 2-3 sentence summaries that are easy to read for homeowners and leads. Always maintain a professional, helpful tone.",
            user: `Title: ${article.title}\nSnippet: ${article.contentSnippet}\n\nPlease write a short, engaging summary of this news.`,
            maxTokens: 300,
          });
          return text || article.contentSnippet || "No summary available.";
        } catch (error) {
          console.error("Summarization failed:", error);
          return article.contentSnippet || "No summary available.";
        }
      });

      // 4. Save per sales-enabled company for the Market News feed + calendar/blog use.
      const saved = await step.run(`save-article-${titleHash}`, async () => {
        const companies = await prisma.company.findMany({
          where: { salesEnabled: true },
        });

        let created = 0;
        for (const company of companies) {
          await prisma.scrapedNews.create({
            data: {
              companyId: company.id,
              title: article.title,
              originalUrl: article.link,
              summary,
              source: "Google News",
              publishedAt: new Date(article.pubDate || new Date()),
              // Not broadcast automatically — a human approves a calendar item / blog
              // post before anything is sent to leads (SRS Constraint #4).
            },
          });
          created += 1;
        }
        return created;
      });

      if (saved > 0) savedCount += 1;
    }

    return { processed: savedCount };
  }
);
