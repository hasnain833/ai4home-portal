import Parser from "rss-parser";
import prisma from "../lib/prisma.js";
import { chat, hasLLM } from "../lib/llm.js";
import { resolveNewsSources } from "../lib/news-sources.js";

const parser = new Parser();

export async function scrapeNewsForCompany(company, { perSourceLimit = 3 } = {}) {
  const sources = resolveNewsSources(company);
  let saved = 0;
  let failedSources = 0;

  for (const source of sources) {
    let items = [];
    try {
      const feed = await parser.parseURL(source.url);
      items = (feed.items || []).slice(0, perSourceLimit);
    } catch (error) {
      // SW-NEWS-006: quarantine a failing source without affecting others.
      failedSources += 1;
      console.error(
        `[News] Failed to fetch feed for company ${company.id} (${source.url}):`,
        error.message
      );
      continue;
    }

    for (const item of items) {
      if (!item.title) continue;

      // Deduplicate per company (title-keyed; Google News links rotate).
      const existing = await prisma.scrapedNews.findFirst({
        where: { companyId: company.id, title: item.title },
        select: { id: true },
      });
      if (existing) continue;

      // SW-NEWS-003: AI summary. Falls back to the raw snippet without an LLM.
      let summary = item.contentSnippet || "No summary available.";
      if (hasLLM()) {
        try {
          const text = await chat({
            system:
              "You are an expert real estate content marketer. You rewrite news snippets into engaging, 2-3 sentence summaries that are easy to read for homeowners and leads. Always maintain a professional, helpful tone.",
            user: `Title: ${item.title}\nSnippet: ${item.contentSnippet || ""}\n\nPlease write a short, engaging summary of this news.`,
            maxTokens: 300,
          });
          if (text) summary = text;
        } catch (error) {
          console.error("[News] Summarization failed:", error.message);
        }
      }

      await prisma.scrapedNews.create({
        data: {
          companyId: company.id,
          title: item.title,
          originalUrl: item.link || source.url,
          summary,
          source: source.label,
          publishedAt: new Date(item.pubDate || Date.now()),
        },
      });
      saved += 1;
    }
  }

  return { saved, sourceCount: sources.length, failedSources };
}
