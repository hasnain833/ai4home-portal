"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, Check, FileUp, Link2, Loader2, Pencil, Plus, RefreshCw, Route, Send, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { apiFetch, errorMessage } from "@/lib/api";
import { B2B_API, sendJson } from "@/lib/b2b-store";

const API = `${B2B_API}/nurture`;
const CATEGORIES = { ABOUT: "About AI4HB", INDUSTRY: "AI and Homebuilding" } as const;
const CONTENT_STAGES = {
  FIRST_TOUCH: "First touch",
  NO_RESPONSE: "No response",
  QUARTERLY: "Quarterly check-in",
  BOT_ENGAGED: "Bot engaged",
  APPOINTMENT_BOOKED: "Appointment booked",
} as const;
const STAGE_LABELS: Record<string, string> = { ...CONTENT_STAGES, RESPONDED: "Responded" };
const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TABS = ["Review", "Library", "Sources", "Journey", "KPIs"] as const;
type Tab = (typeof TABS)[number];
type Category = keyof typeof CATEGORIES;
type ContentStage = keyof typeof CONTENT_STAGES;

// Half-hour slots on the lead's clock. The last is 8:30pm so a send never lands after 9pm.
const SEND_TIMES = Array.from({ length: 26 }, (_, i) => {
  const hour = 8 + Math.floor(i / 2);
  const minute = i % 2 ? "30" : "00";
  return { value: `${String(hour).padStart(2, "0")}:${minute}`, label: `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}` };
});

interface ContentItem {
  id: string;
  category: Category;
  stage: ContentStage;
  channel: "EMAIL" | "SMS";
  subject: string | null;
  body: string;
  status: "DRAFT" | "APPROVED" | "REJECTED" | "RETIRED";
  warning: string | null;
  reviewNote: string | null;
  reviewedBy: string | null;
  batchId: string | null;
  createdAt: string;
  sendOrder: number | null;
}
interface Source { id: string; title: string; url: string | null; text: string; active: boolean }
interface JourneyLead { id: string; companyName: string; contactName: string; email: string; journeyStage: string; journeyNextAt: string | null; journeyTouches: number; journeyHoldReason: string | null; agentPausedAt: string | null }
interface Journey {
  stages: { stage: string; count: number }[];
  leads: JourneyLead[];
  available: { id: string; companyName: string; email: string; source: string }[];
  approved: { stage: string; channel: string; category: string; count: number }[];
}
interface Settings { sendDays: string; emailTime: string; smsTime: string; emailsPerWeek: number; smsPerWeek: number }
interface Totals { sent: number; delivered: number; opened: number; clicked: number; failed: number }
interface Kpis {
  days: number;
  email: Totals;
  sms: Totals;
  replies: number;
  agentReplies: number;
  meetings: Record<string, number>;
  optOuts: { email: number; sms: number };
  stages: { stage: string; count: number }[];
  pieces: (Totals & { id: string; category: Category; stage: ContentStage; channel: string; status: string; label: string })[];
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "None scheduled");
const rate = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "–");
const newDraft = () => ({ category: "ABOUT" as Category, stage: "FIRST_TOUCH" as ContentStage, channel: "EMAIL" as "EMAIL" | "SMS", subject: "", body: "" });
type Draft = ReturnType<typeof newDraft> & { id?: string };

function PieceTags({ item }: { item: Pick<ContentItem, "category" | "stage" | "channel"> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge variant="outline" className={item.category === "ABOUT" ? "border-0 bg-[#0F3B3D]/10 text-[#0F3B3D] dark:text-emerald-300" : "border-0 bg-[#b48c3c]/15 text-[#8a6620] dark:text-[#e0b45c]"}>{CATEGORIES[item.category]}</Badge>
      <Badge variant="outline">{CONTENT_STAGES[item.stage]}</Badge>
      <Badge variant="outline">{item.channel === "SMS" ? "SMS" : "Email"}</Badge>
    </div>
  );
}

