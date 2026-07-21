import Parser from "rss-parser";
import prisma from "../lib/prisma.js";
import { chat, hasLLM } from "../lib/llm.js";
import { resolveNewsSources } from "../lib/news-sources.js";
import { mapWithConcurrency } from "../lib/utils.js";

const parser = new Parser();
const FEED_CONCURRENCY = 5;
const SUMMARY_CONCURRENCY = 4;

export async function scrapeNewsForCompany(
  company,
  { perSourceLimit = 3 } = {},
) {
  const sources = await resolveNewsSources(company);
  const feeds = await mapWithConcurrency(
    sources,
    FEED_CONCURRENCY,
    async (source) => {
      const feed = await parser.parseURL(source.url);
      return { source, items: (feed.items || []).slice(0, perSourceLimit) };
    },
  );

  let failedSources = 0;
  const candidates = [];
  for (let i = 0; i < feeds.length; i++) {
    const result = feeds[i];
    if (result.error) {
      failedSources += 1;
      console.error(
        `[News] Failed to fetch feed for company ${company.id} (${sources[i].url}):`,
        result.error.message,
      );
      continue;
    }
    for (const item of result.value.items) {
      if (item.title) candidates.push({ item, source: result.value.source });
    }
  }

  if (candidates.length === 0) {
    return { saved: 0, sourceCount: sources.length, failedSources };
  }

  const titles = [...new Set(candidates.map((c) => c.item.title))];
  const existing = await prisma.scrapedNews.findMany({
    where: { companyId: company.id, title: { in: titles } },
    select: { title: true },
  });
  const seen = new Set(existing.map((e) => e.title));

  const fresh = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.item.title)) continue;
    seen.add(candidate.item.title);
    fresh.push(candidate);
  }

  if (fresh.length === 0) {
    return { saved: 0, sourceCount: sources.length, failedSources };
  }

  const summaries = await mapWithConcurrency(
    fresh,
    SUMMARY_CONCURRENCY,
    async ({ item }) => {
      if (!hasLLM()) return null;
      return chat({
        system:
          "You are an expert real estate content marketer. You rewrite news snippets into engaging, 2-3 sentence summaries that are easy to read for homeowners and leads. Always maintain a professional, helpful tone.",
        user: `Title: ${item.title}\nSnippet: ${item.contentSnippet || ""}\n\nPlease write a short, engaging summary of this news.`,
        maxTokens: 300,
      });
    },
  );

  const rows = fresh.map(({ item, source }, i) => {
    const result = summaries[i];
    if (result.error) {
      console.error("[News] Summarization failed:", result.error.message);
    }
    return {
      companyId: company.id,
      title: item.title,
      originalUrl: item.link || source.url,
      summary: result.value || item.contentSnippet || "No summary available.",
      source: source.label,
      publishedAt: new Date(item.pubDate || Date.now()),
    };
  });
  const created = await prisma.scrapedNews.createMany({ data: rows });

  return { saved: created.count, sourceCount: sources.length, failedSources };
}
