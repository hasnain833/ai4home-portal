import prisma from "../lib/prisma.js";
import { scrapeNewsForCompany } from "../services/news-service.js";

export const getNews = async (req, res) => {
  try {
    const { companyId } = req.user;
    const { limit = 20, offset = 0 } = req.query;

    if (!companyId) {
      return res.status(400).json({ error: "Company ID is required" });
    }

    const news = await prisma.scrapedNews.findMany({
      where: { companyId },
      orderBy: { publishedAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset),
    });

    const total = await prisma.scrapedNews.count({
      where: { companyId },
    });

    return res.status(200).json({
      data: news,
      meta: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
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
