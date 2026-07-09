"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Bot, Newspaper, ExternalLink, Calendar, Loader2, RefreshCcw, Megaphone, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface ScrapedNews {
  id: string;
  title: string;
  originalUrl: string;
  summary: string;
  source: string;
  imageUrl?: string;
  publishedAt: string;
}

const PAGE_SIZE = 8;

export default function SalesNewsPage() {
  const router = useRouter();
  const [news, setNews] = useState<ScrapedNews[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [creatingId, setCreatingId] = useState<string | null>(null);

  const fetchNews = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/sales/news?limit=200");
      if (res.ok) {
        const json = await res.json();
        setNews(json.data || []);
        setPage(1);
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

  const createCampaignFromNews = async (item: ScrapedNews) => {
    setCreatingId(item.id);
    try {
      const res = await fetch("/api/sales/campaigns/from-news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newsId: item.id }),
      });
      if (res.ok) {
        toast.success("Campaign drafted in Nurture Campaigns", {
          description: "Email + SMS steps were added. Enroll leads and launch it there.",
          action: { label: "Open", onClick: () => router.push("/sales/campaigns") },
        });
      } else {
        const j = await res.json().catch(() => ({}));
        toast.error(j.message || "Failed to create campaign.");
      }
    } catch {
      toast.error("Error creating campaign.");
    } finally {
      setCreatingId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(news.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedNews = news.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

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
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  {pagedNews.map((item) => (
                    <div key={item.id} className="flex flex-col border border-border bg-card rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow group">
                      <div className="p-4 flex-1 flex flex-col">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold border-transparent bg-secondary text-secondary-foreground">
                            {item.source}
                          </span>
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground ml-auto">
                            <Calendar className="h-3 w-3" />
                            {new Date(item.publishedAt).toLocaleDateString()}
                          </div>
                        </div>

                        <h3 className="text-sm font-bold leading-snug mb-1.5 group-hover:text-primary transition-colors line-clamp-2">
                          {item.title}
                        </h3>

                        <div className="flex items-start gap-1.5 mb-3">
                          <Bot className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {item.summary}
                          </p>
                        </div>

                        <div className="mt-auto pt-2.5 flex items-center justify-between gap-2 border-t border-border/50">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px] gap-1.5 px-2.5"
                            disabled={creatingId === item.id}
                            onClick={() => createCampaignFromNews(item)}
                          >
                            {creatingId === item.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Megaphone className="h-3.5 w-3.5" />
                            )}
                            Create Campaign
                          </Button>
                          <a
                            href={item.originalUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] font-semibold text-primary hover:underline flex items-center gap-1 shrink-0"
                          >
                            Read Original <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-3 mt-6">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 h-8"
                      disabled={currentPage === 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-4 w-4" /> Prev
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Page {currentPage} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 h-8"
                      disabled={currentPage === totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      Next <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
