"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Newspaper, Plus, Trash2, Save, Rss } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface NewsSource {
  url: string;
  label: string;
  enabled: boolean;
}

function isHttpUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export default function AdminNewsDefaultsPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [isCustomized, setIsCustomized] = useState(false);
  const [inheriting, setInheriting] = useState({ companies: 0, total: 0 });
  const [newUrl, setNewUrl] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/news-defaults");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "Could not load default sources.");
        return;
      }
      setError("");
      setSources(data.sources || []);
      setIsCustomized(!!data.isCustomized);
      setInheriting({
        companies: data.inheritingCompanies || 0,
        total: data.totalCompanies || 0,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.isSuperAdmin) load();
  }, [user, load]);

  const addSource = () => {
    const url = newUrl.trim();
    if (!url) return;
    if (!isHttpUrl(url)) {
      toast.error("Enter a valid http(s) feed URL.");
      return;
    }
    if (sources.some((s) => s.url.toLowerCase() === url.toLowerCase())) {
      toast.error("That source is already in the list.");
      return;
    }
    let host = url;
    try {
      host = new URL(url).hostname;
    } catch {
      /* validated above */
    }
    setSources((prev) => [
      ...prev,
      { url, label: newLabel.trim() || host, enabled: true },
    ]);
    setNewUrl("");
    setNewLabel("");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/news-defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Failed to save");
      setSources(data.sources || []);
      setIsCustomized(!!data.isCustomized);
      toast.success("Platform default sources saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#b48c3c]/10 text-[#b48c3c]">
              <Newspaper className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl text-foreground">
                Default News Sources
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                The feeds every tenant inherits until it configures its own in
                Sales → Settings → News. Editing here does not touch tenants
                that already chose their own sources.
              </p>
            </div>
          </div>
          {!loading && !error && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {inheriting.companies} of {inheriting.total} companies inherit
                these
              </Badge>
              {!isCustomized && (
                <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-400">
                  Using the built-in list
                </Badge>
              )}
            </div>
          )}
        </CardHeader>

        <CardContent className="space-y-4 p-4 md:p-6">
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
              Loading default sources…
            </div>
          ) : error ? (
            <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-400">
              {error}
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {sources.length === 0 ? (
                  <div className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                    <Rss className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      No default sources. Saving an empty list means tenants
                      with no sources of their own fall back to the built-in
                      feed.
                    </span>
                  </div>
                ) : (
                  sources.map((s) => (
                    <div
                      key={s.url}
                      className="flex items-center gap-3 rounded-lg border p-2.5 pl-3 bg-slate-50/40 dark:bg-slate-900/20">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
                          {s.label}
                        </p>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          {s.url}
                        </p>
                      </div>
                      <label className="flex shrink-0 cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={s.enabled}
                          onChange={() =>
                            setSources((prev) =>
                              prev.map((x) =>
                                x.url === s.url
                                  ? { ...x, enabled: !x.enabled }
                                  : x,
                              ),
                            )
                          }
                          className="h-4 w-4 accent-[#b48c3c]"
                        />
                        <span className="w-12 text-[11px] font-medium text-muted-foreground">
                          {s.enabled ? "On" : "Off"}
                        </span>
                      </label>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-red-500 hover:bg-red-500/10"
                        onClick={() =>
                          setSources((prev) =>
                            prev.filter((x) => x.url !== s.url),
                          )
                        }
                        title="Remove source">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))
                )}
              </div>

              <div className="grid items-end gap-2 pt-1 sm:grid-cols-[1fr_1.6fr_auto]">
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-medium text-muted-foreground">
                    Label (optional)
                  </Label>
                  <Input
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="e.g. National Housing"
                    className="h-9 text-xs"
                    maxLength={80}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-medium text-muted-foreground">
                    Feed URL (RSS/Atom)
                  </Label>
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
                    className="h-9 font-mono text-xs"
                  />
                </div>
                <Button
                  onClick={addSource}
                  variant="outline"
                  className="h-9 shrink-0 gap-1.5 text-xs">
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>
            </>
          )}
        </CardContent>

        {!loading && !error && (
          <CardFooter className="flex justify-end border-t border-border bg-slate-50/50 p-4 dark:bg-slate-900/20">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="h-9 border-none bg-[#b48c3c] px-4 text-xs text-white hover:bg-[#b48c3c]/90">
              {saving ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-3.5 w-3.5" />
              )}
              Save Defaults
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
