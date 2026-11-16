"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, FileText, Lightbulb, Loader2, Newspaper, PenLine, PenSquare, Sparkles, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api";
import { sendJson } from "@/lib/b2b-store";
import NewsView from "@/components/admin/NewsView";

type Kind = "BLOG" | "IDEA";
type View = Kind | "NEWS";
type Status = "DRAFT" | "PUBLISHED" | "REJECTED";
type Item = {
  id: string;
  kind: Kind;
  status: Status;
  origin: "AI" | "MANUAL";
  title: string;
  excerpt: string | null;
  content: string;
  category: string;
  tags: string[];
  metaTitle: string | null;
  metaDescription: string | null;
  channel: string | null;
  suggestedFor: string | null;
  reason: string | null;
  publishedAt: string | null;
  publishedByName: string | null;
  updatedAt: string;
  usedBy: number;
};
type Editing = Partial<Item> & { kind: Kind; tagsText?: string };

const API = "/api/admin/content";
const STATUS_TABS: { value: Status; label: string }[] = [
  { value: "DRAFT", label: "To review" },
  { value: "PUBLISHED", label: "Published" },
  { value: "REJECTED", label: "Rejected" },
];
const CATEGORIES = ["Market Trends", "Home Design", "Finance", "Warranty & Support"];
const CHANNELS = ["Email", "SMS", "Blog", "Announcement"];
const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

