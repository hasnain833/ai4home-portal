import prisma from "../lib/prisma.js";

// Builders publish only articles the AI4Home team approved (Super Admin → Content).
// They take one with "Use this", their name is filled in, and the text can't be changed.
// Posts written before the library existed stay editable.

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

const withCompanyName = (text, name) => (text == null ? text : String(text).replace(/\{\{\s*companyName\s*\}\}/g, name));

// ─── AI4Home library ──────────────────────────────────────────────────────────

export const listLibraryArticles = async (req, res) => {
  try {
    const { companyId } = req.user;
    const [items, taken, company] = await Promise.all([
      prisma.platformContent.findMany({ where: { kind: "BLOG", status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, take: 100 }),
      prisma.blogPost.findMany({ where: { companyId, platformContentId: { not: null } }, select: { platformContentId: true } }),
      prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }),
    ]);
    const used = new Set(taken.map((t) => t.platformContentId));
    const name = company?.name || "our team";
    return res.json(items.map((i) => ({
      id: i.id,
      title: withCompanyName(i.title, name),
      excerpt: withCompanyName(i.excerpt, name),
      content: withCompanyName(i.content, name),
      category: i.category,
      tags: i.tags,
      publishedAt: i.publishedAt,
      readTime: `${readTimeMinutes(i.content)} min read`,
      used: used.has(i.id),
    })));
  } catch (e) {
    console.error("[Blog] library failed:", e);
    return res.status(500).json({ message: "Failed to load AI4Home articles" });
  }
};

/** Copies an approved article into this builder's blog as a draft, word for word. */
export const useLibraryArticle = async (req, res) => {
  try {
    const { companyId, id: userId } = req.user;
    const item = await prisma.platformContent.findFirst({ where: { id: req.params.id, kind: "BLOG", status: "PUBLISHED" } });
    if (!item) return res.status(404).json({ message: "That article is no longer available." });
    if (await prisma.blogPost.findFirst({ where: { companyId, platformContentId: item.id } })) {
      return res.status(409).json({ message: "You already added this article." });
    }
    const name = (await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }))?.name || "our team";
    const content = withCompanyName(item.content, name);
    const post = await prisma.blogPost.create({
      data: {
        companyId,
        title: withCompanyName(item.title, name).slice(0, 300),
        excerpt: withCompanyName(item.excerpt, name),
        content,
        category: item.category,
        tags: item.tags,
        metaTitle: withCompanyName(item.metaTitle, name),
        metaDescription: withCompanyName(item.metaDescription, name),
        headings: [...content.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim()),
        citations: item.citations ?? undefined,
        aiAssisted: true,
        status: "DRAFT",
        platformContentId: item.id,
        authorId: userId,
      },
    });
    return res.status(201).json(serializePost(post));
  } catch (e) {
    console.error("[Blog] use library article failed:", e);
    return res.status(500).json({ message: "Failed to add the article" });
  }
};

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

export const updateBlogPost = async (req, res) => {
  try {
    const { companyId } = req.user;
    const existing = await prisma.blogPost.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.companyId !== companyId) return res.status(404).json({ message: "Post not found" });
    if (existing.platformContentId) {
      return res.status(400).json({ message: "Articles from AI4Home are published as approved and can't be edited." });
    }

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
    if (contentChanged && ["APPROVED", "PUBLISHED"].includes(existing.status)) {
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
    if (!post.approvedAt || !["APPROVED"].includes(post.status)) {
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
