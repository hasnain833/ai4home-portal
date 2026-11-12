"use client";

import { createPortal } from "react-dom";
import LiveStatus from "@/components/admin/prompt-lab/LiveStatus";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Check, ChevronRight, Copy, Eye, FlaskConical, Loader2, MessagesSquare, Radio, RotateCcw, Save, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, errorMessage } from "@/lib/api";
import KnowledgeBasePanel from "@/components/admin/prompt-lab/KnowledgeBasePanel";

const API = "/api/admin/b2b-prompt-lab";

type Draft = { systemTemplate: string; toolDescription: string; kbEmptyText: string };
type Version = Draft & {
  id: string;
  label: string | null;
  isActive: boolean;
  isLive: boolean;
  setLiveAt: string | null;
  setLiveByName: string | null;
  createdByName: string | null;
  createdAt: string;
};
type LabData = {
  defaults: Draft;
  livePrompts: Draft;
  versions: Version[];
  currentDraft: Version | null;
  live: { source: "code-default" | "live-version"; versionId: string | null; label: string | null; setLiveAt: string | null; setLiveByName: string | null };
};
type ChatReply = { action: string; message: string; summary: string; slotLabel: string | null; sources: string[]; blockedBecause: string | null };
type Turn = { role: "user" | "agent"; content: string } & Partial<Omit<ChatReply, "message">>;
type Props = {
  /** Header element the live-status pill is rendered into. */
  liveSlot: HTMLElement | null;
  onMetaChange: (meta: { edited: boolean; versions: number }) => void;
  historyOpen: boolean;
  onHistoryOpenChange: (open: boolean) => void;
};