/** Super Admin → Content: news, blog articles and calendar ideas. Builders only get what is published here. */
export default function AdminContentPage() {
  const [view, setView] = useState<View>("NEWS");
  const kind: Kind = view === "IDEA" ? "IDEA" : "BLOG";
  const [tab, setTab] = useState<Status>("DRAFT");
  const [items, setItems] = useState<Item[] | null>(null);
  const [counts, setCounts] = useState<Partial<Record<Status, number>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [preview, setPreview] = useState<Item | null>(null);

  // ?kind=BLOG / IDEA / NEWS opens that tab (old /admin/news links send NEWS).
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("kind");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the URL
    if (wanted === "BLOG" || wanted === "IDEA" || wanted === "NEWS") setView(wanted);
  }, []);

  const load = useCallback(async () => {
    if (view === "NEWS") return;
    try {
      const data = await apiFetch<{ items: Item[]; counts: Partial<Record<Status, number>> }>(`${API}?kind=${kind}&status=${tab}`);
      setItems(data.items);
      setCounts(data.counts);
    } catch (e) {
      toast.error(errorText(e));
      setItems([]);
    }
  }, [view, kind, tab]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload on tab change, as on News
    void load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await fn();
      if (done) toast.success(done);
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const setStatus = (item: Item, status: Status, done: string) =>
    run(item.id, () => sendJson(`${API}/${item.id}`, "PATCH", { status }), done);

  const generate = () =>
    run("generate", async () => {
      await sendJson(`${API}/generate`, "POST", { kind, topic });
      setTopic("");
      setTab("DRAFT");
    }, kind === "BLOG" ? "AI article ready to review." : "AI ideas ready to review.");

  const openEditor = (item?: Item) =>
    setEditing(item ? { ...item, tagsText: item.tags.join(", ") } : { kind, title: "", content: "", category: "Market Trends", channel: "Email", tagsText: "" });

  const save = (publish: boolean) => {
    if (!editing) return;
    const body = {
      kind: editing.kind,
      title: editing.title,
      content: editing.content,
      ...(editing.kind === "BLOG"
        ? { excerpt: editing.excerpt || "", category: editing.category, tags: editing.tagsText || "", metaTitle: editing.metaTitle || "", metaDescription: editing.metaDescription || "" }
        : { channel: editing.channel, reason: editing.reason || "", suggestedFor: editing.suggestedFor ? editing.suggestedFor.slice(0, 10) : null }),
    };
    return run("save", async () => {
      const id = editing.id ?? (await sendJson<{ item: Item }>(API, "POST", body)).item.id;
      await sendJson(`${API}/${id}`, "PATCH", { ...body, ...(publish ? { status: "PUBLISHED" } : {}) });
      setEditing(null);
      setTab(publish ? "PUBLISHED" : "DRAFT");
    }, publish ? "Published. Builders can use it now." : "Saved.");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <PenSquare className="h-7 w-7 text-[#b48c3c]" /> Content
          </h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            Everything builders get from the AI for Homebuilders team: housing news, blog articles and calendar ideas.
            Builders only see what you publish here. Articles and ideas are used word for word, with their company name
            filled in where you write <span className="font-mono text-xs">{"{{companyName}}"}</span>.
          </p>
        </div>
        {view !== "NEWS" && (
          <Button className="gap-1.5 bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" onClick={() => openEditor()}>
            <PenLine className="h-4 w-4" /> {kind === "BLOG" ? "Write an article" : "Write an idea"}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={view} onValueChange={(v) => { setView(v as View); setItems(null); }}>
          <TabsList>
            <TabsTrigger value="NEWS" className="gap-1.5"><Newspaper className="h-3.5 w-3.5" /> News</TabsTrigger>
            <TabsTrigger value="BLOG" className="gap-1.5"><FileText className="h-3.5 w-3.5" /> Blog articles</TabsTrigger>
            <TabsTrigger value="IDEA" className="gap-1.5"><Lightbulb className="h-3.5 w-3.5" /> Calendar ideas</TabsTrigger>
          </TabsList>
        </Tabs>
        {view !== "NEWS" && <Tabs value={tab} onValueChange={(v) => { setTab(v as Status); setItems(null); }}>
          <TabsList>
            {STATUS_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
                {counts[t.value] ? <span className="ml-1.5 text-muted-foreground">({counts[t.value]})</span> : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>}
      </div>

      {view === "NEWS" ? <NewsView /> : <>
      <Card className="border-border shadow-sm">
        <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="content-topic">{kind === "BLOG" ? "What should the article be about? (optional)" : "Any theme for this batch of ideas? (optional)"}</Label>
            <Input
              id="content-topic"
              value={topic}
              maxLength={500}
              disabled={busy === "generate"}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={kind === "BLOG" ? "e.g. what first-time buyers should know about new construction" : "e.g. spring buying season"}
            />
          </div>
          <Button className="gap-1.5" disabled={!!busy} onClick={generate}>
            {busy === "generate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {kind === "BLOG" ? "Generate article" : "Generate 6 ideas"}
          </Button>
        </CardContent>
        <p className="px-4 pb-3 -mt-1 text-xs text-muted-foreground">
          The AI uses this season and the news you published in the last 14 days. It writes for builders in general: no cities, prices or community names.
        </p>
      </Card>

      {!items ? (
        <Loader2 className="mx-auto my-10 h-5 w-5 animate-spin text-muted-foreground" />
      ) : !items.length ? (
        <p className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          {tab === "DRAFT" ? "Nothing to review. Generate with AI or write one yourself." : "Nothing here yet."}
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {items.map((item) => (
            <Card key={item.id} className="border-border shadow-sm">
              <CardContent className="flex h-full flex-col gap-2 p-4">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Badge variant="secondary" className="text-[10px]">{item.kind === "BLOG" ? item.category : item.channel}</Badge>
                  <Badge variant="outline" className="text-[10px]">{item.origin === "AI" ? "AI draft" : "Written"}</Badge>
                  {item.status === "PUBLISHED" && <Badge variant="outline" className="text-[10px]">Used by {item.usedBy} builder{item.usedBy === 1 ? "" : "s"}</Badge>}
                  <span className="ml-auto">
                    {item.status === "PUBLISHED" && item.publishedAt
                      ? `Published ${day(item.publishedAt)}${item.publishedByName ? ` by ${item.publishedByName}` : ""}`
                      : item.kind === "IDEA" && item.suggestedFor ? `For ${day(item.suggestedFor)}` : day(item.updatedAt)}
                  </span>
                </div>
                <h3 className="text-sm font-semibold leading-snug">{item.title}</h3>
                <p className="line-clamp-4 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                  {item.kind === "BLOG" ? item.excerpt || item.content : item.content}
                </p>
                {item.kind === "IDEA" && item.reason && <p className="text-[11px] italic text-muted-foreground">Why now: {item.reason}</p>}
                <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2.5">
                  {item.status !== "PUBLISHED" && (
                    <Button size="sm" className="h-7 gap-1 text-xs" disabled={!!busy} onClick={() => setStatus(item, "PUBLISHED", "Published. Builders can use it now.")}>
                      <Check className="h-3.5 w-3.5" /> Publish
                    </Button>
                  )}
                  {item.status !== "PUBLISHED" && (
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => openEditor(item)}>
                      <PenLine className="h-3.5 w-3.5" /> Edit
                    </Button>
                  )}
                  {item.kind === "BLOG" && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPreview(item)}>Read</Button>
                  )}
                  {item.status === "PUBLISHED" && (
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={!!busy} onClick={() => setStatus(item, "DRAFT", "Unpublished. Builders can't add it any more; copies already taken stay.")}>
                      <Undo2 className="h-3.5 w-3.5" /> Unpublish
                    </Button>
                  )}
                  {item.status === "DRAFT" && (
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-muted-foreground" disabled={!!busy} onClick={() => setStatus(item, "REJECTED", "Rejected.")}>
                      <X className="h-3.5 w-3.5" /> Reject
                    </Button>
                  )}
                  {item.status === "REJECTED" && (
                    <>
                      <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={!!busy} onClick={() => setStatus(item, "DRAFT", "Moved back to review.")}>
                        <Undo2 className="h-3.5 w-3.5" /> Back to review
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-muted-foreground" disabled={!!busy} onClick={() => run(item.id, () => sendJson(`${API}/${item.id}`, "DELETE"), "Deleted.")}>
                        <X className="h-3.5 w-3.5" /> Delete
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      </>}

      {/* Read a full article */}
      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{preview?.title}</DialogTitle>
            {preview?.excerpt && <DialogDescription>{preview.excerpt}</DialogDescription>}
          </DialogHeader>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{preview?.content}</p>
        </DialogContent>
      </Dialog>

      {/* Write or edit */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit" : "Write"} {editing?.kind === "BLOG" ? "article" : "calendar idea"}</DialogTitle>
            <DialogDescription>
              Builders get exactly this text. Write <span className="font-mono">{"{{companyName}}"}</span> where their name belongs, and leave out cities, prices and community names.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="c-title">{editing.kind === "BLOG" ? "Title" : "Topic"}</Label>
                <Input id="c-title" value={editing.title || ""} maxLength={200} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              </div>
              {editing.kind === "BLOG" ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="c-excerpt">Excerpt</Label>
                    <Input id="c-excerpt" value={editing.excerpt || ""} maxLength={500} onChange={(e) => setEditing({ ...editing, excerpt: e.target.value })} />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="c-category">Category</Label>
                      <select id="c-category" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="c-tags">Tags (comma-separated)</Label>
                      <Input id="c-tags" value={editing.tagsText || ""} onChange={(e) => setEditing({ ...editing, tagsText: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="c-mt">SEO title</Label>
                      <Input id="c-mt" value={editing.metaTitle || ""} maxLength={120} onChange={(e) => setEditing({ ...editing, metaTitle: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="c-md">SEO description</Label>
                      <Input id="c-md" value={editing.metaDescription || ""} maxLength={320} onChange={(e) => setEditing({ ...editing, metaDescription: e.target.value })} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="c-body">Article (Markdown, ## for headings)</Label>
                    <Textarea id="c-body" rows={14} className="font-mono text-xs" value={editing.content || ""} onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
                  </div>
                </>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="c-channel">Channel</Label>
                      <select id="c-channel" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={editing.channel || "Email"} onChange={(e) => setEditing({ ...editing, channel: e.target.value })}>
                        {CHANNELS.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="c-date">Suggested date</Label>
                      <Input id="c-date" type="date" value={editing.suggestedFor ? editing.suggestedFor.slice(0, 10) : ""} onChange={(e) => setEditing({ ...editing, suggestedFor: e.target.value || null })} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="c-reason">Why now</Label>
                    <Input id="c-reason" value={editing.reason || ""} maxLength={1000} onChange={(e) => setEditing({ ...editing, reason: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="c-outline">Outline</Label>
                    <Textarea id="c-outline" rows={7} value={editing.content || ""} onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
                  </div>
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy === "save"} onClick={() => save(false)}>Save</Button>
            <Button className="gap-1.5 bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" disabled={busy === "save" || !editing?.title?.trim() || !editing?.content?.trim()} onClick={() => save(true)}>
              {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" />} Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
