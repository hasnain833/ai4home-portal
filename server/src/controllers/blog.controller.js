import prisma from "../lib/prisma.js";
import { chat, hasLLM } from "../lib/llm.js";
import { query as kbQuery } from "../services/vector-store.service.js";
import { KB_SCOPES, buildBrandContext, dedupeKbCitations, parseLlmJson } from "../lib/sales-ai.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "post";
}

async function uniqueSlug(companyId, title) {
  const base = slugify(title);
  let slug = base;
  for (let i = 0; i < 20; i++) {
    const existing = await prisma.blogPost.findFirst({ where: { companyId, slug } });
    if (!existing) return slug;
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function readTimeMinutes(content) {
  const words = String(content || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

// Thin wrapper over the shared brand-context builder (SW-KB-006).
function brandVoiceContext(company) {
  return buildBrandContext(company);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function markdownToHtml(md) {
  const lines = String(md || "").split(/\r?\n/);
  const out = [];
  let inList = false;
  const inline = (t) =>
    escapeHtml(t)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^###\s+/.test(line)) { closeList(); out.push(`<h3>${inline(line.replace(/^###\s+/, ""))}</h3>`); }
    else if (/^##\s+/.test(line)) { closeList(); out.push(`<h2>${inline(line.replace(/^##\s+/, ""))}</h2>`); }
    else if (/^#\s+/.test(line)) { closeList(); out.push(`<h1>${inline(line.replace(/^#\s+/, ""))}</h1>`); }
    else if (/^[-*]\s+/.test(line)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`);
    } else if (line.trim() === "") { closeList(); }
    else { closeList(); out.push(`<p>${inline(line)}</p>`); }
  }
  closeList();
  return out.join("\n");
}

function serializePost(p) {
  return {
    ...p,
    readTime: `${readTimeMinutes(p.content)} min read`,
  };
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export const listBlogPosts = async (req, res) => {
  try {
    const { companyId } = req.user;
    if (!companyId) return res.status(403).json({ message: "No company associated" });
    const { status } = req.query;
    const posts = await prisma.blogPost.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      orderBy: { updatedAt: "desc" },
    });
    return res.json(posts.map(serializePost));
  } catch (e) {
    console.error("[Blog] list failed:", e);
    return res.status(500).json({ message: "Failed to load blog posts" });
  }
};

export const getBlogPost = async (req, res) => {
  try {
    const { companyId } = req.user;
    const post = await prisma.blogPost.findUnique({ where: { id: req.params.id } });
    if (!post || post.companyId !== companyId) return res.status(404).json({ message: "Post not found" });
    return res.json(serializePost(post));
  } catch (e) {
    console.error("[Blog] get failed:", e);
    return res.status(500).json({ message: "Failed to load post" });
  }
};

export const createBlogPost = async (req, res) => {
  try {
    const { companyId, id: userId } = req.user;
    if (!companyId) return res.status(403).json({ message: "No company associated" });
    const { title, excerpt, content, category, tags, metaTitle, metaDescription, headings, aiAssisted } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ message: "Title is required" });

    const post = await prisma.blogPost.create({
      data: {
        companyId,
        title: title.trim(),
        excerpt: excerpt || null,
        content: content || "",
        category: category || "Market Trends",
        tags: Array.isArray(tags) ? tags : [],
        metaTitle: metaTitle || null,
        metaDescription: metaDescription || null,
        headings: Array.isArray(headings) ? headings : [],
        aiAssisted: !!aiAssisted,
        status: "DRAFT",
        authorId: userId,
      },
    });
    return res.status(201).json(serializePost(post));
  } catch (e) {
    console.error("[Blog] create failed:", e);
    return res.status(500).json({ message: "Failed to create post" });
  }
};

export const updateBlogPost = async (req, res) => {
  try {
    const { companyId } = req.user;
    const existing = await prisma.blogPost.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.companyId !== companyId) return res.status(404).json({ message: "Post not found" });

    const { title, excerpt, content, category, tags, metaTitle, metaDescription, headings } = req.body;
    const data = {};
    if (title !== undefined) data.title = title;
    if (excerpt !== undefined) data.excerpt = excerpt;
    if (content !== undefined) data.content = content;
    if (category !== undefined) data.category = category;
    if (tags !== undefined) data.tags = Array.isArray(tags) ? tags : [];
    if (metaTitle !== undefined) data.metaTitle = metaTitle;
    if (metaDescription !== undefined) data.metaDescription = metaDescription;
    if (headings !== undefined) data.headings = Array.isArray(headings) ? headings : [];

    const contentChanged = data.title !== undefined || data.content !== undefined || data.excerpt !== undefined;
    if (contentChanged && ["APPROVED", "SCHEDULED", "PUBLISHED"].includes(existing.status)) {
      data.status = "PENDING_REVIEW";
      data.approvedAt = null;
      data.approvedById = null;
    }

    const post = await prisma.blogPost.update({ where: { id: existing.id }, data });
    return res.json(serializePost(post));
  } catch (e) {
    console.error("[Blog] update failed:", e);
    return res.status(500).json({ message: "Failed to update post" });
  }
};

export const deleteBlogPost = async (req, res) => {
  try {
    const { companyId } = req.user;
    const existing = await prisma.blogPost.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.companyId !== companyId) return res.status(404).json({ message: "Post not found" });
    if (existing.calendarEventId) {
      await prisma.contentCalendar.deleteMany({ where: { id: existing.calendarEventId, companyId } });
    }
    await prisma.blogPost.delete({ where: { id: existing.id } });
    return res.json({ success: true });
  } catch (e) {
    console.error("[Blog] delete failed:", e);
    return res.status(500).json({ message: "Failed to delete post" });
  }
};


export const generateBlogDraft = async (req, res) => {
  try {
    const { companyId, id: userId } = req.user;
    if (!companyId) return res.status(403).json({ message: "No company associated" });
    if (!hasLLM()) return res.status(503).json({ message: "No LLM provider configured (set ANTHROPIC_API_KEY or GROQ_API_KEY)." });

    const { topic, tone, keywords, targetAudience, targetLength, category, newsIds } = req.body;
    if (!topic || !topic.trim()) return res.status(400).json({ message: "A topic prompt is required." });

    const company = await prisma.company.findUnique({ where: { id: companyId } });
    const keywordStr = Array.isArray(keywords) ? keywords.join(", ") : keywords || "";
    const kbChunks = await kbQuery(companyId, `${topic} ${keywordStr}`, 5, KB_SCOPES.blog, "blog-draft").catch(() => []);
    const kbContext = kbChunks.length
      ? kbChunks.map((c, i) => `[KB ${i + 1}] ${c.name}: ${c.text}`).join("\n\n")
      : "No knowledge-base context available.";
    const kbCitations = dedupeKbCitations(kbChunks);

    let citations = [];
    let newsContext = "No source news selected.";
    if (Array.isArray(newsIds) && newsIds.length) {
      const news = await prisma.scrapedNews.findMany({ where: { companyId, id: { in: newsIds } } });
      citations = news.map((n) => ({ title: n.title, url: n.originalUrl }));
      newsContext = news.map((n) => `- ${n.title}: ${n.summary} (${n.originalUrl})`).join("\n") || newsContext;
    }

    const system = `You are a content marketing writer for ${company?.name || "a homebuilder"}. Write an original, engaging, SEO-aware blog post. Ground every factual claim in the provided Knowledge Base and Source News; never invent facts, prices, or statistics not present there.

Brand voice:
${brandVoiceContext(company)}

Knowledge Base:
${kbContext}

Source News (cite these where you draw on them):
${newsContext}

Return ONLY a raw JSON object (no markdown fences) with this exact shape:
{
  "title": "string",
  "excerpt": "string (1-2 sentence summary)",
  "metaTitle": "string (<= 60 chars, SEO)",
  "metaDescription": "string (<= 160 chars, SEO)",
  "headings": ["H2 section headings, in order"],
  "tags": ["3-6 lowercase tags"],
  "content": "full post body in Markdown using ## headings"
}`;

    const user = `Topic: ${topic}
Tone: ${tone || company?.voiceProfile || "professional"}
Target audience: ${targetAudience || "prospective homebuyers"}
Target length: ${targetLength || "800-1000 words"}
Keywords to work in naturally: ${keywordStr || "(none specified)"}`;

    const raw = await chat({ system, user, maxTokens: 2000, json: true });
    if (!raw) return res.status(502).json({ message: "The AI provider returned nothing. Please try again." });

    const parsed = parseLlmJson(raw);
    if (!parsed) {
      console.error("[Blog] draft JSON parse failed");
      return res.status(502).json({ message: "The AI draft could not be parsed. Please try again." });
    }

    const post = await prisma.blogPost.create({
      data: {
        companyId,
        title: (parsed.title || topic).slice(0, 300),
        excerpt: parsed.excerpt || null,
        content: parsed.content || "",
        category: category || "Market Trends",
        tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 8) : [],
        metaTitle: parsed.metaTitle || null,
        metaDescription: parsed.metaDescription || null,
        headings: Array.isArray(parsed.headings) ? parsed.headings : [],
        tone: tone || company?.voiceProfile || null,
        targetAudience: targetAudience || null,
        citations: citations.length ? citations : undefined,
        kbCitations: kbCitations.length ? kbCitations : undefined,
        sourceNewsIds: Array.isArray(newsIds) ? newsIds : [],
        aiAssisted: true,
        status: "DRAFT",
        authorId: userId,
      },
    });
    return res.status(201).json(serializePost(post));
  } catch (e) {
    console.error("[Blog] generate failed:", e);
    return res.status(500).json({ message: "Failed to generate draft" });
  }
};

// SW-BLOG-003: regenerate one section via AI while preserving manual edits elsewhere.
export const regenerateSection = async (req, res) => {
  try {
    const { companyId } = req.user;
    if (!hasLLM()) return res.status(503).json({ message: "No LLM provider configured." });
    const post = await prisma.blogPost.findUnique({ where: { id: req.params.id } });
    if (!post || post.companyId !== companyId) return res.status(404).json({ message: "Post not found" });

    const { heading, instruction } = req.body;
    if (!heading) return res.status(400).json({ message: "A section heading is required." });

    const company = await prisma.company.findUnique({ where: { id: companyId } });

    // Locate the "## heading" section (up to the next ## or end of doc).
    const lines = post.content.split(/\r?\n/);
    const startIdx = lines.findIndex((l) => /^##\s+/.test(l) && l.replace(/^##\s+/, "").trim().toLowerCase() === String(heading).trim().toLowerCase());
    if (startIdx === -1) return res.status(404).json({ message: `Section "${heading}" not found.` });
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (/^##\s+/.test(lines[i])) { endIdx = i; break; }
    }
    const currentSection = lines.slice(startIdx, endIdx).join("\n");

    const system = `You rewrite a single section of a blog post for ${company?.name || "a homebuilder"}, preserving the section heading and matching this brand voice:\n${brandVoiceContext(company)}\nReturn ONLY the rewritten Markdown for that one section (keep the "## ${heading}" heading line). Do not add other sections.`;
    const user = `Current section:\n${currentSection}\n\nInstruction: ${instruction || "Improve clarity and engagement while keeping the meaning."}`;

    const rewritten = await chat({ system, user, maxTokens: 900 });
    if (!rewritten) return res.status(502).json({ message: "Regeneration returned nothing." });

    const newSection = rewritten.replace(/```markdown/gi, "").replace(/```/g, "").trim();
    const newContent = [...lines.slice(0, startIdx), newSection, ...lines.slice(endIdx)].join("\n");

    const updated = await prisma.blogPost.update({ where: { id: post.id }, data: { content: newContent } });
    return res.json(serializePost(updated));
  } catch (e) {
    console.error("[Blog] regenerate failed:", e);
    return res.status(500).json({ message: "Failed to regenerate section" });
  }
};

// ─── Approval / publish / schedule (SW-BLOG-004 / 005 / 006) ────────────────────

export const approveBlogPost = async (req, res) => {
  try {
    const { companyId, id: userId } = req.user;
    const post = await prisma.blogPost.findUnique({ where: { id: req.params.id } });
    if (!post || post.companyId !== companyId) return res.status(404).json({ message: "Post not found" });
    if (!["DRAFT", "PENDING_REVIEW"].includes(post.status)) {
      return res.status(400).json({ message: `Cannot approve a post in status ${post.status}.` });
    }
    const updated = await prisma.blogPost.update({
      where: { id: post.id },
      data: { status: "APPROVED", approvedAt: new Date(), approvedById: userId },
    });
    return res.json(serializePost(updated));
  } catch (e) {
    console.error("[Blog] approve failed:", e);
    return res.status(500).json({ message: "Failed to approve post" });
  }
};

export const publishBlogPost = async (req, res) => {
  try {
    const { companyId } = req.user;
    const post = await prisma.blogPost.findUnique({ where: { id: req.params.id } });
    if (!post || post.companyId !== companyId) return res.status(404).json({ message: "Post not found" });
    // SW-BLOG-004: explicit approval required before publish.
    if (!post.approvedAt || !["APPROVED", "SCHEDULED"].includes(post.status)) {
      return res.status(400).json({ message: "Post must be approved before it can be published." });
    }
    const slug = post.slug || (await uniqueSlug(companyId, post.title));
    const updated = await prisma.blogPost.update({
      where: { id: post.id },
      data: { status: "PUBLISHED", publishedAt: new Date(), slug },
    });
    return res.json(serializePost(updated));
  } catch (e) {
    console.error("[Blog] publish failed:", e);
    return res.status(500).json({ message: "Failed to publish post" });
  }
};

export const unpublishBlogPost = async (req, res) => {
  try {
    const { companyId } = req.user;
    const post = await prisma.blogPost.findUnique({ where: { id: req.params.id } });
    if (!post || post.companyId !== companyId) return res.status(404).json({ message: "Post not found" });
    const updated = await prisma.blogPost.update({
      where: { id: post.id },
      data: { status: "APPROVED", publishedAt: null },
    });
    return res.json(serializePost(updated));
  } catch (e) {
    console.error("[Blog] unpublish failed:", e);
    return res.status(500).json({ message: "Failed to unpublish post" });
  }
};

// SW-BLOG-004/005: export requires approval; supports Markdown and HTML.
export const exportBlogPost = async (req, res) => {
  try {
    const { companyId } = req.user;
    const post = await prisma.blogPost.findUnique({ where: { id: req.params.id } });
    if (!post || post.companyId !== companyId) return res.status(404).json({ message: "Post not found" });
    if (!post.approvedAt) return res.status(400).json({ message: "Post must be approved before it can be exported." });

    const format = (req.query.format || "md").toLowerCase();
    const safeName = slugify(post.title);

    if (format === "html") {
      const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(post.metaTitle || post.title)}</title>
<meta name="description" content="${escapeHtml(post.metaDescription || post.excerpt || "")}" />
</head>
<body>
<article>
<h1>${escapeHtml(post.title)}</h1>
${markdownToHtml(post.content)}
</article>
</body>
</html>`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}.html"`);
      return res.send(html);
    }

    // Markdown (default) with YAML front matter.
    const front = [
      "---",
      `title: ${JSON.stringify(post.title)}`,
      `description: ${JSON.stringify(post.metaDescription || post.excerpt || "")}`,
      `tags: [${post.tags.map((t) => JSON.stringify(t)).join(", ")}]`,
      "---",
      "",
    ].join("\n");
    const citationsMd = Array.isArray(post.citations) && post.citations.length
      ? `\n\n## Sources\n${post.citations.map((c) => `- [${c.title}](${c.url})`).join("\n")}`
      : "";
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.md"`);
    return res.send(`${front}# ${post.title}\n\n${post.content}${citationsMd}`);
  } catch (e) {
    console.error("[Blog] export failed:", e);
    return res.status(500).json({ message: "Failed to export post" });
  }
};

// SW-BLOG-006: schedule an approved post onto the content calendar.
export const scheduleBlogPost = async (req, res) => {
  try {
    const { companyId, id: userId } = req.user;
    const post = await prisma.blogPost.findUnique({ where: { id: req.params.id } });
    if (!post || post.companyId !== companyId) return res.status(404).json({ message: "Post not found" });
    if (!post.approvedAt) return res.status(400).json({ message: "Post must be approved before scheduling." });

    const { scheduledAt } = req.body;
    const when = new Date(scheduledAt);
    if (isNaN(when.getTime())) return res.status(400).json({ message: "A valid scheduledAt date is required." });

    // Upsert the linked calendar item.
    let calendarEventId = post.calendarEventId;
    if (calendarEventId) {
      const exists = await prisma.contentCalendar.findFirst({ where: { id: calendarEventId, companyId } });
      if (exists) {
        await prisma.contentCalendar.update({
          where: { id: calendarEventId },
          data: { title: post.title, scheduledAt: when, content: post.excerpt || post.title, status: "Scheduled" },
        });
      } else {
        calendarEventId = null;
      }
    }
    if (!calendarEventId) {
      const event = await prisma.contentCalendar.create({
        data: {
          companyId,
          title: post.title,
          channel: "Blog",
          scheduledAt: when,
          status: "Scheduled",
          content: post.excerpt || post.title,
          isAiSuggested: false,
          ownerId: userId,
        },
      });
      calendarEventId = event.id;
    }

    const updated = await prisma.blogPost.update({
      where: { id: post.id },
      data: { status: "SCHEDULED", scheduledAt: when, calendarEventId },
    });
    return res.json(serializePost(updated));
  } catch (e) {
    console.error("[Blog] schedule failed:", e);
    return res.status(500).json({ message: "Failed to schedule post" });
  }
};

// ─── Public (tenant-hosted blog page, SW-BLOG-005) — no auth ────────────────────

export const getPublicBlogList = async (req, res) => {
  try {
    const { companyId } = req.params;
    const posts = await prisma.blogPost.findMany({
      where: { companyId, status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      select: { id: true, title: true, slug: true, excerpt: true, category: true, tags: true, publishedAt: true },
    });
    return res.json(posts);
  } catch (e) {
    console.error("[Blog] public list failed:", e);
    return res.status(500).json({ message: "Failed to load blog" });
  }
};

export const getPublicBlogPost = async (req, res) => {
  try {
    const { companyId, slug } = req.params;
    const post = await prisma.blogPost.findFirst({
      where: { companyId, slug, status: "PUBLISHED" },
      select: {
        id: true, title: true, slug: true, excerpt: true, content: true, category: true,
        tags: true, metaTitle: true, metaDescription: true, citations: true, publishedAt: true,
      },
    });
    if (!post) return res.status(404).json({ message: "Post not found" });
    return res.json({ ...post, html: markdownToHtml(post.content) });
  } catch (e) {
    console.error("[Blog] public get failed:", e);
    return res.status(500).json({ message: "Failed to load post" });
  }
};
