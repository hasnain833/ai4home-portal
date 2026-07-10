"use client";

import { useEffect, useState } from "react";
import { use } from "react";
import Link from "next/link";

interface PublicPost {
  id: string;
  title: string;
  slug: string;
  excerpt?: string | null;
  category: string;
  tags: string[];
  publishedAt: string;
}

export default function PublicBlogList({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = use(params);
  const [posts, setPosts] = useState<PublicPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/public/blog/${companyId}`);
        if (!res.ok) throw new Error("Unable to load blog");
        setPosts(await res.json());
      } catch (e: any) {
        setError(e.message || "Unable to load blog");
      } finally {
        setLoading(false);
      }
    })();
  }, [companyId]);

  return (
    <main className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="text-3xl font-bold mb-2">Blog</h1>
      <p className="text-muted-foreground mb-10 text-sm">Insights, market news, and homeowner guides.</p>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {!loading && !error && posts.length === 0 && (
        <p className="text-sm text-muted-foreground">No posts published yet.</p>
      )}

      <div className="space-y-8">
        {posts.map((p) => (
          <article key={p.id} className="border-b pb-6">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <span>{p.category}</span>
              <span>·</span>
              <span>{new Date(p.publishedAt).toLocaleDateString()}</span>
            </div>
            <Link href={`/blog/${companyId}/${p.slug}`} className="text-xl font-semibold hover:underline">
              {p.title}
            </Link>
            {p.excerpt && <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{p.excerpt}</p>}
          </article>
        ))}
      </div>
    </main>
  );
}
