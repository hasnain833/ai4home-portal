"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2,
  Send,
  Save,
  RotateCcw,
  Copy,
  Check,
  Eye,
  ChevronRight,
  CalendarCheck,
  UserRoundSearch,
  BellOff,
  History,
  Trash2,
  FlaskConical,
  MessagesSquare,
  Radio,
  Undo2,
  BookOpen,
  Globe,
  Building2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirm } from "@/components/ui/confirm-dialog";
import KnowledgeBasePanel from "@/components/admin/prompt-lab/KnowledgeBasePanel";

type Draft = {
  systemTemplate: string;
  toolDescription: string;
  kbEmptyText: string;
};

type Placeholder = { token: string; required: boolean; description: string };

type PromptVersion = {
  id: string;
  label: string | null;
  notes: string | null;
  systemTemplate: string;
  toolDescription: string;
  kbEmptyText: string;
  isActive: boolean;
  isLive?: boolean;
  setLiveAt?: string | null;
  setLiveByName?: string | null;
  createdByName: string | null;
  createdAt: string;
};

/** What the running agent is using right now — not the same as the saved draft. */
type LiveState = {
  source: "code-default" | "live-version";
  versionId: string | null;
  label: string | null;
  setLiveAt: string | null;
  setLiveByName: string | null;
};

/** One passage retrieval handed the agent for a turn. */
type RetrievedChunk = {
  documentId: string;
  name: string;
  category: string;
  scope: "PLATFORM" | "COMPANY";
  score: number;
  excerpt: string;
  truncated: boolean;
};

type Diagnostics = {
  companyName: string;
  timezone: string;
  kbChunkCount: number;
  retrievalMethod: string | null;
  slotCount: number;
  latencyMs: number;
  characters: number;
};

type ChatMessage = {
  id: string;
  role: "user" | "agent";
  content: string;
  action?: "reply" | "book" | "escalate";
  slotIso?: string | null;
  handoffReason?: string | null;
  optout?: boolean;
  usedKb?: boolean | null;
  diagnostics?: Diagnostics;
  retrieved?: RetrievedChunk[];
};

const EMPTY_DRAFT: Draft = { systemTemplate: "", toolDescription: "", kbEmptyText: "" };

