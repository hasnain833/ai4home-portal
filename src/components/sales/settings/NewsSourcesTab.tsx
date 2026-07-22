"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Newspaper, Plus, Trash2, Save, RefreshCcw, Rss } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { fetchKey, invalidate, QUERY_KEYS } from "@/lib/use-query";

interface NewsSource {
  url: string;
  label: string;
  enabled: boolean;
}

// The platform default shown as a hint when a tenant has configured nothing.
const DEFAULT_HINT = "Google News — Housing Market (used until you add your own)";

function isHttpUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export default function NewsSourcesTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [newUrl, setNewUrl] = useState("");
  const [newLabel, setNewLabel] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchKey<{ newsSources?: NewsSource[] }>(QUERY_KEYS.company)
      .then((data) => {
        if (cancelled || !Array.isArray(data?.newsSources)) return;
        setSources(
          data.newsSources.map((s: NewsSource) => ({
            url: String(s.url || ""),
            label: String(s.label || ""),
            enabled: s.enabled === undefined ? true : !!s.enabled,
          })),
        );
      })
      .catch((error) => console.error("Failed to load news sources:", error))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const addSource = () => {
    const url = newUrl.trim();
    if (!url) return;
    if (!isHttpUrl(url)) {
      toast.error("Enter a valid http(s) feed URL.");
      return;
    }
    if (sources.some((s) => s.url.toLowerCase() === url.toLowerCase())) {
      toast.error("That source is already added.");
      return;
    }
    let host = url;
    try {
      host = new URL(url).hostname;
    } catch {
      /* validated above */
    }
    setSources((prev) => [...prev, { url, label: newLabel.trim() || host, enabled: true }]);
    setNewUrl("");
    setNewLabel("");
  };

  const removeSource = (url: string) => {
    setSources((prev) => prev.filter((s) => s.url !== url));
  };

  const toggleSource = (url: string) => {
    setSources((prev) => prev.map((s) => (s.url === url ? { ...s, enabled: !s.enabled } : s)));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/company", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ newsSources: sources }),
      });
      if (!res.ok) throw new Error("Failed to save news sources");
      const data = await res.json();
      // Reflect the server-normalized list (invalid/dupe entries dropped).
      if (Array.isArray(data?.newsSources)) setSources(data.newsSources);
      invalidate(QUERY_KEYS.company);
      toast.success("News sources saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleFetchNow = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/sales/news/refresh", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to fetch news");
      const failed = data.failedSources
        ? ` (${data.failedSources} source${data.failedSources === 1 ? "" : "s"} failed)`
        : "";
      toast.success(
        data.saved > 0
          ? `Fetched ${data.saved} new article${data.saved === 1 ? "" : "s"} from ${data.sources} source${data.sources === 1 ? "" : "s"}${failed}.`
          : `No new articles found${failed}. Your feed is up to date.`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to fetch news");
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-[#b48c3c]" />
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Card className="border border-border/80 shadow-xs max-w-3xl">
        <CardHeader className="border-b border-border/40 bg-slate-50/40 dark:bg-slate-950/20">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-50 dark:bg-amber-950/20 rounded-xl text-[#b48c3c]">
              <Newspaper className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold text-slate-800 dark:text-slate-100">
                Market News Sources
              </CardTitle>
              <CardDescription className="text-xs">
                Choose the RSS/Atom feeds this workspace scrapes for its Housing Market News feed, calendar
                suggestions, and blog drafts. Each company uses its own sources.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-5 space-y-4">
          {/* Existing sources */}
          <div className="space-y-2">
            {sources.length === 0 ? (
              <div className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                <Rss className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  No custom sources yet — the platform default is used:
                  <br />
                  <span className="font-medium text-slate-600 dark:text-slate-300">{DEFAULT_HINT}</span>
                </span>
              </div>
            ) : (
              sources.map((s) => (
                <div
                  key={s.url}
                  className="flex items-center gap-3 rounded-lg border p-2.5 pl-3 bg-slate-50/40 dark:bg-slate-900/20"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold truncate text-slate-800 dark:text-slate-100">{s.label}</p>
                    <p className="text-[11px] text-muted-foreground truncate font-mono">{s.url}</p>
                  </div>
                  <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      onChange={() => toggleSource(s.url)}
                      className="h-4 w-4 accent-[#b48c3c]"
                    />
                    <span className="text-[11px] font-medium text-muted-foreground w-12">
                      {s.enabled ? "On" : "Off"}
                    </span>
                  </label>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-red-500 hover:bg-red-500/10 shrink-0"
                    onClick={() => removeSource(s.url)}
                    title="Remove source"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>

          {/* Add a source */}
          <div className="grid gap-2 sm:grid-cols-[1fr_1.6fr_auto] pt-1 items-end">
            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium text-muted-foreground">Label (optional)</Label>
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. Local Market"
                className="h-9 text-xs"
                maxLength={80}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium text-muted-foreground">Feed URL (RSS/Atom)</Label>
              <Input
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSource();
                  }
                }}
                placeholder="https://example.com/feed.xml"
                className="h-9 text-xs font-mono"
              />
            </div>
            <Button onClick={addSource} variant="outline" className="h-9 text-xs gap-1.5 shrink-0">
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>

          <p className="text-[10px] text-muted-foreground leading-relaxed">
            The scraper runs daily. Failing sources are skipped without affecting the others. Use “Fetch latest now”
            to pull immediately after changing sources.
          </p>
        </CardContent>
        <CardFooter className="bg-slate-50/50 dark:bg-slate-900/20 border-t border-slate-100 dark:border-slate-800 flex justify-between p-4">
          <Button variant="outline" onClick={handleFetchNow} disabled={refreshing} className="h-9 text-xs gap-2">
            <RefreshCcw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Fetching…" : "Fetch latest now"}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90 border-none text-xs h-9 px-4"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Save Sources
          </Button>
        </CardFooter>
      </Card>
    </motion.div>
  );
}
