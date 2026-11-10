import prisma from "../lib/prisma.js";

const NEWS_MAX_AGE_DAYS = 30;

/** Builders (and homeowners) see only what the Super Admin published; the same feed for everyone. */
export const getNews = async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const where = {
      status: "PUBLISHED",
      publishedAt: { gte: new Date(Date.now() - NEWS_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) },
    };
    const [news, total] = await Promise.all([
      prisma.newsPost.findMany({
        where,
        orderBy: { publishedAt: "desc" },
        take: limit,
        skip: offset,
        select: { id: true, title: true, summary: true, originalUrl: true, source: true, imageUrl: true, sources: true, publishedAt: true },
      }),
      prisma.newsPost.count({ where }),
    ]);
    return res.status(200).json({ data: news, meta: { total, limit, offset, maxAgeDays: NEWS_MAX_AGE_DAYS } });
  } catch (error) {
    console.error("Error fetching news:", error);
    return res.status(500).json({ error: "Failed to fetch news" });
  }
};
