"use client";

import { isPlatformUser } from "@/lib/admin-permissions";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
  BookOpen,
  Globe,
  GraduationCap,
  Building2,
  ShieldCheck,
  LifeBuoy,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirm } from "@/components/ui/confirm-dialog";
import KnowledgeBasePanel from "@/components/admin/prompt-lab/KnowledgeBasePanel";
import HelpAgentLab from "@/components/admin/prompt-lab/HelpAgentLab";
import WebsiteAgentLab from "@/components/admin/prompt-lab/WebsiteAgentLab";
import B2BAgentLab from "@/components/admin/prompt-lab/B2BAgentLab";
import SalesCoachLab from "@/components/admin/prompt-lab/SalesCoachLab";
import LiveStatus from "@/components/admin/prompt-lab/LiveStatus";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";

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

const WARRANTY_PHASE_KEYS = ["INTAKE", "IDENTIFY", "DIAGNOSE", "RESOLVE"] as const;
type WarrantyPhaseKey = (typeof WARRANTY_PHASE_KEYS)[number];
type WarrantyDraft = Record<WarrantyPhaseKey, string>;
const EMPTY_WARRANTY_DRAFT: WarrantyDraft = { INTAKE: "", IDENTIFY: "", DIAGNOSE: "", RESOLVE: "" };

type WarrantyChatMessage = {
  id: string;
  role: "user" | "agent";
  content: string;
  phase?: string;
  latencyMs?: number;
  retrieved?: RetrievedChunk[];
  options?: string[];
};

type AgentTab = "sales" | "b2b" | "warranty" | "help" | "website" | "coach";

const PHASE_LABELS: Record<WarrantyPhaseKey, string> = {
  INTAKE: "Intake",
  IDENTIFY: "Identify",
  DIAGNOSE: "Diagnose",
  RESOLVE: "Resolve",
};

const PHASE_DESCRIPTIONS: Record<WarrantyPhaseKey, string> = {
  INTAKE: "Greets the homeowner and asks them to describe the issue.",
  IDENTIFY: "Looks up the homeowner's account and property by email.",
  DIAGNOSE: "Analyses the issue against the Warranty KB and gathers details.",
  RESOLVE: "Confirms the issue and files a warranty ticket.",
};