export default function PromptLabPage() {
  const { user } = useAuth();
  const confirm = useConfirm();

  const [loading, setLoading] = useState(true);
  const [defaults, setDefaults] = useState<Draft>(EMPTY_DRAFT);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [tableReady, setTableReady] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  const [leadFirstName, setLeadFirstName] = useState("Dana");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const [versionLabel, setVersionLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [live, setLive] = useState<LiveState | null>(null);
  const [settingLive, setSettingLive] = useState(false);
  const [tab, setTab] = useState<"prompt" | "kb">("prompt");

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewText, setPreviewText] = useState("");
  const [previewMeta, setPreviewMeta] = useState<Record<string, unknown> | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const systemRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const labRes = await fetch("/api/admin/prompt-lab");
      const lab = await labRes.json().catch(() => ({}));
      if (!labRes.ok) {
        toast.error(lab.message || "Could not load the prompt lab.");
        return;
      }
      setDefaults(lab.defaults);
      setPlaceholders(lab.placeholders || []);
      setVersions(lab.versions || []);
      setLive(lab.live || null);
      setTableReady(lab.tableReady !== false);
      // Pick up where the last session left off, otherwise the shipped prompt.
      setDraft(
        lab.currentDraft
          ? {
              systemTemplate: lab.currentDraft.systemTemplate,
              toolDescription: lab.currentDraft.toolDescription,
              kbEmptyText: lab.currentDraft.kbEmptyText,
            }
          : lab.defaults,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.isSuperAdmin) load();
  }, [user, load]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, sending]);

  const isDefault = useMemo(
    () =>
      draft.systemTemplate === defaults.systemTemplate &&
      draft.toolDescription === defaults.toolDescription &&
      draft.kbEmptyText === defaults.kbEmptyText,
    [draft, defaults],
  );

  const missingRequired = useMemo(
    () => placeholders.filter((p) => p.required && !draft.systemTemplate.includes(`{{${p.token}}}`)),
    [placeholders, draft.systemTemplate],
  );

  const updateDraft = (patch: Partial<Draft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setErrors([]);
  };

  const insertPlaceholder = (token: string) => {
    const el = systemRef.current;
    const snippet = `{{${token}}}`;
    if (!el) {
      updateDraft({ systemTemplate: draft.systemTemplate + snippet });
      return;
    }
    const start = el.selectionStart ?? draft.systemTemplate.length;
    const end = el.selectionEnd ?? start;
    const next = draft.systemTemplate.slice(0, start) + snippet + draft.systemTemplate.slice(end);
    updateDraft({ systemTemplate: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", content: text };
    const transcript = [...messages, userMsg];
    setMessages(transcript);
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/admin/prompt-lab/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft,
          leadFirstName,
          messages: transcript.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message || "The agent could not reply.");
        setMessages((prev) => prev.slice(0, -1));
        setInput(text);
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "agent",
          content: data.message || "",
          action: data.action,
          slotIso: data.slot_iso,
          handoffReason: data.handoff_reason,
          optout: data.optout_request,
          usedKb: data.used_kb,
          diagnostics: data.diagnostics,
          retrieved: data.retrieved || [],
        },
      ]);
    } catch {
      toast.error("Could not reach the agent.");
      setMessages((prev) => prev.slice(0, -1));
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  const openPreview = async () => {
    setPreviewLoading(true);
    setPreviewOpen(true);
    try {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const res = await fetch("/api/admin/prompt-lab/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft,
          leadFirstName,
          question: lastUser?.content || "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message || "Could not render the prompt.");
        setPreviewOpen(false);
        return;
      }
      setPreviewText(data.system || "");
      setPreviewMeta(data.context || null);
      setErrors(data.validation?.errors || []);
      setWarnings(data.validation?.warnings || []);
    } finally {
      setPreviewLoading(false);
    }
  };

  const saveVersion = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/prompt-lab/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, label: versionLabel }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrors(data.errors || [data.message || "Could not save."]);
        setWarnings(data.warnings || []);
        toast.error(data.message || "Could not save this version.");
        return;
      }
      setErrors([]);
      setWarnings(data.warnings || []);
      setVersionLabel("");
      toast.success("Version saved.");
      if (data.warnings?.length) {
        toast.warning(`Saved with ${data.warnings.length} warning(s) — check the editor.`);
      }
      await load();
    } finally {
      setSaving(false);
    }
  };

  const loadVersion = (v: PromptVersion) => {
    setDraft({
      systemTemplate: v.systemTemplate,
      toolDescription: v.toolDescription,
      kbEmptyText: v.kbEmptyText,
    });
    setErrors([]);
    setWarnings([]);
    setHistoryOpen(false);
    toast.success(`Loaded ${v.label || "version"} into the editor.`);
  };

  const setCurrentVersion = async (v: PromptVersion) => {
    const res = await fetch(`/api/admin/prompt-lab/versions/${v.id}/set-current`, { method: "POST" });
    if (!res.ok) {
      toast.error("Could not set that version as current.");
      return;
    }
    toast.success("Set as the current draft.");
    await load();
  };

  /**
   * Puts a saved version in front of real leads.
   *
   * The server refuses versions that fail validation outright, and returns 409
   * when there are warnings — that is the confirm step, not an error.
   */
  const setVersionLive = async (v: PromptVersion, acknowledgeWarnings = false) => {
    setSettingLive(true);
    try {
      const res = await fetch(`/api/admin/prompt-lab/versions/${v.id}/set-live`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledgeWarnings }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409 && data.needsAcknowledgement) {
        const ok = await confirm({
          title: "Put this version live with warnings?",
          description: (
            <div className="space-y-1.5">
              <p>This prompt goes live with the following warnings:</p>
              <ul className="list-disc space-y-0.5 pl-4">
                {((data.warnings || []) as string[]).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              <p>Real leads will start seeing it immediately.</p>
            </div>
          ),
          confirmText: "Set live anyway",
          destructive: true,
        });
        if (ok) await setVersionLive(v, true);
        return;
      }
      if (!res.ok) {
        toast.error(data.message || "Could not put that version live.");
        if (data.errors?.length) setErrors(data.errors);
        return;
      }

      toast.success(`"${v.label || "Version"}" is now live. New conversations use it immediately.`);
      setHistoryOpen(false);
      await load();
    } finally {
      setSettingLive(false);
    }
  };

  const revertToDefaults = async () => {
    const ok = await confirm({
      title: "Revert to the code defaults?",
      description:
        "The live agent stops using the saved version and goes back to the prompt that ships in code. New conversations change immediately.",
      confirmText: "Revert",
    });
    if (!ok) return;
    setSettingLive(true);
    try {
      const res = await fetch("/api/admin/prompt-lab/revert-to-defaults", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message || "Could not revert.");
        return;
      }
      toast.success(data.message || "Reverted to the code defaults.");
      await load();
    } finally {
      setSettingLive(false);
    }
  };

  const deleteVersion = async (v: PromptVersion) => {
    const res = await fetch(`/api/admin/prompt-lab/versions/${v.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Could not delete that version.");
      return;
    }
    toast.success("Version deleted.");
    await load();
  };

  const copyForHandoff = async () => {
    const payload = [
      "=== DEFAULT_SYSTEM_TEMPLATE ===",
      draft.systemTemplate,
      "",
      "=== DEFAULT_TOOL_DESCRIPTION ===",
      draft.toolDescription,
      "",
      "=== DEFAULT_KB_EMPTY_TEXT ===",
      draft.kbEmptyText,
    ].join("\n");
    await navigator.clipboard.writeText(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success(
      "Copied — paste into server/src/prompts/sales-agent.js to change the shipped default. " +
        "To run it now without a deploy, save it and use Set live instead.",
    );
  };

  if (!user?.isSuperAdmin) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        This page is restricted to platform super admins.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#b48c3c]" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-150 flex-col gap-3">
      {/* Heading */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <FlaskConical className="h-5 w-5 text-[#b48c3c]" />
          Prompt Lab
        </h1>
        <div className="flex items-center gap-2">
          {isDefault ? (
            <Badge variant="secondary">Matches shipped prompt</Badge>
          ) : (
            <Badge className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]">Edited</Badge>
          )}
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setHistoryOpen(true)}>
            <History className="h-4 w-4" /> History
            {versions.length > 0 && <span className="text-muted-foreground">({versions.length})</span>}
          </Button>
        </div>
        <p className="w-full text-xs text-muted-foreground">
          Edit the prompt, add knowledge-base documents, and talk to the agent. Saving keeps a draft
          for testing; only <strong>Set live</strong> puts a prompt in front of real leads.
        </p>
      </div>

      {/* What the running agent is actually using. */}
      <div
        className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-xs ${
          live?.source === "live-version"
            ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
            : "border-border bg-muted/40 text-muted-foreground"
        }`}
      >
        <span className="flex items-center gap-1.5 font-semibold">
          <Radio className="h-3.5 w-3.5" />
          Live agent
        </span>
        {live?.source === "live-version" ? (
          <span>
            running <strong>{live.label || "an unlabelled version"}</strong>
            {live.setLiveByName && ` — set live by ${live.setLiveByName}`}
            {live.setLiveAt && ` on ${new Date(live.setLiveAt).toLocaleDateString()}`}
          </span>
        ) : (
          <span>running the prompt that ships in code. No lab version has been set live.</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {live?.source === "live-version" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              disabled={settingLive}
              onClick={revertToDefaults}
            >
              <Undo2 className="h-3.5 w-3.5" /> Revert to code
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setHistoryOpen(true)}
          >
            Choose a version to set live
          </Button>
        </div>
      </div>

      {/* Test context */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
        <div className="w-35">
          <Label className="text-[11px] font-semibold text-muted-foreground">Lead name</Label>
          <Input
            className="mt-0.5 h-9"
            value={leadFirstName}
            onChange={(e) => setLeadFirstName(e.target.value)}
            placeholder="Dana"
          />
        </div>
        <p className="flex-1 text-[11px] text-muted-foreground">
          Answers are grounded in the <strong>platform knowledge base</strong> — the documents on
          the Knowledge base tab. No single company&apos;s own KB is used here.
        </p>
        <Button variant="outline" size="sm" onClick={openPreview} className="h-9 gap-1.5">
          <Eye className="h-4 w-4" /> Rendered prompt
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-2">
        {/* Prompt */}
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <CardHeader className="shrink-0 flex-row items-center justify-between space-y-0 py-3">
            <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
              <button
                type="button"
                onClick={() => setTab("prompt")}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  tab === "prompt" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <FlaskConical className="h-3.5 w-3.5" /> Prompt
              </button>
              <button
                type="button"
                onClick={() => setTab("kb")}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  tab === "kb" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <BookOpen className="h-3.5 w-3.5" /> Knowledge base
              </button>
            </div>
            <div className={`flex items-center gap-1.5 ${tab === "kb" ? "hidden" : ""}`}>
              {missingRequired.length > 0 && (
                <span className="text-[11px] font-medium text-destructive">
                  {missingRequired.length} required placeholder
                  {missingRequired.length === 1 ? "" : "s"} missing
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setDraft(defaults);
                  setErrors([]);
                  setWarnings([]);
                  toast.success("Reset to the prompt running in production.");
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-2 pb-3">
            {tab === "kb" ? (
              <KnowledgeBasePanel agent="sales" />
            ) : (
              <>
            <div className="flex flex-wrap gap-1">
              {placeholders.map((p) => {
                const present = draft.systemTemplate.includes(`{{${p.token}}}`);
                return (
                  <button
                    key={p.token}
                    type="button"
                    title={`${p.description}${present ? "" : " — currently missing from the prompt"}`}
                    onClick={() => insertPlaceholder(p.token)}
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors hover:bg-accent ${
                      present
                        ? "border-border text-muted-foreground"
                        : p.required
                          ? "border-destructive/60 text-destructive"
                          : "border-amber-500/50 text-amber-600 dark:text-amber-400"
                    }`}
                  >
                    {`{{${p.token}}}`}
                    {p.required ? "*" : ""}
                  </button>
                );
              })}
              <span className="self-center pl-1 text-[10px] text-muted-foreground">
                click to insert · * must stay in the prompt
              </span>
            </div>

            <Textarea
              ref={systemRef}
              value={draft.systemTemplate}
              onChange={(e) => updateDraft({ systemTemplate: e.target.value })}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none font-mono text-xs leading-relaxed"
            />

            {errors.length > 0 && (
              <div className="max-h-24 shrink-0 space-y-1 overflow-y-auto rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {errors.map((msg) => (
                  <p key={msg}>{msg}</p>
                ))}
              </div>
            )}
            {warnings.length > 0 && (
              <div className="max-h-24 shrink-0 space-y-1 overflow-y-auto rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                {warnings.map((msg) => (
                  <p key={msg}>{msg}</p>
                ))}
              </div>
            )}

            {/* Secondary instructions the model receives alongside the prompt above. */}
            <details className="group shrink-0 rounded-lg border border-border">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-semibold [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
                Booking &amp; escalation rules
                <span className="font-normal text-muted-foreground">
                  — when it books, hands off, or flags an opt-out
                </span>
              </summary>
              <div className="px-3 pb-3">
                <Textarea
                  value={draft.toolDescription}
                  onChange={(e) => updateDraft({ toolDescription: e.target.value })}
                  spellCheck={false}
                  className="h-40 resize-none font-mono text-xs leading-relaxed"
                />
              </div>
            </details>

            <details className="group shrink-0 rounded-lg border border-border">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-semibold [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
                When the knowledge base finds nothing
                <span className="font-normal text-muted-foreground">
                  — replaces {"{{kbContext}}"} on empty retrieval
                </span>
              </summary>
              <div className="px-3 pb-3">
                <Textarea
                  value={draft.kbEmptyText}
                  onChange={(e) => updateDraft({ kbEmptyText: e.target.value })}
                  spellCheck={false}
                  className="h-28 resize-none font-mono text-xs leading-relaxed"
                />
              </div>
            </details>

            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border pt-2.5">
              <Input
                value={versionLabel}
                onChange={(e) => setVersionLabel(e.target.value)}
                placeholder="Name this version, e.g. softer objection handling"
                className="h-9 min-w-50 flex-1"
              />
              <Button
                size="sm"
                onClick={saveVersion}
                disabled={saving || !tableReady}
                className="h-9 gap-1.5"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </Button>
              <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={copyForHandoff}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                Copy for release
              </Button>
            </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Test conversation */}
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <CardHeader className="shrink-0 space-y-1 py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <MessagesSquare className="h-4 w-4 text-muted-foreground" />
                Test conversation
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMessages([])}
                disabled={!messages.length}
              >
                Reset chat
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Runs as the website widget: short, snappy replies, and times offered sooner because
              the visitor is on the site right now.
            </p>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-2 pb-3">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3">
              {messages.length === 0 && (
                <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                  Send a message as a visitor on the site. Nothing here creates a lead or books a
                  slot.
                </p>
              )}

              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
                      m.role === "user"
                        ? "rounded-br-sm bg-[#0F3B3D] text-white"
                        : "rounded-bl-sm border border-border bg-card"
                    }`}
                  >
                    {m.action === "book" && (
                      <div className="mb-2 flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                        <CalendarCheck className="h-3.5 w-3.5" />
                        Booked {m.slotIso}
                      </div>
                    )}
                    {m.action === "escalate" && (
                      <div className="mb-2 flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                        <UserRoundSearch className="h-3.5 w-3.5" />
                        Escalated{m.handoffReason ? `: ${m.handoffReason}` : ""}
                      </div>
                    )}
                    {m.optout && (
                      <div className="mb-2 flex items-center gap-1.5 rounded-md bg-rose-500/10 px-2 py-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                        <BellOff className="h-3.5 w-3.5" />
                        Opt-out flagged
                      </div>
                    )}
                    <div className="whitespace-pre-wrap">{m.content}</div>
                    {m.diagnostics && (
                      <div className="mt-2 border-t border-border/60 pt-1.5 text-[10px] text-muted-foreground">
                        {m.diagnostics.characters} chars · {m.diagnostics.latencyMs}ms ·{" "}
                        {m.diagnostics.kbChunkCount} KB chunk
                        {m.diagnostics.kbChunkCount === 1 ? "" : "s"}
                        {m.diagnostics.retrievalMethod ? ` (${m.diagnostics.retrievalMethod})` : ""} ·{" "}
                        {m.diagnostics.slotCount} slot
                        {m.diagnostics.slotCount === 1 ? "" : "s"}
                        {m.usedKb ? " · used KB" : ""}
                      </div>
                    )}

                    {/*
                      The passages retrieval handed the agent for this turn. Without
                      these, a weak answer caused by a KB gap is indistinguishable
                      from one caused by a bad prompt.
                    */}
                    {m.retrieved && m.retrieved.length > 0 && (
                      <details className="group mt-1.5">
                        <summary className="flex cursor-pointer list-none items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                          <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                          Knowledge base context ({m.retrieved.length})
                        </summary>
                        <ul className="mt-1 space-y-1.5">
                          {m.retrieved.map((r, i) => (
                            <li
                              key={`${r.documentId}-${i}`}
                              className="rounded border border-border/60 bg-background/60 px-2 py-1.5"
                            >
                              <div className="mb-0.5 flex flex-wrap items-center gap-1">
                                {r.scope === "PLATFORM" ? (
                                  <Globe className="h-2.5 w-2.5 text-muted-foreground" />
                                ) : (
                                  <Building2 className="h-2.5 w-2.5 text-muted-foreground" />
                                )}
                                <span className="truncate text-[10px] font-medium">
                                  {r.name || "Untitled"}
                                </span>
                                <span className="text-[9px] text-muted-foreground">{r.category}</span>
                                <span className="ml-auto font-mono text-[9px] text-muted-foreground">
                                  {r.score.toFixed(3)}
                                </span>
                              </div>
                              <p className="line-clamp-3 text-[10px] leading-relaxed text-muted-foreground">
                                {r.excerpt}
                                {r.truncated && "…"}
                              </p>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </div>
              ))}

              {sending && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-3">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <form onSubmit={sendMessage} className="flex shrink-0 items-center gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type as a visitor on the website…"
                disabled={sending}
              />
              <Button type="submit" disabled={!input.trim() || sending} className="gap-2">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Version history */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Saved versions</DialogTitle>
            <DialogDescription>
              Load a version back into the editor, or mark one as the draft this page opens with.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {versions.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nothing saved yet. Edit the prompt, name it, and hit Save.
              </p>
            )}
            {versions.map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">
                      {v.label || "Untitled version"}
                    </span>
                    {v.isActive && <Badge variant="secondary">Current draft</Badge>}
                    {v.isLive && (
                      <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600">
                        <Radio className="h-3 w-3" /> Live
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(v.createdAt).toLocaleString()}
                    {v.createdByName ? ` · ${v.createdByName}` : ""}
                    {v.isLive && v.setLiveByName ? ` · live by ${v.setLiveByName}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="outline" onClick={() => loadVersion(v)}>
                    Load
                  </Button>
                  {!v.isActive && (
                    <Button size="sm" variant="ghost" onClick={() => setCurrentVersion(v)}>
                      Set current
                    </Button>
                  )}
                  {/* The only control that changes what real leads see. */}
                  {!v.isLive && (
                    <Button
                      size="sm"
                      className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                      disabled={settingLive}
                      onClick={() => setVersionLive(v)}
                    >
                      {settingLive ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Radio className="h-3.5 w-3.5" />
                      )}
                      Set live
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteVersion(v)}
                    title="Delete version"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Rendered prompt */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Rendered prompt</DialogTitle>
            <DialogDescription>
              Exactly what the model receives for this company, with every placeholder filled in.
            </DialogDescription>
          </DialogHeader>
          {previewLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {previewMeta && (
                <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <Badge variant="secondary">{String(previewMeta.companyName)}</Badge>
                  <Badge variant="secondary">{String(previewMeta.slotCount)} slots</Badge>
                  <Badge variant="secondary">{String(previewMeta.kbChunkCount)} KB chunks</Badge>
                  <Badge variant="secondary">{String(previewMeta.timezone)}</Badge>
                </div>
              )}
              <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-4 font-mono text-[11px] leading-relaxed">
                {previewText}
              </pre>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
