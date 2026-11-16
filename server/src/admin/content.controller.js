// Super Admin → Content: blog articles and calendar ideas for every builder, reviewed like News.
// Builders only see PUBLISHED items and use them word for word (GET /api/sales/blog/library,
// GET /api/sales/calendar/library).
import prisma from "../lib/prisma.js";
import { adminHandler } from "../middlewares/auth.js";
import { writeAuditLog } from "../lib/audit.js";
import { hasLLM, aiUnavailableMessage, toolCall } from "../lib/llm.js";
import { PLATFORM_BLOG_SYSTEM, PLATFORM_IDEAS_SYSTEM } from "../prompts/index.js";
import { getSeasonalContext } from "../controllers/calendar.controller.js";

export const KINDS = ["BLOG", "IDEA"];
const STATUSES = ["DRAFT", "PUBLISHED", "REJECTED"];
export const IDEA_CHANNELS = ["Email", "SMS", "Blog", "Announcement"];
export const BLOG_CATEGORIES = ["Home Design", "Finance", "Warranty & Support", "Market Trends"];
const IDEAS_PER_BATCH = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const wrap = adminHandler("Admin Content");

/** {{companyName}} is the only merge field: anything else would reach a builder's site as raw braces. */
function badPlaceholder(...texts) {
  const found = texts.join(" ").match(/\{\{\s*(\w+)\s*\}\}/g) || [];
  return found.find((f) => !/^\{\{\s*companyName\s*\}\}$/.test(f)) || null;
}

/** Normalises an edit or a new item; returns { data } or { error }. */
function contentData(body, kind, { partial = false } = {}) {
  const data = {};
  for (const [key, max] of [["title", 200], ["excerpt", 500], ["content", 20000], ["metaTitle", 120], ["metaDescription", 320], ["reason", 1000]]) {
    if (body[key] !== undefined) data[key] = clip(body[key], max);
  }
  if (body.tags !== undefined) data.tags = (Array.isArray(body.tags) ? body.tags : String(body.tags).split(",")).map((t) => clip(t, 40).toLowerCase()).filter(Boolean).slice(0, 8);
  if (body.category !== undefined) {
    if (!BLOG_CATEGORIES.includes(body.category)) return { error: "Unknown category." };
    data.category = body.category;
  }
  if (kind === "IDEA") {
    if (body.channel !== undefined) {
      if (!IDEA_CHANNELS.includes(body.channel)) return { error: "Pick Email, SMS, Blog or Announcement." };
      data.channel = body.channel;
    }
    if (body.suggestedFor !== undefined) {
      const when = body.suggestedFor ? new Date(body.suggestedFor) : null;
      if (when && isNaN(when.getTime())) return { error: "That date isn't valid." };
      data.suggestedFor = when;
    }
  }
  if ((!partial || data.title !== undefined) && !data.title) return { error: "Add a title." };
  if ((!partial || data.content !== undefined) && !data.content) return { error: kind === "BLOG" ? "Add the article text." : "Add an outline." };
  const bad = badPlaceholder(data.title || "", data.excerpt || "", data.content || "", data.reason || "");
  if (bad) return { error: `${bad} isn't a merge field. Only {{companyName}} is filled in for each builder.` };
  return { data };
}

export const listContent = wrap("Loading content", async (req, res) => {
  const kind = KINDS.includes(req.query.kind) ? req.query.kind : "BLOG";
  const status = STATUSES.includes(req.query.status) ? req.query.status : "DRAFT";
  const [items, counts, used] = await Promise.all([
    prisma.platformContent.findMany({
      where: { kind, status },
      orderBy: status === "PUBLISHED" ? { publishedAt: "desc" } : { updatedAt: "desc" },
      take: 200,
    }),
    prisma.platformContent.groupBy({ by: ["status"], where: { kind }, _count: true }),
    // How many builders took each piece: blog copies, or ideas added to a calendar.
    kind === "BLOG"
      ? prisma.blogPost.groupBy({ by: ["platformContentId"], where: { platformContentId: { not: null } }, _count: true })
      : prisma.contentCalendar.groupBy({ by: ["platformContentId"], where: { platformContentId: { not: null }, status: { not: "Dismissed" } }, _count: true }),
  ]);
  const usedBy = new Map(used.map((u) => [u.platformContentId, u._count]));
  res.json({
    items: items.map((i) => ({ ...i, usedBy: usedBy.get(i.id) || 0 })),
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
  });
});

export const createContent = wrap("Saving", async (req, res) => {
  const kind = req.body?.kind;
  if (!KINDS.includes(kind)) return res.status(400).json({ message: "Pick a blog article or a calendar idea." });
  const { data, error } = contentData(req.body || {}, kind);
  if (error) return res.status(400).json({ message: error });
  if (kind === "IDEA" && !data.channel) return res.status(400).json({ message: "Pick a channel." });
  res.status(201).json({ item: await prisma.platformContent.create({ data: { ...data, kind, origin: "MANUAL", status: "DRAFT" } }) });
});

// ---------- AI drafts ----------

const BLOG_TOOL = {
  name: "write_blog_post",
  description: "Return the finished blog post.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      excerpt: { type: "string", description: "1-2 sentence summary" },
      metaTitle: { type: "string", description: "<= 60 chars, SEO" },
      metaDescription: { type: "string", description: "<= 160 chars, SEO" },
      tags: { type: "array", items: { type: "string" }, description: "3-6 lowercase tags" },
      category: { type: "string", enum: BLOG_CATEGORIES },
      content: { type: "string", description: "Full post body in Markdown using ## headings" },
    },
    required: ["title", "excerpt", "metaTitle", "metaDescription", "tags", "category", "content"],
  },
};