const EMPTY_DRAFT: Draft = { systemTemplate: "", toolDescription: "", kbEmptyText: "" };
const ACTION_LABELS: Record<string, string> = { reply: "Reply", book: "Book meeting", handoff: "Hand off to a person", not_interested: "Not interested" };
const post = <T,>(path: string, body: object = {}) =>
  apiFetch<T>(`${API}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const pickDraft = ({ systemTemplate, toolDescription, kbEmptyText }: Draft): Draft => ({ systemTemplate, toolDescription, kbEmptyText });

function PromptSection({ title, hint, value, onChange, height }: { title: string; hint: string; value: string; onChange: (value: string) => void; height: string }) {
  return (
    <details className="group shrink-0 rounded-lg border border-border">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-semibold [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
        {title}
        <span className="font-normal text-muted-foreground">— {hint}</span>
      </summary>
      <div className="px-3 pb-3">
        <Textarea aria-label={title} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} className={`${height} resize-none field-sizing-fixed font-mono text-xs leading-relaxed`} />
      </div>
    </details>
  );
}

export default function B2BAgentLab({ liveSlot, onMetaChange, historyOpen, onHistoryOpenChange }: Props) {
  const confirm = useConfirm();
  const [data, setData] = useState<LabData | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [tab, setTab] = useState<"prompt" | "kb">("prompt");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [leadName, setLeadName] = useState("Dana Cole");
  const [companyName, setCompanyName] = useState("Ridge Homes");
  const chatRef = useRef<HTMLDivElement>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const result = await apiFetch<LabData>(API);
    setData(result);
    return result;
  }, []);

  useEffect(() => {
    let active = true;
    apiFetch<LabData>(API)
      .then((result) => {
        if (!active) return;
        setData(result);
        setDraft(pickDraft(result.currentDraft || result.livePrompts));
      })
      .catch((e) => toast.error(errorMessage(e)));
    return () => { active = false; };
  }, []);

  const edited = !!data && (Object.keys(EMPTY_DRAFT) as (keyof Draft)[]).some((key) => draft[key] !== data.defaults[key]);
  const versionCount = data?.versions.length ?? 0;
  useEffect(() => { onMetaChange({ edited, versions: versionCount }); }, [edited, versionCount, onMetaChange]);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, sending]);

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const saveVersion = () => run(async () => {
    const out = await post<{ warnings: string[] }>("/versions", { ...draft, label });
    setLabel("");
    await load();
    out.warnings.forEach((w) => toast.warning(w));
  }, "Saved. Real leads keep the live prompt until you set this one live.");

  const setLive = async (version: Version) => {
    const ok = await confirm({
      title: `Put "${version.label || "this version"}" live?`,
      description: "The agent replies to real builders with no review, and it will use this prompt within about 30 seconds.",
      confirmText: "Set live",
      destructive: false,
    });
    if (!ok) return;
    await run(async () => {
      await post(`/versions/${version.id}/set-live`, { acknowledgeWarnings: true });
      await load();
      onHistoryOpenChange(false);
    }, "Prompt is live.");
  };

  const revert = async () => {
    const ok = await confirm({
      title: "Go back to the shipped prompt?",
      description: "Real leads will get the prompt that ships in code. Your saved versions stay in History.",
      confirmText: "Revert",
    });
    if (ok) await run(async () => { await post("/revert-to-defaults"); await load(); }, "Reverted to the shipped prompt.");
  };

  const openVersion = (version: Version) => run(async () => {
    await post(`/versions/${version.id}/set-current`);
    setDraft(pickDraft(version));
    await load();
    onHistoryOpenChange(false);
  });

  const deleteVersion = async (version: Version) => {
    const ok = await confirm({ title: `Delete "${version.label || "this version"}"?`, description: "This can't be undone.", confirmText: "Delete" });
    if (ok) await run(async () => { await apiFetch(`${API}/versions/${version.id}`, { method: "DELETE" }); await load(); });
  };

  const testContext = { leadName, companyName };

  const openPreview = () => run(async () => {
    const out = await post<{ prompt: string }>("/preview", { ...draft, ...testContext });
    setPreview(out.prompt);
  });

  const copyForRelease = async () => {
    try {
      await navigator.clipboard.writeText([
        "=== B2B_AGENT_SYSTEM ===", draft.systemTemplate, "",
        "=== B2B_AGENT_TOOL_DESCRIPTION ===", draft.toolDescription, "",
        "=== B2B_AGENT_KB_EMPTY_TEXT ===", draft.kbEmptyText,
      ].join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy to the clipboard.");
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const next: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(next);
    setInput("");
    setSending(true);
    try {
      const { message, ...details } = await post<ChatReply>("/chat", {
        ...draft,
        ...testContext,
        messages: next.map(({ role, content }) => ({ role, content })),
      });
      setTurns([...next, { role: "agent", content: message, ...details }]);
    } catch (e) {
      toast.error(errorMessage(e));
      setTurns(turns);
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  if (!data) {
    return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading</p>;
  }

  const { live } = data;

  return (
    <>
      {liveSlot && createPortal(
        <LiveStatus live={live} busy={busy} onRevert={revert} onChooseVersion={() => onHistoryOpenChange(true)} />,
        liveSlot,
      )}

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-2 xl:grid-rows-[minmax(0,1fr)]">
        <Card className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <CardHeader className="shrink-0 flex-row items-center justify-between space-y-0 py-3">
            <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
              {([["prompt", "Prompt", FlaskConical], ["kb", "Knowledge base", BookOpen]] as const).map(([key, title, Icon]) => (
                <button key={key} type="button" onClick={() => setTab(key)} className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${tab === key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                  <Icon className="h-3.5 w-3.5" /> {title}
                </button>
              ))}
            </div>
            {tab === "prompt" && (
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => { setDraft(pickDraft(data.livePrompts)); toast.success("Reset to the prompt running in production."); }}>
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-3">
            {tab === "kb" ? (
              <KnowledgeBasePanel agent="b2b" />
            ) : (
              <>
                <p className="shrink-0 text-[11px] text-muted-foreground">Lead details, open meeting times, knowledge-base passages and channel rules are added automatically. Prices and percentages that aren&apos;t in a knowledge-base document are always blocked.</p>
                <Textarea
                  aria-label="B2B sales agent system prompt"
                  value={draft.systemTemplate}
                  onChange={(e) => update({ systemTemplate: e.target.value })}
                  spellCheck={false}
                  className="min-h-64 flex-1 resize-none field-sizing-fixed font-mono text-xs leading-relaxed"
                />
                <PromptSection title="Booking & escalation rules" hint="when it books, hands off, or marks a lead not interested" value={draft.toolDescription} onChange={(toolDescription) => update({ toolDescription })} height="h-40" />
                <PromptSection title="When the knowledge base finds nothing" hint="used when no document matches the message" value={draft.kbEmptyText} onChange={(kbEmptyText) => update({ kbEmptyText })} height="h-28" />
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border pt-2.5">
                  <Input aria-label="Version name" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder="Name this version, e.g. softer pricing handoff" className="h-9 min-w-50 flex-1" />
                  <Button size="sm" className="h-9 gap-1.5" disabled={busy} onClick={saveVersion}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
                  </Button>
                  <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={copyForRelease}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copy for release
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <CardHeader className="shrink-0 space-y-1 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base"><MessagesSquare className="h-4 w-4" /> Test conversation</CardTitle>
              <div className="flex flex-wrap items-center gap-1.5">
                <Label htmlFor="b2b-lab-lead" className="text-xs text-muted-foreground">Lead</Label>
                <Input id="b2b-lab-lead" className="h-7 w-28 text-xs" value={leadName} maxLength={120} onChange={(e) => setLeadName(e.target.value)} />
                <Label htmlFor="b2b-lab-company" className="text-xs text-muted-foreground">Company</Label>
                <Input id="b2b-lab-company" className="h-7 w-28 text-xs" value={companyName} maxLength={120} onChange={(e) => setCompanyName(e.target.value)} />
                <Button variant="outline" size="sm" disabled={busy} onClick={openPreview} className="h-7 gap-1.5 text-xs">
                  <Eye className="h-3.5 w-3.5" /> Rendered prompt
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={!turns.length} onClick={() => setTurns([])}>Reset chat</Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Uses the prompt on the left, the product guide and the B2B knowledge base (other agents can&apos;t see these documents). Nothing is sent, booked or saved.</p>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-3">
            <div ref={chatRef} className="flex min-h-48 flex-1 flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3">
              {turns.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Send a message as a builder replying to your campaign.</p>}
              {turns.map((turn, i) => (
                <div key={i} className={turn.role === "user" ? "ml-auto w-fit max-w-[85%] rounded-lg bg-muted p-2.5 text-sm" : "mr-auto w-fit max-w-[90%] rounded-lg border border-[#b48c3c]/40 bg-[#b48c3c]/5 p-2.5 text-sm"}>
                  {turn.action && (
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px]">{ACTION_LABELS[turn.action] || turn.action}</Badge>
                      {turn.slotLabel && <span className="text-[11px] text-muted-foreground">{turn.slotLabel}</span>}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap wrap-break-word">{turn.content}</p>
                  {turn.blockedBecause && <p className="mt-1.5 text-xs font-medium text-red-600">Would be blocked and handed off: {turn.blockedBecause}.</p>}
                  {!!turn.sources?.length && <p className="mt-1.5 text-[11px] text-muted-foreground">Documents found: {turn.sources.join(", ")}</p>}
                  {turn.summary && <p className="mt-1 text-[11px] text-muted-foreground">Team note: {turn.summary}</p>}
                </div>
              ))}
              {sending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            <div className="flex shrink-0 gap-2">
              <Input
                aria-label="Message from the lead"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void send(); } }}
                placeholder="Type as a builder replying to your campaign..."
              />
              <Button className="shrink-0 gap-1.5" disabled={sending || !input.trim()} onClick={send}><Send className="h-3.5 w-3.5" /> Send</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={historyOpen} onOpenChange={onHistoryOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Prompt history</DialogTitle>
            <DialogDescription>Open a version to edit or test it, which doesn&apos;t change what real leads get. Only Set live does that.</DialogDescription>
          </DialogHeader>
          {data.versions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No saved versions yet. Save a prompt first, then set it live from here.</p>
          ) : (
            <ul className="space-y-2">
              {data.versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{v.label || "Untitled version"}</p>
                    <p className="text-xs text-muted-foreground">{new Date(v.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}{v.createdByName ? ` · ${v.createdByName}` : ""}</p>
                  </div>
                  {v.isLive && <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Live</Badge>}
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => openVersion(v)}>Open</Button>
                  {!v.isLive && <Button size="sm" className="gap-1.5 bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" disabled={busy} onClick={() => setLive(v)}><Radio className="h-3.5 w-3.5" /> Set live</Button>}
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:bg-red-500/10" aria-label={`Delete ${v.label || "version"}`} disabled={busy || v.isLive} onClick={() => deleteVersion(v)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Rendered prompt</DialogTitle>
            <DialogDescription>What the AI receives, with the test lead filled in.</DialogDescription>
          </DialogHeader>
          <pre className="whitespace-pre-wrap wrap-break-word rounded-md bg-muted p-3 text-xs">{preview}</pre>
        </DialogContent>
      </Dialog>
    </>
  );
}
