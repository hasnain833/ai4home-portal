"use client";

import { useEffect, useState } from "react";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Bot, Newspaper, ExternalLink, Calendar, Loader2, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ScrapedNews {
  id: string;
  title: string;
  originalUrl: string;
  summary: string;
  source: string;
  imageUrl?: string;
  publishedAt: string;
}

export default function SalesNewsPage() {
  const [news, setNews] = useState<ScrapedNews[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchNews = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/sales/news");
      if (res.ok) {
        const json = await res.json();
        setNews(json.data || []);
      }
    } catch (err) {
      console.error("Failed to fetch news:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchNews();
  }, []);

  return (
    <ProtectedRoute allowedRoles={["admin", "staff"]}>
      <PortalLayout workspace="sales">
        <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full h-full pb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-3">
                <Newspaper className="h-7 w-7 text-primary" />
                Housing Market News
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                AI-summarized market news that powers your calendar suggestions and blog drafts. Nothing is sent to leads without your approval.
              </p>
            </div>
            <Button className="gap-2" variant="outline" onClick={fetchNews}>
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </Button>
          </div>

          <div className="flex-1 overflow-auto pr-2">
            {isLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
              </div>
            ) : news.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 border border-dashed rounded-xl border-border bg-card/50">
                <Newspaper className="h-10 w-10 text-muted-foreground mb-3 opacity-50" />
                <p className="text-muted-foreground font-medium">No news articles found yet.</p>
                <p className="text-xs text-muted-foreground/70 max-w-sm text-center mt-1">
                  The AI News Scraper runs daily and will populate this feed automatically.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {news.map((item) => (
                  <div key={item.id} className="flex flex-col border border-border bg-card rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow group">
                    <div className="p-5 flex-1 flex flex-col">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-secondary text-secondary-foreground">
                          {item.source}
                        </span>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground ml-auto">
                          <Calendar className="h-3.5 w-3.5" />
                          {new Date(item.publishedAt).toLocaleDateString()}
                        </div>
                      </div>
                      
                      <h3 className="text-lg font-bold leading-tight mb-2 group-hover:text-primary transition-colors line-clamp-2">
                        {item.title}
                      </h3>
                      
                      <div className="flex items-start gap-2 mb-4">
                        <Bot className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                        <p className="text-sm text-muted-foreground line-clamp-4">
                          {item.summary}
                        </p>
                      </div>

                      <div className="mt-auto pt-4 flex items-center justify-between border-t border-border/50">
                        <div className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground">
                          <Bot className="h-3.5 w-3.5 text-primary" />
                          Available for calendar &amp; blog
                        </div>
                        <a 
                          href={item.originalUrl} 
                          target="_blank" 
                          rel="noreferrer"
                          className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
                        >
                          Read Original <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