const IDEAS_TOOL = {
  name: "content_ideas",
  description: "Return the content-calendar ideas.",
  input_schema: {
    type: "object",
    properties: {
      ideas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            topic: { type: "string", description: "Short title, under 90 characters." },
            channel: { type: "string", enum: IDEA_CHANNELS },
            suggestedFor: { type: "string", description: "YYYY-MM-DD within the next 4 weeks." },
            reason: { type: "string", description: "Why this is timely, in one sentence." },
            outline: { type: "string", description: "3-6 short lines: the angle, key points and call to action." },
          },
          required: ["topic", "channel", "suggestedFor", "reason", "outline"],
        },
      },
    },
    required: ["ideas"],
  },
};

/** Published news only: the same rule as the builders' own tools. */
async function newsContext(newsIds) {
  const news = await prisma.newsPost.findMany({
    where: Array.isArray(newsIds) && newsIds.length
      ? { status: "PUBLISHED", id: { in: newsIds.map(String).slice(0, 8) } }
      : { status: "PUBLISHED", publishedAt: { gte: new Date(Date.now() - 14 * DAY_MS) } },
    orderBy: { publishedAt: "desc" },
    take: 8,
  });
  return {
    news,
    text: news.length ? news.map((n) => `- ${n.title} [${n.source}]: ${n.summary} (${n.originalUrl})`).join("\n") : "No recent market news.",
  };
}

export const generateContent = wrap("Generating with AI", async (req, res) => {
  const kind = req.body?.kind;
  if (!KINDS.includes(kind)) return res.status(400).json({ message: "Pick a blog article or calendar ideas." });
  if (!(await hasLLM())) return res.status(503).json({ message: await aiUnavailableMessage() });
  const topic = clip(req.body?.topic, 500);
  const { news, text } = await newsContext(req.body?.newsIds);
  const context = [`Today: ${new Date().toISOString().slice(0, 10)}`, getSeasonalContext(), `Recent housing-market news:\n${text}`].join("\n\n");

  if (kind === "BLOG") {
    const out = await toolCall({
      companyId: null,
      system: PLATFORM_BLOG_SYSTEM,
      messages: [{ role: "user", content: `${context}\n\n${topic ? `Topic requested by the AI4Home team: ${topic}` : "Pick a timely, useful topic for home buyers from the news and season."}` }],
      tool: BLOG_TOOL,
      maxTokens: 6000,
      source: "platform-content",
    });
    const { data, error } = contentData({ ...out, category: BLOG_CATEGORIES.includes(out?.category) ? out.category : "Market Trends" }, "BLOG");
    if (!out?.content || error) return res.status(502).json({ message: error || "The AI didn't return an article. Try again." });
    const item = await prisma.platformContent.create({
      data: { ...data, kind, origin: "AI", status: "DRAFT", citations: news.length ? news.map((n) => ({ title: n.title, url: n.originalUrl })) : undefined },
    });
    return res.status(201).json({ items: [item] });
  }

  const out = await toolCall({
    companyId: null,
    system: PLATFORM_IDEAS_SYSTEM,
    messages: [{ role: "user", content: `${context}\n\nWrite ${IDEAS_PER_BATCH} ideas, mixing channels.${topic ? ` Theme requested by the AI4Home team: ${topic}` : ""}` }],
    tool: IDEAS_TOOL,
    maxTokens: 3000,
    source: "platform-content",
  });
  const rows = (Array.isArray(out?.ideas) ? out.ideas : []).slice(0, IDEAS_PER_BATCH)
    .map((i) => contentData({ title: i?.topic, content: i?.outline, reason: i?.reason, channel: IDEA_CHANNELS.includes(i?.channel) ? i.channel : "Email", suggestedFor: i?.suggestedFor || null }, "IDEA"))
    .filter((r) => !r.error)
    .map((r) => ({ ...r.data, kind, origin: "AI", status: "DRAFT" }));
  if (!rows.length) return res.status(502).json({ message: "The AI didn't return usable ideas. Try again." });
  await prisma.platformContent.createMany({ data: rows });
  res.status(201).json({ created: rows.length });
});

/** Edit, publish, unpublish or reject. Builders' copies already taken keep their text. */
export const updateContent = wrap("Saving", async (req, res) => {
  const item = await prisma.platformContent.findUnique({ where: { id: req.params.id } });
  if (!item) return res.status(404).json({ message: "Not found." });
  const b = req.body || {};
  const { data, error } = contentData(b, item.kind, { partial: true });
  if (error) return res.status(400).json({ message: error });
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return res.status(400).json({ message: "Unknown status." });
    data.status = b.status;
    if (b.status === "PUBLISHED") {
      data.publishedAt = new Date();
      data.publishedByName = req.user?.name || req.user?.email || null;
    }
  }
  const updated = await prisma.platformContent.update({ where: { id: item.id }, data });
  if (b.status) {
    await writeAuditLog({ req, action: `content.${b.status.toLowerCase()}`, targetType: "PlatformContent", targetId: item.id, metadata: { kind: item.kind, title: updated.title } });
  }
  res.json({ item: updated });
});

export const deleteContent = wrap("Deleting", async (req, res) => {
  const item = await prisma.platformContent.findUnique({ where: { id: req.params.id } });
  if (!item) return res.status(404).json({ message: "Not found." });
  if (item.status === "PUBLISHED") return res.status(400).json({ message: "Unpublish it first." });
  await prisma.platformContent.delete({ where: { id: item.id } });
  res.json({ ok: true });
});