export default function NurtureView() {
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>("Review");
  const [items, setItems] = useState<ContentItem[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [focus, setFocus] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [testEmail, setTestEmail] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testing, setTesting] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadContent = useCallback(async () => {
    setItems(await apiFetch<ContentItem[]>(`${API}/content`));
  }, []);

  useEffect(() => {
    apiFetch<ContentItem[]>(`${API}/content`).then(setItems).catch((e) => toast.error(errorMessage(e)));
    apiFetch<Source[]>(`${API}/sources`).then(setSources).catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const review = items?.filter((i) => i.status === "DRAFT") ?? [];
  const stageOrder = Object.keys(CONTENT_STAGES);
  // Grouped the way the journey reads it: by stage, category and channel, then send order.
  const library = (items?.filter((i) => i.status === "APPROVED" || i.status === "RETIRED") ?? []).slice().sort((a, b) =>
    stageOrder.indexOf(a.stage) - stageOrder.indexOf(b.stage) ||
    a.category.localeCompare(b.category) ||
    a.channel.localeCompare(b.channel) ||
    (a.sendOrder ?? 99999) - (b.sendOrder ?? 99999));
  const activeSources = sources.filter((s) => s.active);
  const pickedSourceIds = activeSources.filter((s) => !unticked.has(s.id)).map((s) => s.id);
  const rejected = items?.filter((i) => i.status === "REJECTED") ?? [];

  // Writing runs in the background, so watch for the batch to arrive.
  const generate = async () => {
    setGenerating(true);
    try {
      const { batchId } = await sendJson<{ batchId: string }>(`${API}/content/generate`, "POST", { focus, sourceIds: pickedSourceIds });
      toast.success("Writing 10 pieces. They'll appear here in a minute or two.");
      let checks = 0;
      pollRef.current = setInterval(async () => {
        const found = await apiFetch<ContentItem[]>(`${API}/content?batchId=${batchId}`).catch(() => []);
        // Checks run every 5 seconds, so this gives up after 4 minutes.
        const timedOut = ++checks >= 48;
        if (found.length || timedOut) {
          if (pollRef.current) clearInterval(pollRef.current);
          setGenerating(false);
          if (found.length) {
            toast.success(`${found.length} pieces are ready to review.`);
            setFocus("");
            await loadContent();
          } else {
            toast.error("The batch is taking too long. Check back shortly, or try again.");
          }
        }
      }, 5000);
    } catch (e) {
      toast.error(errorMessage(e));
      setGenerating(false);
    }
  };

  const decide = async (item: ContentItem, decision: "approve" | "reject" | "retire" | "draft") => {
    setBusy(item.id);
    try {
      await sendJson(`${API}/content/${item.id}/review`, "POST", { decision });
      await loadContent();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const approveClean = async () => {
    const clean = review.filter((i) => !i.warning).slice(0, 10);
    const ok = await confirm({
      title: `Approve ${clean.length} piece${clean.length === 1 ? "" : "s"}?`,
      description: "They can start going out word for word. Pieces with a warning are left for you to check.",
      confirmText: "Approve",
      destructive: false,
    });
    if (!ok) return;
    setBusy("all");
    try {
      for (const item of clean) await sendJson(`${API}/content/${item.id}/review`, "POST", { decision: "approve" });
      toast.success("Approved.");
      await loadContent();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const rewrite = async (item: ContentItem) => {
    setBusy(item.id);
    try {
      await sendJson(`${API}/content/${item.id}/rewrite`, "POST", {});
      toast.success("Rewritten. Review it again.");
      await loadContent();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (item: ContentItem) => {
    if (!(await confirm({ title: "Delete this piece?", description: "This can't be undone.", confirmText: "Delete" }))) return;
    try {
      await sendJson(`${API}/content/${item.id}`, "DELETE");
      await loadContent();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const setOrder = async (item: ContentItem, value: string) => {
    const sendOrder = value.trim() === "" ? null : Number(value);
    if (sendOrder === item.sendOrder) return;
    try {
      await sendJson(`${API}/content/${item.id}/order`, "POST", { sendOrder });
      await loadContent();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const sendTest = async (item: ContentItem) => {
    const to = item.channel === "SMS" ? testPhone : testEmail;
    if (!to.trim()) return toast.error(`Enter your ${item.channel === "SMS" ? "phone number" : "email"} under Send tests to first.`);
    setTesting(item.id);
    try {
      const out = await sendJson<{ message: string }>(`${B2B_API}/campaigns/send-test`, "POST", { step: { channel: item.channel, subject: item.subject || "", body: item.body }, to });
      toast.success(out.message);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setTesting(null);
    }
  };

  const testButton = (item: ContentItem) => (
    <Button size="sm" variant="outline" className="gap-1.5" disabled={testing !== null} onClick={() => sendTest(item)}>
      {testing === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send test
    </Button>
  );

  const testInputs = (
    <div className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-[auto_1fr_1fr] sm:items-center">
      <p className="text-xs font-medium">Send tests to</p>
      <Input type="email" aria-label="Test email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="you@example.com" className="h-8 text-xs" />
      <Input type="tel" aria-label="Test phone" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="+1 (555) 123-4567" className="h-8 text-xs" />
    </div>
  );

  const save = async () => {
    if (!draft) return;
    try {
      await sendJson(draft.id ? `${API}/content/${draft.id}` : `${API}/content`, draft.id ? "PUT" : "POST", draft);
      toast.success(draft.id ? "Saved. It needs review before it can go out." : "Added to review.");
      setDraft(null);
      await loadContent();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const edit = (i: ContentItem) => setDraft({ id: i.id, category: i.category, stage: i.stage, channel: i.channel, subject: i.subject || "", body: i.body });

  return (
    <div className="space-y-6">
      <Card className="bg-card border-border shadow-sm">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-[#b48c3c]/10 rounded-lg flex items-center justify-center text-[#b48c3c]"><Route className="h-5 w-5" /></div>
            <div>
              <CardTitle className="text-xl text-foreground">Nurture</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">Staff approve the content, and each builder&apos;s journey sends it. Replies go to the AI agent.</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5" role="tablist">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${tab === t ? "border-[#b48c3c] bg-[#b48c3c]/10 text-[#b48c3c]" : "border-border text-muted-foreground hover:text-foreground"}`}
              >
                {t}{t === "Review" && review.length ? ` (${review.length})` : ""}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-4 md:p-6">
          {!items ? (
            <Loader2 className="mx-auto my-12 h-5 w-5 animate-spin text-muted-foreground" />
          ) : tab === "Review" ? (
            <div className="space-y-5">
              <div className="space-y-2 rounded-lg border border-border p-4">
                <Label htmlFor="batch-focus" className="text-xs">What should this batch be about? (optional)</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input id="batch-focus" value={focus} maxLength={500} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. answering buyer inquiries after hours. Leave empty for a general mix" className="h-9 text-sm" />
                  <Button className="shrink-0 gap-1.5 bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" disabled={generating} onClick={generate}>
                    {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {generating ? "Writing…" : "Generate 10"}
                  </Button>
                  <Button variant="outline" className="shrink-0 gap-1.5" onClick={() => setDraft(newDraft())}><Plus className="h-4 w-4" /> Write one</Button>
                </div>
                {activeSources.length > 0 ? (
                  <div className="space-y-1.5 pt-1">
                    <p className="text-xs font-medium">Sources for this batch</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {activeSources.map((s) => (
                        <label key={s.id} className="flex items-center gap-1.5 text-xs">
                          <input type="checkbox" checked={!unticked.has(s.id)} onChange={() => setUnticked((prev) => { const next = new Set(prev); if (next.has(s.id)) next.delete(s.id); else next.add(s.id); return next; })} />
                          {s.title}
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
                <p className="text-xs text-muted-foreground">About AI4HB pieces use the product guide and the B2B knowledge base in Prompt Lab. AI and Homebuilding pieces use the sources you tick. With none ticked, the AI writes only About AI4HB pieces.</p>
              </div>

              {review.length > 0 && testInputs}
              {review.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{review.length} waiting for review</p>
                  <Button variant="outline" size="sm" className="gap-1.5" disabled={!!busy || !review.some((i) => !i.warning)} onClick={approveClean}>
                    <Check className="h-3.5 w-3.5" /> Approve next 10 without warnings
                  </Button>
                </div>
              )}
              {review.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Nothing to review. Generate a batch to get started.</p>
              ) : (
                <ul className="space-y-3">
                  {review.map((item) => (
                    <li key={item.id} className="space-y-2 rounded-lg border border-border p-4">
                      <PieceTags item={item} />
                      {item.subject && <p className="text-sm font-semibold">{item.subject}</p>}
                      <p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.body}</p>
                      {item.warning && <p className="flex items-center gap-1.5 text-xs font-medium text-amber-600"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {item.warning}</p>}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button size="sm" className="gap-1.5 bg-[#0F3B3D] text-white hover:bg-[#0F3B3D]/90" disabled={!!busy} onClick={() => decide(item, "approve")}><Check className="h-3.5 w-3.5" /> Approve</Button>
                        <Button size="sm" variant="outline" className="gap-1.5" disabled={!!busy} onClick={() => edit(item)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                        <Button size="sm" variant="outline" className="gap-1.5" disabled={!!busy} onClick={() => rewrite(item)}>{busy === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Rewrite with AI</Button>
                        <Button size="sm" variant="outline" className="gap-1.5 text-red-500" disabled={!!busy} onClick={() => decide(item, "reject")}><X className="h-3.5 w-3.5" /> Reject</Button>
                        {testButton(item)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {rejected.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Rejected ({rejected.length})</p>
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {rejected.map((item) => (
                      <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.subject || item.body}</span>
                        <span className="flex gap-1.5">
                          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => rewrite(item)}>Rewrite with AI</Button>
                          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => edit(item)}>Edit</Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" aria-label="Delete piece" onClick={() => remove(item)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : tab === "Library" ? (
            library.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Approved pieces appear here. The journey can only send what&apos;s in this list.</p>
            ) : (
              <div className="space-y-3">
              {testInputs}
              <p className="text-xs text-muted-foreground">Send order sets the sequence inside each stage, category and channel. Lower numbers go first, and pieces with no number go after them.</p>
              <ul className="space-y-3">
                {library.map((item) => (
                  <li key={item.id} className={`space-y-2 rounded-lg border border-border p-4 ${item.status === "RETIRED" ? "opacity-60" : ""}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <PieceTags item={item} />
                      <span className="flex items-center gap-3 text-xs text-muted-foreground">
                        {item.status === "APPROVED" && (
                          <label className="flex items-center gap-1.5">
                            Send order
                            <Input key={item.sendOrder ?? "none"} type="number" min={1} max={9999} defaultValue={item.sendOrder ?? ""} onBlur={(e) => setOrder(item, e.target.value)} aria-label={`Send order for ${item.subject || "this text"}`} className="h-7 w-16 text-xs" />
                          </label>
                        )}
                        {item.status === "RETIRED" ? "Retired" : `Approved${item.reviewedBy ? ` by ${item.reviewedBy}` : ""}`}
                      </span>
                    </div>
                    {item.subject && <p className="text-sm font-semibold">{item.subject}</p>}
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.body}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => edit(item)}>Edit</Button>
                      {item.status === "APPROVED"
                        ? <Button size="sm" variant="outline" disabled={!!busy} onClick={() => decide(item, "retire")}>Retire</Button>
                        : <Button size="sm" variant="outline" disabled={!!busy} onClick={() => decide(item, "draft")}>Back to review</Button>}
                      {item.status === "APPROVED" && testButton(item)}
                    </div>
                  </li>
                ))}
              </ul>
              </div>
            )
          ) : tab === "Sources" ? (
            <SourcesTab />
          ) : tab === "Journey" ? (
            <JourneyTab />
          ) : (
            <KpiTab />
          )}
        </CardContent>
      </Card>

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit piece" : "Write a piece"}</DialogTitle>
            <DialogDescription>It goes out word for word once approved. Placeholders: {"{{firstName}} {{companyName}} {{city}} {{bookingLink}}"}</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Category</Label>
                  <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v as Category })}>
                    <SelectTrigger className="h-9" aria-label="Category"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(CATEGORIES).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Stage</Label>
                  <Select value={draft.stage} onValueChange={(v) => setDraft({ ...draft, stage: v as ContentStage })}>
                    <SelectTrigger className="h-9" aria-label="Stage"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(CONTENT_STAGES).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Channel</Label>
                  <Select value={draft.channel} onValueChange={(v) => setDraft({ ...draft, channel: v as "EMAIL" | "SMS" })}>
                    <SelectTrigger className="h-9" aria-label="Channel"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="EMAIL">Email</SelectItem><SelectItem value="SMS">SMS</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              {draft.channel === "EMAIL" && (
                <div className="space-y-1.5">
                  <Label htmlFor="piece-subject" className="text-xs">Subject</Label>
                  <Input id="piece-subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} className="h-9 text-sm" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="piece-body" className="text-xs">Message</Label>
                <Textarea id="piece-body" rows={draft.channel === "SMS" ? 3 : 8} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className="text-sm" />
                {draft.channel === "SMS" && <p className="text-[11px] text-muted-foreground">{draft.body.length} characters. The sender name and opt-out line are added automatically.</p>}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" onClick={save}>Save for review</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SourcesTab() {
  const confirm = useConfirm();
  const [sources, setSources] = useState<Source[] | null>(null);
  const [form, setForm] = useState<Partial<Source> | null>(null);
  const [method, setMethod] = useState<"file" | "link" | "paste">("file");
  const [link, setLink] = useState("");
  const [reading, setReading] = useState(false);

  const load = useCallback(async () => setSources(await apiFetch<Source[]>(`${API}/sources`)), []);
  useEffect(() => {
    apiFetch<Source[]>(`${API}/sources`).then(setSources).catch((e) => toast.error(errorMessage(e)));
  }, []);

  const fill = (out: { title: string; text: string; url?: string; truncated?: boolean }) => {
    setForm((f) => ({ ...f, title: f?.title || out.title, text: out.text, url: out.url ?? f?.url ?? "" }));
    toast[out.truncated ? "warning" : "success"](out.truncated ? "This is very long, so only the first part was kept. Check the text below." : "Text read. Check it below before saving.");
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      fill(await apiFetch(`${API}/sources/extract-file`, { method: "POST", body }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setReading(false);
    }
  };

  const readLink = async () => {
    setReading(true);
    try {
      fill(await sendJson<{ title: string; text: string; url: string; truncated: boolean }>(`${API}/sources/extract-url`, "POST", { url: link }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setReading(false);
    }
  };

  const openNew = () => {
    setMethod("file");
    setLink("");
    setForm({ title: "", url: "", text: "", active: true });
  };

  const save = async () => {
    if (!form) return;
    try {
      await sendJson(form.id ? `${API}/sources/${form.id}` : `${API}/sources`, form.id ? "PUT" : "POST", form);
      toast.success("Source saved.");
      setForm(null);
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const remove = async (source: Source) => {
    if (!(await confirm({ title: `Delete "${source.title}"?`, description: "Pieces already written from it stay as they are.", confirmText: "Delete" }))) return;
    await sendJson(`${API}/sources/${source.id}`, "DELETE").catch((e) => toast.error(errorMessage(e)));
    await load();
  };

  if (!sources) return <Loader2 className="mx-auto my-12 h-5 w-5 animate-spin text-muted-foreground" />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">Articles and documents your team trusts. The AI writes AI and Homebuilding pieces only from these, so it doesn&apos;t invent facts. Upload a file, add a link, or paste text.</p>
        <Button size="sm" className="gap-1.5 bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" onClick={openNew}><Plus className="h-3.5 w-3.5" /> Add source</Button>
      </div>
      {sources.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No sources yet, so batches will contain only About AI4HB pieces.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {sources.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.title}{!s.active && <span className="ml-2 text-xs font-normal text-muted-foreground">Not in use</span>}</p>
                <p className="truncate text-xs text-muted-foreground">{s.url || `${s.text.length.toLocaleString()} characters`}</p>
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" onClick={() => setForm(s)}>Edit</Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" aria-label={`Delete ${s.title}`} onClick={() => remove(s)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!form} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>{form?.id ? "Edit source" : "Add source"}</DialogTitle><DialogDescription>The AI writes messages to builders from the text below, so only add material that&apos;s safe to share with them. Check it before saving.</DialogDescription></DialogHeader>
          {form && (
            <div className="space-y-3">
              {!form.id && (
                <div className="space-y-2">
                  <div className="inline-flex gap-1 rounded-md bg-muted p-1" role="tablist" aria-label="How to add this source">
                    {([["file", "Upload a file", FileUp], ["link", "Add a link", Link2], ["paste", "Paste text", Pencil]] as const).map(([id, label, Icon]) => (
                      <button key={id} type="button" role="tab" aria-selected={method === id} onClick={() => setMethod(id)} className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium ${method === id ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                        <Icon className="h-3.5 w-3.5" /> {label}
                      </button>
                    ))}
                  </div>
                  {method === "file" && (
                    <div className="space-y-1">
                      <Input id="source-file" type="file" accept=".pdf,.docx,.xlsx,.txt,.csv" disabled={reading} onChange={(e) => readFile(e.target.files?.[0])} aria-label="Choose a file" className="text-sm" />
                      <p className="text-[11px] text-muted-foreground">PDF, Word (.docx), Excel (.xlsx), CSV or TXT, up to 25 MB. Scanned PDFs have no text to read.</p>
                    </div>
                  )}
                  {method === "link" && (
                    <div className="flex gap-2">
                      <Input type="url" aria-label="Article link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" className="h-9 text-sm" />
                      <Button type="button" variant="outline" className="shrink-0" disabled={reading || !link.trim()} onClick={readLink}>Read link</Button>
                    </div>
                  )}
                  {reading && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading…</p>}
                </div>
              )}
              <div className="space-y-1.5"><Label htmlFor="source-title" className="text-xs">Title</Label><Input id="source-title" value={form.title || ""} onChange={(e) => setForm({ ...form, title: e.target.value })} className="h-9 text-sm" /></div>
              <div className="space-y-1.5"><Label htmlFor="source-url" className="text-xs">Link (optional, for your reference)</Label><Input id="source-url" type="url" value={form.url || ""} onChange={(e) => setForm({ ...form, url: e.target.value })} className="h-9 text-sm" /></div>
              <div className="space-y-1.5"><Label htmlFor="source-text" className="text-xs">Text the AI will use{form.text ? ` (${form.text.length.toLocaleString()} characters)` : ""}</Label><Textarea id="source-text" value={form.text || ""} onChange={(e) => setForm({ ...form, text: e.target.value })} className="field-sizing-fixed h-52 resize-y overflow-y-auto text-sm" /></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active !== false} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Show in Generate 10 (untick to keep it without using it)</label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" onClick={save}>Save source</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function JourneyTab() {
  const [journey, setJourney] = useState<Journey | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [stageFilter, setStageFilter] = useState("ALL");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [j, s] = await Promise.all([apiFetch<Journey>(`${API}/journey`), apiFetch<Settings>(`${API}/settings`)]);
    setJourney(j);
    setSettings(s);
  }, []);
  useEffect(() => {
    Promise.all([apiFetch<Journey>(`${API}/journey`), apiFetch<Settings>(`${API}/settings`)])
      .then(([j, s]) => { setJourney(j); setSettings(s); })
      .catch((e) => toast.error(errorMessage(e)));
  }, []);

  const gaps = useMemo(() => {
    if (!journey) return [];
    return Object.entries(CONTENT_STAGES)
      .filter(([stage]) => !journey.approved.some((a) => a.stage === stage && a.channel === "EMAIL"))
      .map(([, label]) => label);
  }, [journey]);

  const join = async () => {
    try {
      const r = await sendJson<{ joined: number; skipped: number }>(`${API}/journey/join`, "POST", { leadIds: [...picked] });
      toast.success(`Added ${r.joined} lead${r.joined === 1 ? "" : "s"}${r.skipped ? `, skipped ${r.skipped}` : ""}.`);
      setPicked(new Set());
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const removeLead = async (id: string) => {
    try {
      await sendJson(`${API}/journey/remove`, "POST", { leadIds: [id] });
      toast.success("Removed from the journey.");
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const sendNow = async (id: string) => {
    setSending(id);
    try {
      const out = await sendJson<{ message: string }>(`${API}/journey/${id}/send-now`, "POST");
      toast.success(out.message);
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSending(null);
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      setSettings(await sendJson<Settings>(`${API}/settings`, "PUT", settings));
      toast.success("Settings saved. They apply from each lead's next scheduled step.");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (!journey || !settings) return <Loader2 className="mx-auto my-12 h-5 w-5 animate-spin text-muted-foreground" />;
  const days = settings.sendDays.split(",");
  const shown = journey.leads.filter((l) => stageFilter === "ALL" || l.journeyStage === stageFilter);

  return (
    <div className="space-y-6">
      {gaps.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          No approved email for: {gaps.join(", ")}. Builders in those stages wait until staff approve some.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {journey.stages.map((s) => (
          <button key={s.stage} type="button" onClick={() => setStageFilter(stageFilter === s.stage ? "ALL" : s.stage)} className={`rounded-lg border p-3 text-left transition ${stageFilter === s.stage ? "border-[#b48c3c] bg-[#b48c3c]/10" : "border-border hover:border-[#b48c3c]/50"}`}>
            <span className="block text-xl font-semibold tabular-nums">{s.count}</span>
            <span className="text-xs text-muted-foreground">{STAGE_LABELS[s.stage]}</span>
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Builders in the journey{stageFilter !== "ALL" ? `: ${STAGE_LABELS[stageFilter]}` : ""}</h3>
        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No builders here yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {shown.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{l.companyName}</p>
                  <p className="text-xs text-muted-foreground">
                    {STAGE_LABELS[l.journeyStage]} · Next step: {when(l.journeyNextAt)}
                    {l.journeyHoldReason && <span className="text-amber-600"> · {l.journeyHoldReason}</span>}
                  </p>
                </div>
                <span className="flex gap-1.5">
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={!!sending} onClick={() => sendNow(l.id)}>
                    {sending === l.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Send next step now
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => removeLead(l.id)}>Remove</Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Add builders</h3>
          <Button size="sm" className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" disabled={!picked.size} onClick={join}>Add {picked.size || ""} to journey</Button>
        </div>
        <p className="text-xs text-muted-foreground">Website leads with marketing consent join by themselves. Add CSV and manual leads here. Leads who opted out of email or are Signed or Lost aren&apos;t listed.</p>
        {journey.available.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No leads to add.</p>
        ) : (
          <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
            {journey.available.map((l) => (
              <li key={l.id}>
                <label className="flex items-center gap-2 px-3 py-2">
                  <input type="checkbox" checked={picked.has(l.id)} onChange={() => setPicked((prev) => { const next = new Set(prev); if (next.has(l.id)) next.delete(l.id); else next.add(l.id); return next; })} />
                  <span className="min-w-0 flex-1 truncate"><span className="font-medium">{l.companyName}</span> <span className="text-xs text-muted-foreground">{l.email}</span></span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold">Frequency and timing</h3>
        <p className="text-xs text-muted-foreground">Starting points to test. Times are on each lead&apos;s clock. The weekly limits also apply to manual campaigns.</p>
        <div className="flex flex-wrap gap-1.5">
          {WEEK_DAYS.map((d) => (
            <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => setSettings({ ...settings, sendDays: WEEK_DAYS.filter((x) => (x === d ? !days.includes(d) : days.includes(x))).join(",") })} className={`rounded-md border px-3 py-1 text-xs font-medium ${days.includes(d) ? "border-[#b48c3c] bg-[#b48c3c]/10 text-[#b48c3c]" : "border-border text-muted-foreground"}`}>{d}</button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          {(["emailTime", "smsTime"] as const).map((key) => (
            <div key={key} className="space-y-1.5">
              <Label className="text-xs">{key === "emailTime" ? "Email time" : "SMS time"}</Label>
              <Select value={settings[key]} onValueChange={(v) => setSettings({ ...settings, [key]: v })}>
                <SelectTrigger className="h-9" aria-label={key === "emailTime" ? "Email time" : "SMS time"}><SelectValue /></SelectTrigger>
                <SelectContent>{SEND_TIMES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ))}
          <div className="space-y-1.5"><Label htmlFor="cap-email" className="text-xs">Emails per week</Label><Input id="cap-email" type="number" min={0} max={14} value={settings.emailsPerWeek} onChange={(e) => setSettings({ ...settings, emailsPerWeek: Number(e.target.value) })} className="h-9 text-sm" /></div>
          <div className="space-y-1.5"><Label htmlFor="cap-sms" className="text-xs">SMS per week</Label><Input id="cap-sms" type="number" min={0} max={14} value={settings.smsPerWeek} onChange={(e) => setSettings({ ...settings, smsPerWeek: Number(e.target.value) })} className="h-9 text-sm" /></div>
        </div>
        <Button size="sm" className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" disabled={saving} onClick={saveSettings}>Save settings</Button>
      </div>
    </div>
  );
}

function KpiTab() {
  const [days, setDays] = useState(30);
  const [kpis, setKpis] = useState<Kpis | null>(null);

  useEffect(() => {
    let live = true;
    apiFetch<Kpis>(`${API}/kpis?days=${days}`).then((k) => { if (live) setKpis(k); }).catch((e) => toast.error(errorMessage(e)));
    return () => { live = false; };
  }, [days]);

  if (!kpis) return <Loader2 className="mx-auto my-12 h-5 w-5 animate-spin text-muted-foreground" />;
  const row = (label: string, t: Totals, showOpens: boolean) => (
    <tr key={label} className="border-t border-border">
      <td className="px-3 py-2 font-medium">{label}</td>
      <td className="px-3 py-2 tabular-nums">{t.sent}</td>
      <td className="px-3 py-2 tabular-nums">{t.delivered} ({rate(t.delivered, t.sent)})</td>
      <td className="px-3 py-2 tabular-nums">{showOpens ? `${t.opened} (${rate(t.opened, t.delivered)})` : "Not available"}</td>
      <td className="px-3 py-2 tabular-nums">{t.clicked} ({rate(t.clicked, t.delivered)})</td>
      <td className="px-3 py-2 tabular-nums">{t.failed}</td>
    </tr>
  );
  const facts: [string, number][] = [
    ["Replies from builders", kpis.replies],
    ["AI replies sent", kpis.agentReplies],
    ["Meetings booked", kpis.meetings.CONFIRMED || 0],
    ["Meetings held", kpis.meetings.COMPLETED || 0],
    ["No-shows", kpis.meetings.NO_SHOW || 0],
    ["Email opt-outs", kpis.optOuts.email],
    ["SMS opt-outs", kpis.optOuts.sms],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1.5">
        {[7, 30, 90].map((d) => (
          <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={`rounded-md border px-3 py-1 text-xs font-medium ${days === d ? "border-[#b48c3c] bg-[#b48c3c]/10 text-[#b48c3c]" : "border-border text-muted-foreground"}`}>Last {d} days</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {facts.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border p-3"><span className="block text-xl font-semibold tabular-nums">{value}</span><span className="text-xs text-muted-foreground">{label}</span></div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-140 text-left text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground"><tr>{["Channel", "Sent", "Delivered", "Opened", "Clicked", "Failed"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>{row("Email", kpis.email, true)}{row("SMS", kpis.sms, false)}</tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Opens are approximate because some mail apps load images automatically. Texts can&apos;t report opens. An SMS click means the booking page was opened from that text.</p>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Results by piece of content</h3>
        {kpis.pieces.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Results appear once the journey sends approved pieces.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-160 text-left text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground"><tr>{["Piece", "Stage", "Sent", "Opened", "Clicked", "Failed"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {kpis.pieces.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="max-w-xs truncate px-3 py-2">{p.label}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{CONTENT_STAGES[p.stage]}</td>
                    <td className="px-3 py-2 tabular-nums">{p.sent}</td>
                    <td className="px-3 py-2 tabular-nums">{p.channel === "SMS" ? "–" : p.opened}</td>
                    <td className="px-3 py-2 tabular-nums">{p.clicked}</td>
                    <td className="px-3 py-2 tabular-nums">{p.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
