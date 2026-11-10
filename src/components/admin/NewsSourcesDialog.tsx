"use client";

import { useState } from "react";
import { Loader2, Plus, Rss, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface NewsSource {
  url: string;
  label: string;
  enabled: boolean;
}

const API = "/api/admin/news-defaults";

function isHttpUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** "Sources" button on the News page: the RSS feeds the daily scrape reads. */
export default function NewsSourcesDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [isCustomized, setIsCustomized] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [error, setError] = useState("");

  const openDialog = async () => {
    setOpen(true);
    setLoading(true);
    try {
      const res = await fetch(API);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "Could not load the sources.");
        return;
      }
      setError("");
      setSources(data.sources || []);
      setIsCustomized(!!data.isCustomized);
    } finally {
      setLoading(false);
    }
  };

  const addSource = () => {
    const url = newUrl.trim();
    if (!url) return;
    if (!isHttpUrl(url)) return toast.error("Enter a valid http(s) feed URL.");
    if (sources.some((s) => s.url.toLowerCase() === url.toLowerCase())) return toast.error("That source is already in the list.");
    setSources((prev) => [...prev, { url, label: newLabel.trim() || new URL(url).hostname, enabled: true }]);
    setNewUrl("");
    setNewLabel("");
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(API, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sources }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Failed to save");
      toast.success("News sources saved.");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button variant="outline" className="gap-1.5" onClick={openDialog}>
        <Rss className="h-4 w-4" /> Sources
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {/* minmax(0,1fr): a long feed URL truncates instead of widening the dialog past its edge. */}
        <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              News sources
              {!loading && !error && !isCustomized && <Badge variant="outline" className="font-sans text-[10px] font-medium text-muted-foreground">Built-in list</Badge>}
            </DialogTitle>
            <DialogDescription>The RSS feeds the daily scrape reads. New articles wait under To review; builders only see what you publish.</DialogDescription>
          </DialogHeader>

          {loading ? (
            <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin text-muted-foreground" />
          ) : error ? (
            <p className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-400">{error}</p>
          ) : (
            <div className="space-y-4">
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {sources.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                    No sources. Saving an empty list falls back to the built-in feed.
                  </p>
                ) : (
                  sources.map((s) => (
                    <div key={s.url} className="flex items-center gap-3 rounded-lg border p-2.5 pl-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold">{s.label}</p>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">{s.url}</p>
                      </div>
                      <label className="flex shrink-0 cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={s.enabled}
                          onChange={() => setSources((prev) => prev.map((x) => (x.url === s.url ? { ...x, enabled: !x.enabled } : x)))}
                          className="h-4 w-4 accent-[#b48c3c]"
                        />
                        <span className="w-7 text-[11px] font-medium text-muted-foreground">{s.enabled ? "On" : "Off"}</span>
                      </label>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-red-500 hover:bg-red-500/10"
                        onClick={() => setSources((prev) => prev.filter((x) => x.url !== s.url))}
                        aria-label={`Remove ${s.label}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))
                )}
              </div>

              <div className="grid items-end gap-2 sm:grid-cols-[1fr_1.6fr_auto]">
                <div className="space-y-1.5">
                  <Label htmlFor="source-label" className="text-[11px] text-muted-foreground">Label (optional)</Label>
                  <Input id="source-label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. National Housing" className="h-9 text-xs" maxLength={80} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="source-url" className="text-[11px] text-muted-foreground">Feed URL (RSS/Atom)</Label>
                  <Input
                    id="source-url"
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addSource();
                      }
                    }}
                    placeholder="https://example.com/feed.xml"
                    className="h-9 font-mono text-xs"
                  />
                </div>
                <Button onClick={addSource} variant="outline" className="h-9 gap-1.5 text-xs">
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || loading || !!error} className="gap-1.5 bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save sources
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
