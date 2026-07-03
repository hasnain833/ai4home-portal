import prisma from "../lib/prisma.js";

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
