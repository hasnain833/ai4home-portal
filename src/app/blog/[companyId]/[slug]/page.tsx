"use client";

import { useEffect, useState } from "react";
import { use } from "react";
import Link from "next/link";

interface PublicPost {
  title: string;
  excerpt?: string | null;
  html: string;
  category: string;
  tags: string[];
  publishedAt: string;
  citations?: { title: string; url: string }[] | null;
}

export default function PublicBlogPost({ params }: { params: Promise<{ companyId: string; slug: string }> }) {
  const { companyId, slug } = use(params);
  const [post, setPost] = useState<PublicPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/public/blog/${companyId}/${slug}`);
        if (!res.ok) throw new Error("Post not found");
        setPost(await res.json());
      } catch (e: any) {
        setError(e.message || "Post not found");
      } finally {
        setLoading(false);
      }
    })();
  }, [companyId, slug]);

  if (loading) return <main className="max-w-3xl mx-auto px-6 py-16 text-sm text-muted-foreground">Loading…</main>;
  if (error || !post) return <main className="max-w-3xl mx-auto px-6 py-16 text-sm text-red-500">{error || "Not found"}</main>;

  return (
    <main className="max-w-3xl mx-auto px-6 py-16">
      <Link href={`/blog/${companyId}`} className="text-xs text-muted-foreground hover:underline">← Back to blog</Link>
      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-6 mb-2">
        <span>{post.category}</span>
        <span>·</span>
        <span>{new Date(post.publishedAt).toLocaleDateString()}</span>
      </div>
      <h1 className="text-4xl font-bold mb-8 leading-tight">{post.title}</h1>
      {/* Server-rendered from tenant-approved Markdown, escaped in markdownToHtml(). */}
      <article
        className="prose prose-slate dark:prose-invert max-w-none [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-2xl [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-xl [&_h3]:font-semibold [&_p]:my-4 [&_p]:leading-relaxed [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_a]:text-blue-600 [&_a]:underline"
        dangerouslySetInnerHTML={{ __html: post.html }}
      />
      {Array.isArray(post.citations) && post.citations.length > 0 && (
        <div className="mt-12 pt-6 border-t">
          <h2 className="text-sm font-semibold mb-2">Sources</h2>
          <ul className="text-sm space-y-1">
            {post.citations.map((c, i) => (
              <li key={i}>
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">{c.title}</a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
