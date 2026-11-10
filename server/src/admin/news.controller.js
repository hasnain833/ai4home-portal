// Super Admin → News: review scraped candidates, combine them with AI, write and publish posts.
// Builders see only PUBLISHED posts (GET /api/sales/news).
import prisma from "../lib/prisma.js";
import { denyUnlessAdminAccess } from "../middlewares/auth.js";
import { writeAuditLog } from "../lib/audit.js";
import { hasLLM, aiUnavailableMessage } from "../lib/llm.js";
import { combineNews, scrapePlatformNews } from "../services/news-service.js";

const STATUSES = ["CANDIDATE", "DRAFT", "PUBLISHED", "REJECTED"];
const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const validUrl = (v) => /^https?:\/\/\S+$/i.test(String(v || "").trim());

const wrap = (label, fn) => async (req, res) => {
  try {
    if (denyUnlessAdminAccess(req, res)) return;
    await fn(req, res);
  } catch (error) {
    console.error(`[Admin News] ${label} failed:`, error);
    res.status(500).json({ message: `${label} failed.` });
  }
};

export const listNews = wrap("Loading news", async (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : "CANDIDATE";
  const [posts, counts] = await Promise.all([
    prisma.newsPost.findMany({
      where: { status },
      orderBy: status === "PUBLISHED" ? { publishedAt: "desc" } : status === "DRAFT" ? { updatedAt: "desc" } : { articleDate: "desc" },
      take: 200,
    }),
    prisma.newsPost.groupBy({ by: ["status"], _count: true }),
  ]);
  res.json({ posts, counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) });
});

export const fetchNews = wrap("Fetching news", async (_req, res) => {
  res.json(await scrapePlatformNews());
});

export const createNews = wrap("Saving the post", async (req, res) => {
  const title = clip(req.body?.title, 200);
  const summary = clip(req.body?.summary, 5000);
  if (!title || !summary) return res.status(400).json({ message: "Add a title and the text." });
  const url = clip(req.body?.originalUrl, 1000);
  if (url && !validUrl(url)) return res.status(400).json({ message: "The link must start with http:// or https://." });
  const post = await prisma.newsPost.create({
    data: { status: "DRAFT", origin: "MANUAL", title, summary, originalUrl: url, source: clip(req.body?.source, 80) || "AI for Homebuilders" },
  });
  res.status(201).json({ post });
});

export const combineNewsPosts = wrap("Combining with AI", async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).slice(0, 8) : [];
  if (ids.length < 2) return res.status(400).json({ message: "Pick at least two articles to combine." });
  if (!hasLLM()) return res.status(503).json({ message: aiUnavailableMessage() });
  const posts = await prisma.newsPost.findMany({ where: { id: { in: ids }, status: "CANDIDATE" }, orderBy: { articleDate: "desc" } });
  if (posts.length < 2) return res.status(400).json({ message: "Those articles are no longer waiting for review." });
  const draft = await combineNews(posts);
  if (!draft) return res.status(502).json({ message: "The AI didn't return a post. Try again." });
  const post = await prisma.newsPost.create({
    data: {
      status: "DRAFT",
      origin: "AI",
      ...draft,
      originalUrl: posts[0].originalUrl,
      source: [...new Set(posts.map((p) => p.source))].join(", ").slice(0, 120),
      imageUrl: posts.find((p) => p.imageUrl)?.imageUrl || null,
      sources: posts.map((p) => ({ id: p.id, title: p.title, url: p.originalUrl, source: p.source })),
    },
  });
  res.status(201).json({ post });
});

/** Edit, publish, unpublish or reject. Publishing a combined post retires its source candidates. */
export const updateNews = wrap("Updating the post", async (req, res) => {
  const post = await prisma.newsPost.findUnique({ where: { id: req.params.id } });
  if (!post) return res.status(404).json({ message: "Post not found." });
  const b = req.body || {};
  const data = {};
  if (b.title !== undefined) data.title = clip(b.title, 200);
  if (b.summary !== undefined) data.summary = clip(b.summary, 5000);
  if (b.source !== undefined) data.source = clip(b.source, 120);
  if (b.originalUrl !== undefined) {
    const url = clip(b.originalUrl, 1000);
    if (url && !validUrl(url)) return res.status(400).json({ message: "The link must start with http:// or https://." });
    data.originalUrl = url;
  }
  if (data.title === "" || data.summary === "") return res.status(400).json({ message: "A post needs a title and text." });
  if (b.status !== undefined) {
    if (!["PUBLISHED", "DRAFT", "REJECTED"].includes(b.status)) return res.status(400).json({ message: "Unknown status." });
    data.status = b.status;
    if (b.status === "PUBLISHED") {
      data.publishedAt = new Date();
      data.publishedByName = req.user?.name || req.user?.email || null;
    }
  }
  const updated = await prisma.newsPost.update({ where: { id: post.id }, data });
  const sourceIds = Array.isArray(post.sources) ? post.sources.map((s) => s?.id).filter(Boolean) : [];
  if (b.status === "PUBLISHED" && sourceIds.length) {
    await prisma.newsPost.updateMany({ where: { id: { in: sourceIds }, status: "CANDIDATE" }, data: { status: "USED" } });
  }
  if (b.status) {
    await writeAuditLog({ req, action: `news.${b.status.toLowerCase()}`, targetType: "NewsPost", targetId: post.id, metadata: { title: updated.title } });
  }
  res.json({ post: updated });
});

export const deleteNews = wrap("Deleting the post", async (req, res) => {
  const post = await prisma.newsPost.findUnique({ where: { id: req.params.id } });
  if (!post) return res.status(404).json({ message: "Post not found." });
  if (post.status === "PUBLISHED") return res.status(400).json({ message: "Unpublish the post first." });
  // Scraped items are kept as REJECTED so the scraper doesn't bring them back.
  if (post.origin === "SCRAPED") await prisma.newsPost.update({ where: { id: post.id }, data: { status: "REJECTED" } });
  else await prisma.newsPost.delete({ where: { id: post.id } });
  res.json({ ok: true });
});
