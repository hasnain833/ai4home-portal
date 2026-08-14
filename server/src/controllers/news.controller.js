import prisma from "../lib/prisma.js";
import { scrapeNewsForCompany } from "../services/news-service.js";

// Market news goes stale fast — a two-month-old "rates are climbing" headline is
// worse than no headline, because campaign and calendar drafts are grounded in it.
// Rows are hidden rather than deleted: BlogPost.sourceNewsIds cites them, and those
// citations should keep resolving after the item drops off this list.
const NEWS_MAX_AGE_DAYS = 30;

export const getNews = async (req, res) => {
  try {
    const { companyId } = req.user;
    const { limit = 20, offset = 0 } = req.query;

    if (!companyId) {
      return res.status(400).json({ error: "Company ID is required" });
    }

    const cutoff = new Date(Date.now() - NEWS_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
    const where = { companyId, publishedAt: { gte: cutoff } };

    const news = await prisma.scrapedNews.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset),
    });

    const total = await prisma.scrapedNews.count({ where });

    return res.status(200).json({
      data: news,
      meta: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        maxAgeDays: NEWS_MAX_AGE_DAYS,
      }
    });
  } catch (error) {
    console.error("Error fetching news:", error);
    return res.status(500).json({ error: "Failed to fetch news" });
  }
};

// SW-NEWS-001: on-demand scrape for the current tenant against its own
// configured sources (or the platform default), without waiting for the daily
// cron. Returns how many new items were stored.
export const refreshNews = async (req, res) => {
  try {
    const { companyId, role } = req.user;
    if (!companyId) {
      return res.status(400).json({ error: "Company ID is required" });
    }
    if (role !== "ADMIN" && role !== "STAFF") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, newsSources: true },
    });
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    const result = await scrapeNewsForCompany(company);
    return res.status(200).json({
      saved: result.saved,
      sources: result.sourceCount,
      failedSources: result.failedSources,
    });
  } catch (error) {
    console.error("Error refreshing news:", error);
    return res.status(500).json({ error: "Failed to refresh news" });
  }
};
