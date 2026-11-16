"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, Loader2, Newspaper, PenLine, RefreshCcw, Sparkles, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api";
import { sendJson } from "@/lib/b2b-store";
import NewsSourcesDialog from "@/components/admin/NewsSourcesDialog";

type Status = "CANDIDATE" | "DRAFT" | "PUBLISHED" | "REJECTED";
type Post = {
  id: string;
  status: Status;
  origin: "SCRAPED" | "AI" | "MANUAL";
  title: string;
  summary: string;
  originalUrl: string;
  source: string;
  sources: { id: string; title: string; url: string; source: string }[] | null;
  articleDate: string;
  publishedAt: string | null;
  publishedByName: string | null;
};
type Editing = { id?: string; title: string; summary: string; originalUrl: string; source: string };

const API = "/api/admin/news";
const TABS: { value: Status; label: string }[] = [
  { value: "CANDIDATE", label: "To review" },
  { value: "DRAFT", label: "Drafts" },
  { value: "PUBLISHED", label: "Published" },
  { value: "REJECTED", label: "Rejected" },
];
const ORIGIN: Record<Post["origin"], string> = { SCRAPED: "Scraped", AI: "AI combined", MANUAL: "Written" };
const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

/** Super Admin → Content → News: builders only see what is published here. */
export default function NewsView() {
  const [tab, setTab] = useState<Status>("CANDIDATE");
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [counts, setCounts] = useState<Partial<Record<Status, number>>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);

  const load = useCallback(async (status: Status) => {
    try {
      const data = await apiFetch<{ posts: Post[]; counts: Partial<Record<Status, number>> }>(`${API}?status=${status}`);
      setPosts(data.posts);
      setCounts(data.counts);
    } catch (e) {
      toast.error(errorText(e));
      setPosts([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload on tab change
    setSelected([]);
    void load(tab);
  }, [tab, load]);

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await fn();
      if (done) toast.success(done);
      setSelected([]);
      await load(tab);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const setStatus = (post: Post, status: Status, done: string) =>
    run(post.id, () => sendJson(`${API}/${post.id}`, "PATCH", { status }), done);

  const fetchNow = () =>
    run("fetch", async () => {
      const r = await sendJson<{ saved: number; failedSources: number }>(`${API}/fetch`, "POST", {});
      toast.success(r.saved ? `${r.saved} new article${r.saved === 1 ? "" : "s"} to review.` : "No new articles.");
      if (r.failedSources) toast.warning(`${r.failedSources} source${r.failedSources === 1 ? "" : "s"} couldn't be read.`);
      setTab("CANDIDATE");
    });

  const combine = () =>
    run("combine", async () => {
      const { post } = await sendJson<{ post: Post }>(`${API}/combine`, "POST", { ids: selected });
      setTab("DRAFT");
      setEditing({ id: post.id, title: post.title, summary: post.summary, originalUrl: post.originalUrl, source: post.source });
    }, "AI draft ready. Review it, then publish.");

  const save = (publish: boolean) => {
    if (!editing) return;
    const body = { title: editing.title, summary: editing.summary, originalUrl: editing.originalUrl, source: editing.source };
    return run("save", async () => {
      const id = editing.id ?? (await sendJson<{ post: Post }>(API, "POST", body)).post.id;
      await sendJson(`${API}/${id}`, "PATCH", { ...body, ...(publish ? { status: "PUBLISHED" } : {}) });
      setEditing(null);
      if (publish) setTab("PUBLISHED");
      else if (!editing.id) setTab("DRAFT");
    }, publish ? "Published. Builders can see it now." : "Saved as a draft.");
  };

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <Newspaper className="h-5 w-5 text-[#b48c3c]" /> Housing news
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Review the scraped housing news, combine related stories into one post with AI, or write your own.
            Builders only see what you publish. Published news also feeds builders&apos; news campaigns and the AI on the Content page.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <NewsSourcesDialog />
          <Button variant="outline" className="gap-1.5" disabled={!!busy} onClick={fetchNow}>
            {busy === "fetch" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />} Fetch now
          </Button>
          <Button className="gap-1.5 bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" onClick={() => setEditing({ title: "", summary: "", originalUrl: "", source: "AI for Homebuilders" })}>
            <PenLine className="h-4 w-4" /> Write a post
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Status)}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
                {counts[t.value] ? <span className="ml-1.5 text-muted-foreground">({counts[t.value]})</span> : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {tab === "CANDIDATE" && (
          <Button size="sm" className="gap-1.5" disabled={selected.length < 2 || !!busy} onClick={combine}>
            {busy === "combine" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Combine with AI{selected.length ? ` (${selected.length})` : ""}
          </Button>
        )}
      </div>
      {tab === "CANDIDATE" && (
        <p className="-mt-3 text-xs text-muted-foreground">Tick two or more related stories to combine them into one post. The AI writes a draft; you edit and publish it.</p>
      )}

      {!posts ? (
        <Loader2 className="mx-auto my-10 h-5 w-5 animate-spin text-muted-foreground" />
      ) : !posts.length ? (
        <p className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          {tab === "CANDIDATE" ? "Nothing to review. New articles arrive every morning, or press Fetch now." : "Nothing here yet."}
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {posts.map((p) => (
            <Card key={p.id} className={`border-border shadow-sm ${selected.includes(p.id) ? "ring-2 ring-[#b48c3c]/60" : ""}`}>
              <CardContent className="flex h-full flex-col gap-2 p-4">
                <div className="flex items-start gap-3">
                  {tab === "CANDIDATE" && (
                    <Checkbox checked={selected.includes(p.id)} onCheckedChange={() => toggle(p.id)} aria-label={`Select ${p.title}`} className="mt-1" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Badge variant="secondary" className="text-[10px]">{p.source}</Badge>
                      {p.origin !== "SCRAPED" && <Badge variant="outline" className="text-[10px]">{ORIGIN[p.origin]}</Badge>}
                      <span className="ml-auto">
                        {p.status === "PUBLISHED" && p.publishedAt
                          ? `Published ${day(p.publishedAt)}${p.publishedByName ? ` by ${p.publishedByName}` : ""}`
                          : day(p.articleDate)}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold leading-snug">{p.title}</h3>
                  </div>
                </div>
                <p className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{p.summary}</p>
                {p.sources?.length ? (
                  <div className="text-[11px] text-muted-foreground">
                    Sources:{" "}
                    {p.sources.map((s, i) => (
                      <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="hover:underline">
                        {i ? ", " : ""}{s.source}
                      </a>
                    ))}
                  </div>
                ) : null}
                <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2.5">
                  {p.status !== "PUBLISHED" && (
                    <Button size="sm" className="h-7 gap-1 text-xs" disabled={!!busy} onClick={() => setStatus(p, "PUBLISHED", "Published. Builders can see it now.")}>
                      <Check className="h-3.5 w-3.5" /> Publish
                    </Button>
                  )}
                  {p.status !== "PUBLISHED" && (
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setEditing({ id: p.id, title: p.title, summary: p.summary, originalUrl: p.originalUrl, source: p.source })}>
                      <PenLine className="h-3.5 w-3.5" /> Edit
                    </Button>
                  )}
                  {p.status === "PUBLISHED" && (
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={!!busy} onClick={() => setStatus(p, "DRAFT", "Unpublished. Builders no longer see it.")}>
                      <Undo2 className="h-3.5 w-3.5" /> Unpublish
                    </Button>
                  )}
                  {p.status === "REJECTED" && (
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={!!busy} onClick={() => setStatus(p, "DRAFT", "Moved to drafts.")}>
                      <Undo2 className="h-3.5 w-3.5" /> Move to drafts
                    </Button>
                  )}
                  {(p.status === "CANDIDATE" || p.status === "DRAFT") && (
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-muted-foreground" disabled={!!busy}
                      onClick={() => p.status === "CANDIDATE" ? setStatus(p, "REJECTED", "Rejected.") : run(p.id, () => sendJson(`${API}/${p.id}`, "DELETE"), "Draft deleted.")}>
                      <X className="h-3.5 w-3.5" /> {p.status === "CANDIDATE" ? "Reject" : "Delete"}
                    </Button>
                  )}
                  {p.originalUrl && (
                    <a href={p.originalUrl} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 text-[11px] font-medium text-[#b48c3c] hover:underline">
                      Original <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit post" : "Write a post"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="news-title">Headline</Label>
                <Input id="news-title" value={editing.title} maxLength={200} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="news-summary">Text builders will read</Label>
                <Textarea id="news-summary" rows={9} value={editing.summary} maxLength={5000} onChange={(e) => setEditing({ ...editing, summary: e.target.value })} />
              </div>
              <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                <div className="space-y-1.5">
                  <Label htmlFor="news-url">Link to the original (optional)</Label>
                  <Input id="news-url" type="url" placeholder="https://" value={editing.originalUrl} onChange={(e) => setEditing({ ...editing, originalUrl: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="news-source">Source label</Label>
                  <Input id="news-source" value={editing.source} maxLength={120} onChange={(e) => setEditing({ ...editing, source: e.target.value })} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy === "save"} onClick={() => save(false)}>Save draft</Button>
            <Button className="gap-1.5 bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" disabled={busy === "save" || !editing?.title.trim() || !editing?.summary.trim()} onClick={() => save(true)}>
              {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" />} Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