/** The JSON body a failed request returned. Saves and set-live put errors, warnings and acknowledgements there. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const failedBody = (e: unknown): Record<string, any> => (e instanceof ApiError && e.body && typeof e.body === "object" ? e.body : {});

export default function PromptLabPage() {
  const { user } = useAuth();
  const confirm = useConfirm();

  const [loading, setLoading] = useState(true);
  const [defaults, setDefaults] = useState<Draft>(EMPTY_DRAFT);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  // What the editors held when last loaded or saved; any difference is an unsaved edit.
  const [savedDraft, setSavedDraft] = useState<Draft>(EMPTY_DRAFT);
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

  // ── Agent switcher ───────────────────────────────────────────────────────
  const [agentTab, setAgentTab] = useState<AgentTab>("sales");
  const [b2bMeta, setB2bMeta] = useState({ edited: false, versions: 0 });
  const [b2bLiveSlot, setB2bLiveSlot] = useState<HTMLElement | null>(null);
  const [b2bHistoryOpen, setB2bHistoryOpen] = useState(false);

  // ── Warranty state ───────────────────────────────────────────────────────
  const [wLoading, setWLoading] = useState(false);
  const [wDefaults, setWDefaults] = useState<WarrantyDraft>(EMPTY_WARRANTY_DRAFT);
  const [wDraft, setWDraft] = useState<WarrantyDraft>(EMPTY_WARRANTY_DRAFT);
  const [wSavedDraft, setWSavedDraft] = useState<WarrantyDraft>(EMPTY_WARRANTY_DRAFT);
  const [wPhaseTab, setWPhaseTab] = useState<WarrantyPhaseKey>("INTAKE");
  const [wTab, setWTab] = useState<"prompt" | "kb">("prompt");
  const [wVersions, setWVersions] = useState<PromptVersion[]>([]);
  const [wLive, setWLive] = useState<LiveState | null>(null);
  const [wVersionLabel, setWVersionLabel] = useState("");
  const [wSaving, setWSaving] = useState(false);
  const [wSettingLive, setWSettingLive] = useState(false);
  const [wHistoryOpen, setWHistoryOpen] = useState(false);
  const [wErrors, setWErrors] = useState<string[]>([]);
  const [wWarnings, setWWarnings] = useState<string[]>([]);
  const [wMessages, setWMessages] = useState<WarrantyChatMessage[]>([]);
  const [wInput, setWInput] = useState("");
  const [wSending, setWSending] = useState(false);
  const [wChatPhase, setWChatPhase] = useState("INTAKE");
  const [wIssueState, setWIssueState] = useState<Record<string, unknown>>({});
  const wChatEndRef = useRef<HTMLDivElement>(null);

  const systemRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lab = await api.get<any>("/api/admin/prompt-lab");
      setDefaults(lab.defaults);
      setPlaceholders(lab.placeholders || []);
      setVersions(lab.versions || []);
      setLive(lab.live || null);
      setTableReady(lab.tableReady !== false);
      const next: Draft = lab.currentDraft
        ? {
            systemTemplate: lab.currentDraft.systemTemplate,
            toolDescription: lab.currentDraft.toolDescription,
            kbEmptyText: lab.currentDraft.kbEmptyText,
          }
        : lab.defaults;
      setDraft(next);
      setSavedDraft(next);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadWarranty = useCallback(async () => {
    setWLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await api.get<any>("/api/admin/warranty-prompt-lab");
      setWDefaults(data.defaults || EMPTY_WARRANTY_DRAFT);
      setWVersions(data.versions || []);
      setWLive(data.live || null);
      const next: WarrantyDraft = data.currentDraft ? {
        INTAKE: data.currentDraft.INTAKE,
        IDENTIFY: data.currentDraft.IDENTIFY,
        DIAGNOSE: data.currentDraft.DIAGNOSE,
        RESOLVE: data.currentDraft.RESOLVE,
      } : data.defaults || EMPTY_WARRANTY_DRAFT;
      setWDraft(next);
      setWSavedDraft(next);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setWLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active && isPlatformUser(user)) { void load(); void loadWarranty(); }
    });
    return () => { active = false; };
  }, [user, load, loadWarranty]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, sending]);

  useEffect(() => {
    wChatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [wMessages, wSending]);

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await api.post<any>("/api/admin/prompt-lab/chat", {
        draft,
        leadFirstName,
        messages: transcript.map((m) => ({ role: m.role, content: m.content })),
      });
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
    } catch (e) {
      toast.error(errorMessage(e));
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await api.post<any>("/api/admin/prompt-lab/preview", {
        draft,
        leadFirstName,
        question: lastUser?.content || "",
      });
      setPreviewText(data.system || "");
      setPreviewMeta(data.context || null);
      setErrors(data.validation?.errors || []);
      setWarnings(data.validation?.warnings || []);
    } catch (e) {
      toast.error(errorMessage(e));
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const saveVersion = async () => {
    setSaving(true);
    try {
      const data = await api.post<{ warnings?: string[] }>("/api/admin/prompt-lab/versions", { ...draft, label: versionLabel });
      setErrors([]);
      setWarnings(data.warnings || []);
      setVersionLabel("");
      toast.success("Version saved.");
      if (data.warnings?.length) {
        toast.warning(`Saved with ${data.warnings.length} warning(s) — check the editor.`);
      }
      await load();
      return true;
    } catch (e) {
      const body = failedBody(e);
      setErrors(body.errors || [errorMessage(e)]);
      setWarnings(body.warnings || []);
      toast.error(errorMessage(e));
      return false;
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
    try {
      await api.post(`/api/admin/prompt-lab/versions/${v.id}/set-current`);
    } catch (e) {
      return toast.error(errorMessage(e));
    }
    toast.success("Set as the current draft.");
    await load();
  };

  
  const setVersionLive = async (v: PromptVersion, acknowledgeWarnings = false) => {
    setSettingLive(true);
    try {
      let data = {} as ReturnType<typeof failedBody>;
      try {
        await api.post(`/api/admin/prompt-lab/versions/${v.id}/set-live`, { acknowledgeWarnings });
      } catch (e) {
        data = failedBody(e);
        if (!(e instanceof ApiError && e.status === 409 && data.needsAcknowledgement)) {
          toast.error(errorMessage(e));
          if (data.errors?.length) setErrors(data.errors);
          return;
        }
      }

      if (data.needsAcknowledgement) {
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
      const data = await api.post<{ message?: string }>("/api/admin/prompt-lab/revert-to-defaults");
      toast.success(data?.message || "Reverted to the code defaults.");
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSettingLive(false);
    }
  };

  const deleteVersion = async (v: PromptVersion) => {
    try {
      await api.delete(`/api/admin/prompt-lab/versions/${v.id}`);
    } catch (e) {
      return toast.error(errorMessage(e));
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

  // ── Warranty action handlers ──────────────────────────────────────────────────

  const [wCommunityId, setWCommunityId] = useState("platform");
  const [wCommunityName, setWCommunityName] = useState<string | null>(null);

  const sendWarrantyMessage = async (e: React.FormEvent | null, override?: string) => {
    e?.preventDefault();
    const text = (override ?? wInput).trim();
    if (!text || wSending) return;

    const userMsg: WarrantyChatMessage = { id: crypto.randomUUID(), role: "user", content: text };
    const transcript = [...wMessages, userMsg];
    setWMessages(transcript);
    setWInput("");
    setWSending(true);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await api.post<any>("/api/admin/warranty-prompt-lab/chat", {
        draft: wDraft,
        phase: wChatPhase,
        issueState: wIssueState,
        communityId: wCommunityId,
        messages: transcript.map((m) => ({ role: m.role, content: m.content })),
      });
      if (data.phase) setWChatPhase(data.phase);
      if (data.issueState) setWIssueState(data.issueState);
      setWMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "agent", content: data.reply || "",
          phase: data.phase, latencyMs: data.latencyMs,
          retrieved: Array.isArray(data.retrieved) ? data.retrieved : [],
          options: Array.isArray(data.options) ? data.options : [] },
      ]);
    } catch (e) {
      toast.error(errorMessage(e));
      setWMessages((prev) => prev.slice(0, -1));
      setWInput(text);
    } finally {
      setWSending(false);
    }
  };

  const saveWarrantyVersion = async () => {
    setWSaving(true);
    try {
      const data = await api.post<{ warnings?: string[] }>("/api/admin/warranty-prompt-lab/versions", { ...wDraft, label: wVersionLabel });
      setWErrors([]);
      setWWarnings(data.warnings || []);
      setWVersionLabel("");
      toast.success("Version saved.");
      await loadWarranty();
      return true;
    } catch (e) {
      const body = failedBody(e);
      setWErrors(body.errors || [errorMessage(e)]);
      setWWarnings(body.warnings || []);
      toast.error(errorMessage(e));
      return false;
    } finally {
      setWSaving(false);
    }
  };

  const salesDirty = (Object.keys(savedDraft) as (keyof Draft)[]).some((k) => draft[k] !== savedDraft[k]);
  const warrantyDirty = (Object.keys(wSavedDraft) as (keyof WarrantyDraft)[]).some((k) => wDraft[k] !== wSavedDraft[k]);
  const { dialog: unsavedDialog } = useUnsavedChanges({
    dirty: salesDirty || warrantyDirty,
    itemName:
      salesDirty && warrantyDirty
        ? "the Sales and Warranty agent prompts"
        : salesDirty
          ? "the Sales agent prompt"
          : "the Warranty agent prompt",
    // Saving creates a new version, just like the editor's own Save button.
    onSave: async () => (salesDirty ? await saveVersion() : true) && (warrantyDirty ? await saveWarrantyVersion() : true),
  });

  const loadWarrantyVersion = (v: PromptVersion) => {
    const pv = v as unknown as Record<string, string>;
    setWDraft({ INTAKE: pv.INTAKE || "", IDENTIFY: pv.IDENTIFY || "",
      DIAGNOSE: pv.DIAGNOSE || "", RESOLVE: pv.RESOLVE || "" });
    setWErrors([]); setWWarnings([]);
    setWHistoryOpen(false);
    toast.success(`Loaded ${v.label || "version"} into the editor.`);
  };

  const setWarrantyVersionLive = async (v: PromptVersion, acknowledgeWarnings = false) => {
    setWSettingLive(true);
    try {
      let data = {} as ReturnType<typeof failedBody>;
      try {
        await api.post(`/api/admin/warranty-prompt-lab/versions/${v.id}/set-live`, { acknowledgeWarnings });
      } catch (e) {
        data = failedBody(e);
        if (!(e instanceof ApiError && e.status === 409 && data.needsAcknowledgement)) {
          toast.error(errorMessage(e));
          return;
        }
      }
      if (data.needsAcknowledgement) {
        const ok = await confirm({
          title: "Put this version live with warnings?",
          description: (<div className="space-y-1.5"><p>This prompt goes live with warnings:</p>
            <ul className="list-disc pl-4 space-y-0.5">{((data.warnings || []) as string[]).map((w) => <li key={w}>{w}</li>)}</ul>
            <p>Real homeowners will see it immediately.</p></div>),
          confirmText: "Set live anyway", destructive: true,
        });
        if (ok) await setWarrantyVersionLive(v, true);
        return;
      }
      toast.success(`"${v.label || "Version"}" is now live.`);
      setWHistoryOpen(false);
      await loadWarranty();
    } finally { setWSettingLive(false); }
  };

  const revertWarrantyToDefaults = async () => {
    const ok = await confirm({
      title: "Revert warranty agent to code defaults?",
      description: "The live agent stops using the saved version and goes back to the prompts that ship in code. New conversations change immediately.",
      confirmText: "Revert",
    });
    if (!ok) return;
    setWSettingLive(true);
    try {
      const data = await api.post<{ message?: string }>("/api/admin/warranty-prompt-lab/revert-to-defaults");
      toast.success(data?.message || "Reverted to code defaults.");
      await loadWarranty();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally { setWSettingLive(false); }
  };

  const deleteWarrantyVersion = async (v: PromptVersion) => {
    try {
      await api.delete(`/api/admin/warranty-prompt-lab/versions/${v.id}`);
    } catch (e) {
      return toast.error(errorMessage(e));
    }
    toast.success("Version deleted.");
    await loadWarranty();
  };

  if (!isPlatformUser(user)) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        This page is restricted to platform super admins.
      </div>
    );
  }

  if (loading && wLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#b48c3c]" />
      </div>
    );
  }

  return (
    <div className="flex min-h-150 flex-col gap-4 xl:h-[max(46rem,calc(100dvh-4rem))]">
      {unsavedDialog}
      {/* Heading + Agent Switcher */}
      <div className="grid grid-cols-1 items-center gap-x-4 gap-y-2 lg:grid-cols-[1fr_auto_1fr]">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <FlaskConical className="h-5 w-5 text-[#b48c3c]" />
          Prompt Lab
        </h1>
        {/* Agent switcher tabs */}
        <div className="flex flex-wrap items-center justify-center gap-0.5 justify-self-center rounded-md bg-muted p-0.5">
          <button type="button" onClick={() => setAgentTab("sales")}
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              agentTab === "sales" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}>
            <FlaskConical className="h-3.5 w-3.5" /> B2C Sales Agent
          </button>
          <button type="button" onClick={() => setAgentTab("b2b")}
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              agentTab === "b2b" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}>
            <Building2 className="h-3.5 w-3.5" /> B2B Sales Agent
          </button>
          <button type="button" onClick={() => setAgentTab("warranty")}
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              agentTab === "warranty" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}>
            <ShieldCheck className="h-3.5 w-3.5" /> Warranty Agent
          </button>
          <button type="button" onClick={() => setAgentTab("help")}
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              agentTab === "help" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}>
            <LifeBuoy className="h-3.5 w-3.5" /> Help Agent
          </button>
          <button type="button" onClick={() => setAgentTab("website")}
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              agentTab === "website" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}>
            <Globe className="h-3.5 w-3.5" /> Website Agent
          </button>
          <button type="button" onClick={() => setAgentTab("coach")}
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              agentTab === "coach" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}>
            <GraduationCap className="h-3.5 w-3.5" /> Sales Coach
          </button>
        </div>
        <div aria-hidden className="hidden lg:block" />
      </div>

      {/* Description, plus live status and history for the versioned agents */}
      <div className="-mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          {agentTab === "sales"
            ? <>Edit the prompt, add knowledge-base documents, and talk to the agent. Saving keeps a draft for testing; only <strong>Set live</strong> puts a prompt in front of real leads.</>
            : agentTab === "warranty"
            ? <>Edit the four phase prompts the warranty agent uses, add platform knowledge-base documents, and test both in sandbox mode. No tickets or emails are sent during testing.</>
            : agentTab === "b2b"
            ? <>The agent that answers builders who reply to Business Campaigns. Edit the prompt, add its own knowledge-base documents, and talk to the agent. Saving keeps a draft for testing; only <strong>Set live</strong> changes what real builders get.</>
            : agentTab === "coach"
            ? <>The AI4Home team&apos;s training partner. Edit its four prompts and add training material to its own knowledge base; nothing here reaches a builder or a lead. <strong>Save &amp; go live</strong> applies to the next role-play message.</>
            : agentTab === "website"
            ? <>The public assistant on <strong>aiforhomebuilders.com</strong>: it answers visitors about AI4Home and takes consultation requests. Manage its prompt and review conversations and notification activity. <strong>Save &amp; go live</strong> applies to the next visitor message.</>
            : <>The assistant builder staff open from <strong>Help</strong> in the sidebar. It already knows the whole portal; add docs for anything else. <strong>Save &amp; go live</strong> applies to their next question.</>}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {agentTab === "sales" ? (
            <>
              <LiveStatus live={live} busy={settingLive} onRevert={revertToDefaults} onChooseVersion={() => setHistoryOpen(true)} />
              {isDefault ? (
                <Badge variant="secondary">Matches shipped prompt</Badge>
              ) : (
                <Badge className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]">Edited</Badge>
              )}
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setHistoryOpen(true)}>
                <History className="h-4 w-4" /> History
                {versions.length > 0 && <span className="text-muted-foreground">({versions.length})</span>}
              </Button>
            </>
          ) : agentTab === "b2b" ? (
            <>
              <span ref={setB2bLiveSlot} className="contents" />
              {b2bMeta.edited ? (
                <Badge className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]">Edited</Badge>
              ) : (
                <Badge variant="secondary">Matches shipped prompt</Badge>
              )}
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setB2bHistoryOpen(true)}>
                <History className="h-4 w-4" /> History
                {b2bMeta.versions > 0 && <span className="text-muted-foreground">({b2bMeta.versions})</span>}
              </Button>
            </>
          ) : agentTab === "warranty" ? (
            <>
              <LiveStatus live={wLive} busy={wSettingLive} onRevert={revertWarrantyToDefaults} onChooseVersion={() => setWHistoryOpen(true)} />
              <Badge variant="secondary">
                {wLive?.source === "live-version" ? "Custom prompt live" : "Matches shipped prompt"}
              </Badge>
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setWHistoryOpen(true)}>
                <History className="h-4 w-4" /> History
                {wVersions.length > 0 && <span className="text-muted-foreground">({wVersions.length})</span>}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {agentTab === "sales" && (
        <>
      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-2 xl:grid-rows-[minmax(0,1fr)]">
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
          <CardContent className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-3">
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
              className="min-h-64 flex-1 resize-none field-sizing-fixed font-mono text-xs leading-relaxed"
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <MessagesSquare className="h-4 w-4 text-muted-foreground" />
                Test conversation
              </CardTitle>
              <div className="flex flex-wrap items-center gap-1.5">
                <Label htmlFor="b2c-lab-lead" className="text-xs text-muted-foreground">Lead</Label>
                <Input
                  id="b2c-lab-lead"
                  className="h-7 w-28 text-xs"
                  value={leadFirstName}
                  onChange={(e) => setLeadFirstName(e.target.value)}
                  placeholder="Dana"
                />
                <Button variant="outline" size="sm" onClick={openPreview} className="h-7 gap-1.5 text-xs">
                  <Eye className="h-3.5 w-3.5" /> Rendered prompt
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setMessages([])}
                  disabled={!messages.length}
                >
                  Reset chat
                </Button>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Runs as the website widget: short, snappy replies, and times offered sooner because
              the visitor is on the site right now. Answers use the <strong>platform knowledge base</strong>, not any single company&apos;s own KB.
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
      </>
      )}

      {agentTab === "b2b" && <B2BAgentLab liveSlot={b2bLiveSlot} onMetaChange={setB2bMeta} historyOpen={b2bHistoryOpen} onHistoryOpenChange={setB2bHistoryOpen} />}
      {agentTab === "help" && <HelpAgentLab />}
      {agentTab === "website" && <WebsiteAgentLab />}
      {agentTab === "coach" && <SalesCoachLab />}

      {agentTab === "warranty" && (
        <>
          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-2 xl:grid-rows-[minmax(0,1fr)]">
            {/* Warranty Prompt Editor */}
            <Card className="flex min-h-0 flex-col overflow-hidden">
              <CardHeader className="shrink-0 flex-col justify-between space-y-3 py-3">
                {/*
                  Two switchers, nested. The four phases only mean something while
                  editing a prompt, so they sit under Prompt rather than competing
                  with the Knowledge base tab for the same row.
                */}
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
                    <button type="button" onClick={() => setWTab("prompt")}
                      className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                        wTab === "prompt" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                      }`}>
                      <FlaskConical className="h-3.5 w-3.5" /> Prompt
                    </button>
                    <button type="button" onClick={() => setWTab("kb")}
                      className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                        wTab === "kb" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                      }`}>
                      <BookOpen className="h-3.5 w-3.5" /> Knowledge base
                    </button>
                  </div>
                  {wTab === "prompt" && (
                    <div className="flex items-center gap-1.5">
                      <Button variant="ghost" size="sm" className="gap-1.5"
                        onClick={() => { setWDraft(wDefaults); setWErrors([]); setWWarnings([]); toast.success("Reset to the default shipped prompts."); }}>
                        <RotateCcw className="h-3.5 w-3.5" /> Reset all
                      </Button>
                    </div>
                  )}
                </div>
                {wTab === "prompt" && (
                  <>
                    <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5 w-fit">
                      {WARRANTY_PHASE_KEYS.map(key => (
                        <button key={key} type="button" onClick={() => setWPhaseTab(key)}
                          className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            wPhaseTab === key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                          }`}>
                          {PHASE_LABELS[key]}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <strong>{PHASE_LABELS[wPhaseTab]} phase:</strong> {PHASE_DESCRIPTIONS[wPhaseTab]}
                    </p>
                  </>
                )}
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-3">
                {wTab === "kb" ? (
                  <KnowledgeBasePanel
                    agent="warranty"
                    communityId={wCommunityId}
                    onCommunityChange={(id, name) => {
                      setWCommunityId(id);
                      setWCommunityName(name);
                    }}
                  />
                ) : (
                  <>
                <Textarea
                  value={wDraft[wPhaseTab]}
                  onChange={(e) => setWDraft(d => ({ ...d, [wPhaseTab]: e.target.value }))}
                  className="min-h-64 flex-1 resize-none field-sizing-fixed font-mono text-[11px] leading-relaxed"
                  placeholder="System prompt instructions..."
                />

                {wErrors.length > 0 && (
                  <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    <ul className="list-inside list-disc">
                      {wErrors.map((e, i) => (<li key={i}>{e}</li>))}
                    </ul>
                  </div>
                )}
                {wWarnings.length > 0 && (
                  <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                    <ul className="list-inside list-disc">
                      {wWarnings.map((w, i) => (<li key={i}>{w}</li>))}
                    </ul>
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2 max-w-50">
                    <Input placeholder="Version name (e.g. Beta v2)" value={wVersionLabel} onChange={(e) => setWVersionLabel(e.target.value)}
                      className="h-8 text-xs bg-muted/50" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" className="h-8 gap-1.5 bg-[#b48c3c] hover:bg-[#b48c3c]/90 text-white" disabled={wSaving} onClick={saveWarrantyVersion}>
                      {wSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      Save version
                    </Button>
                  </div>
                </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Warranty Test Chat Sandbox */}
            <Card className="flex min-h-0 flex-col overflow-hidden bg-muted/20">
              <CardHeader className="shrink-0 flex-row items-center justify-between space-y-0 py-3 pb-2 border-b">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold">Test Sandbox</span>
                  <Badge variant="outline" className="bg-background text-[10px] tracking-wider uppercase font-medium">Phase: {wChatPhase}</Badge>
                  {/*
                    The community is chosen on the Knowledge base tab, which may
                    not be the tab you are looking at. Shown here because a chat
                    grounding on a community you cannot see is a trap.
                  */}
                  <Badge variant="outline" className="bg-background text-[10px] font-medium gap-1">
                    {wCommunityId === "platform" ? (
                      <>
                        <Globe className="h-2.5 w-2.5" /> Platform
                      </>
                    ) : (
                      <>
                        <Building2 className="h-2.5 w-2.5" />
                        {wCommunityName || "Community"}
                      </>
                    )}
                  </Badge>
                </div>
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                  onClick={() => { setWMessages([]); setWChatPhase("INTAKE"); setWIssueState({}); }}>
                  <RotateCcw className="h-3.5 w-3.5" /> Clear chat
                </Button>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col gap-0 p-0">
                <div className="flex-1 overflow-y-auto p-4 pb-12 space-y-4">
                  {wMessages.length === 0 && (
                    <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
                      <ShieldCheck className="mb-2 h-8 w-8 opacity-20" />
                      <p>Start chatting to test the 4-phase warranty flow.</p>
                      <p className="text-[11px] mt-1 opacity-70">No real tickets are filed in this sandbox.</p>
                    </div>
                  )}
                  {wMessages.map((msg) => (
                    <div key={msg.id} className={`flex w-full ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`relative max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                          msg.role === "user"
                            ? "bg-[#b48c3c] text-white"
                            : "bg-background border text-foreground"
                        }`}>
                        <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                        {msg.role === "agent" && msg.latencyMs && (
                          <div className="mt-1 flex items-center justify-between gap-4 text-[10px] text-muted-foreground">
                            <span>{msg.latencyMs}ms</span>
                            {msg.retrieved && (
                              <span>
                                {msg.retrieved.length} KB passage{msg.retrieved.length === 1 ? "" : "s"}
                              </span>
                            )}
                          </div>
                        )}

                        {/*
                          Only the DIAGNOSE and RESOLVE phases retrieve, so an empty
                          list here is expected during intake and identification.
                        */}
                        {/* Choices the agent offered. Clickable here too, so the
                            property-selection path can actually be walked in the lab. */}
                        {msg.role === "agent" && msg.options && msg.options.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {msg.options.map((opt) => (
                              <button
                                key={opt}
                                type="button"
                                disabled={wSending}
                                onClick={() => sendWarrantyMessage(null, opt)}
                                className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] transition-colors hover:bg-accent disabled:opacity-50"
                              >
                                {opt}
                              </button>
                            ))}
                          </div>
                        )}

                        {msg.role === "agent" && msg.retrieved && msg.retrieved.length > 0 && (
                          <details className="group mt-1.5">
                            <summary className="flex cursor-pointer list-none items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                              <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                              Knowledge base context ({msg.retrieved.length})
                            </summary>
                            <ul className="mt-1 space-y-1.5">
                              {msg.retrieved.map((r, i) => (
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
                  {wSending && (
                    <div className="flex w-full justify-start">
                      <div className="flex items-center gap-1.5 rounded-lg border bg-background px-4 py-2.5 shadow-sm text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span className="text-[11px] font-medium tracking-wide">THINKING</span>
                      </div>
                    </div>
                  )}
                  <div ref={wChatEndRef} />
                </div>

                <form onSubmit={sendWarrantyMessage} className="shrink-0 flex items-end gap-2 border-t bg-background p-3">
                  <Textarea value={wInput} onChange={(e) => setWInput(e.target.value)} onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendWarrantyMessage(e); }
                    }}
                    className="min-h-11 max-h-32 resize-none text-sm leading-relaxed"
                    placeholder="Describe a warranty issue..."
                    disabled={wSending}
                  />
                  <Button type="submit" disabled={!wInput.trim() || wSending} className="gap-2 shrink-0 bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90">
                    {wSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Send
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </>
      )}

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

      {/* Warranty Version history */}
      <Dialog open={wHistoryOpen} onOpenChange={setWHistoryOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Warranty Agent Versions</DialogTitle>
            <DialogDescription>
              Load a version back into the editor, or set it live for homeowners.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {wVersions.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nothing saved yet. Edit the phase prompts, name the version, and hit Save.
              </p>
            )}
            {wVersions.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{v.label || "Untitled version"}</span>
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
                  <Button size="sm" variant="outline" onClick={() => loadWarrantyVersion(v)}>Load</Button>
                  {!v.isLive && (
                    <Button size="sm" className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                      disabled={wSettingLive} onClick={() => setWarrantyVersionLive(v)}>
                      {wSettingLive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radio className="h-3.5 w-3.5" />}
                      Set live
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteWarrantyVersion(v)} title="Delete version">
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
