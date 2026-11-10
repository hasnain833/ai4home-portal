import Parser from "rss-parser";
import prisma from "../lib/prisma.js";
import { chat, hasLLM, toolCall } from "../lib/llm.js";
import { getPlatformDefaultNewsSources } from "../lib/news-sources.js";
import { mapWithConcurrency } from "../lib/utils.js";
import { NEWS_SUMMARY_PROMPT, NEWS_COMBINE_PROMPT } from "../prompts/index.js";

const parser = new Parser();
const FEED_CONCURRENCY = 5;
const SUMMARY_CONCURRENCY = 4;

/**
 * Scrapes the platform's news sources once and stores new articles as CANDIDATES
 * for Super Admin review. Builders never see a candidate.
 */
export async function scrapePlatformNews({ perSourceLimit = 5 } = {}) {
  const sources = await getPlatformDefaultNewsSources();
  const feeds = await mapWithConcurrency(sources, FEED_CONCURRENCY, async (source) => {
    const feed = await parser.parseURL(source.url);
    return { source, items: (feed.items || []).slice(0, perSourceLimit) };
  });

  let failedSources = 0;
  const candidates = [];
  feeds.forEach((result, i) => {
    if (result.error) {
      failedSources += 1;
      console.error(`[News] Failed to fetch feed ${sources[i].url}:`, result.error.message);
      return;
    }
    for (const item of result.value.items) if (item.title) candidates.push({ item, source: result.value.source });
  });
  if (!candidates.length) return { saved: 0, sourceCount: sources.length, failedSources };

  // Anything already seen (in any state, rejected included) is not offered again.
  const titles = [...new Set(candidates.map((c) => c.item.title))];
  const seen = new Set(
    (await prisma.newsPost.findMany({ where: { title: { in: titles } }, select: { title: true } })).map((e) => e.title),
  );
  const fresh = candidates.filter(({ item }) => !seen.has(item.title) && seen.add(item.title));
  if (!fresh.length) return { saved: 0, sourceCount: sources.length, failedSources };

  const canSummarize = await hasLLM();
  const summaries = await mapWithConcurrency(fresh, SUMMARY_CONCURRENCY, ({ item }) =>
    canSummarize
      ? chat({
          companyId: null,
          system: NEWS_SUMMARY_PROMPT,
          user: `Title: ${item.title}\nSnippet: ${item.contentSnippet || ""}\n\nPlease write a short, engaging summary of this news.`,
          maxTokens: 300,
          source: "news-summary",
        })
      : null,
  );

  const created = await prisma.newsPost.createMany({
    data: fresh.map(({ item, source }, i) => {
      if (summaries[i].error) console.error("[News] Summarization failed:", summaries[i].error.message);
      return {
        title: item.title,
        originalUrl: item.link || source.url,
        summary: summaries[i].value || item.contentSnippet || "No summary available.",
        source: source.label,
        articleDate: new Date(item.pubDate || Date.now()),
      };
    }),
  });
  return { saved: created.count, sourceCount: sources.length, failedSources };
}

const COMBINE_TOOL = {
  name: "news_post",
  description: "One news post for homebuilders, written from the articles given.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "A clear headline, under 90 characters." },
      summary: { type: "string", description: "2-3 short paragraphs: what happened, and why it matters for homebuilders." },
    },
    required: ["title", "summary"],
  },
};

/** AI drafts one post from several articles. It is saved as a DRAFT; a person publishes it. */
export async function combineNews(posts) {
  const articles = posts
    .map((p, i) => `Article ${i + 1} (${p.source}, ${p.articleDate.toISOString().slice(0, 10)})\nTitle: ${p.title}\nSummary: ${p.summary}`)
    .join("\n\n");
  const out = await toolCall({
    companyId: null,
    system: NEWS_COMBINE_PROMPT,
    messages: [{ role: "user", content: `${articles}\n\nWrite the post.` }],
    tool: COMBINE_TOOL,
    maxTokens: 900,
    source: "news-combine",
  });
  const title = String(out?.title || "").trim().slice(0, 200);
  const summary = String(out?.summary || "").trim().slice(0, 5000);
  if (!title || !summary) return null;
  return { title, summary };
}
