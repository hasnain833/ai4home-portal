"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Mail,
  MessageSquare,
  Sparkles,
  RefreshCw,
  Pencil,
  RotateCcw,
  Zap,
  UserPlus,
  Bot,
  ShieldCheck,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Touch = {
  id: string;
  key: string;
  phase: number;
  at: number;
  type: "EMAIL" | "SMS";
  theme: string;
  goal: string;
  subject: string | null;
  body: string;
  enabled: boolean;
  edited: boolean;
};

type Phase = { id: number; name: string; range: string; goal: string; activeLeads: number };

type Workflow = {
  active: boolean;
  phases: Phase[];
  touches: Touch[];
  stats: { enrolled: number; active: number; booked: number; replied: number; optedOut: number; completed: number };
};

const API = "/api/sales/campaigns/auto";

function timing(at: number) {
  if (at === 0) return "Instantly";
  if (at < 60) return `+${at} min`;
  if (at < 1440) return `+${Math.round(at / 60)} hours`;
  return `Day ${Math.round(at / 1440)}`;
}

async function rewriteWithAi(t: Touch) {
  const res = await fetch("/api/sales/campaigns/generate-copy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stepType: t.type,
      goal: `${t.theme}: ${t.goal}. Invite them to book a model-home visit or chat with a sales consultant.`,
      audience: "New-home buyer leads who recently showed interest",
      contextInfo:
        `Rewrite this message for our company using facts from our knowledge base only. ` +
        `Keep the booking link merge tag if it is present. Current message: ${t.body}`,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "AI rewrite failed");
  return { subject: data.subject || t.subject, body: data.body || t.body };
}

export default function AutoNurtureWorkflow() {
  const confirm = useConfirm();
  const [wf, setWf] = useState<Workflow | null>(null);
  const [error, setError] = useState("");
  const [toggling, setToggling] = useState(false);
  const [editing, setEditing] = useState<Touch | null>(null);
  const [draft, setDraft] = useState({ subject: "", body: "" });
  const [busy, setBusy] = useState<"" | "save" | "ai" | "reset">("");
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(API, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setWf(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Could not load the automatic workflow.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patchStep = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`${API}/steps/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Could not save the step.");
    setWf((prev) => prev && { ...prev, touches: prev.touches.map((t) => (t.id === id ? { ...t, ...data } : t)) });
    return data;
  };

  const toggleWorkflow = async () => {
    if (!wf) return;
    const next = !wf.active;
    if (!next) {
      const ok = await confirm({
        title: "Turn off the 180-day workflow?",
        description: "New leads will no longer be enrolled, and leads already in it stop receiving messages until you turn it back on.",
        confirmText: "Turn off",
        destructive: true,
      });
      if (!ok) return;
    }
    setToggling(true);
    try {
      const res = await fetch(API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      });
      if (!res.ok) throw new Error();
      setWf({ ...wf, active: next });
      toast.success(next ? "Automatic workflow is on" : "Automatic workflow is off");
    } catch {
      toast.error("Could not update the workflow.");
    } finally {
      setToggling(false);
    }
  };

  const toggleTouch = (t: Touch) =>
    patchStep(t.id, { enabled: !t.enabled }).catch((e) => toast.error(e.message));

  const openEditor = (t: Touch) => {
    setEditing(t);
    setDraft({ subject: t.subject || "", body: t.body });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy("save");
    try {
      await patchStep(editing.id, { body: draft.body, ...(editing.type === "EMAIL" ? { subject: draft.subject } : {}) });
      toast.success("Message saved");
      setEditing(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy("");
    }
  };

  const aiDraft = async () => {
    if (!editing) return;
    setBusy("ai");
    try {
      const out = await rewriteWithAi({ ...editing, subject: draft.subject, body: draft.body });
      setDraft({ subject: out.subject || "", body: out.body });
      toast.success("AI draft ready — review it, then save");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI rewrite failed");
    } finally {
      setBusy("");
    }
  };

  const resetEdit = async () => {
    if (!editing) return;
    setBusy("reset");
    try {
      const data = await patchStep(editing.id, { reset: true });
      setDraft({ subject: data.subject || "", body: data.body });
      toast.success("Restored the default message");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reset.");
    } finally {
      setBusy("");
    }
  };

  const personalizeAll = async () => {
    if (!wf) return;
    const targets = wf.touches.filter((t) => t.enabled);
    const ok = await confirm({
      title: "Personalize every message with AI?",
      description: `The AI rewrites all ${targets.length} active messages using your knowledge base and brand voice, replacing the current wording (including your edits). You can reset any message to its default afterwards.`,
      confirmText: "Personalize",
    });
    if (!ok) return;
    setBulk({ done: 0, total: targets.length });
    let failed = 0;
    for (const [i, t] of targets.entries()) {
      try {
        const out = await rewriteWithAi(t);
        await patchStep(t.id, { body: out.body, ...(t.type === "EMAIL" ? { subject: out.subject } : {}) });
      } catch {
        failed += 1;
      }
      setBulk({ done: i + 1, total: targets.length });
    }
    setBulk(null);
    if (failed) toast.error(`${failed} message(s) could not be rewritten and were left as they were.`);
    else toast.success("All messages personalized");
  };

  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-3">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={load}>Try again</Button>
        </CardContent>
      </Card>
    );
  }
  if (!wf) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const stats = [
    { label: "Enrolled", value: wf.stats.enrolled },
    { label: "In progress", value: wf.stats.active },
    { label: "Booked", value: wf.stats.booked },
    { label: "Replied", value: wf.stats.replied },
    { label: "Opted out", value: wf.stats.optedOut },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold">180-Day Lead Nurture</h2>
            <Badge className={wf.active ? "bg-emerald-500/10 text-emerald-600 border-none" : "bg-muted text-muted-foreground border-none"}>
              {wf.active ? "On" : "Off"}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Runs automatically for every new lead from your website form, manual entry, or CSV import.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={personalizeAll} disabled={!!bulk} className="gap-2 h-9">
            {bulk ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {bulk ? `Personalizing ${bulk.done}/${bulk.total}` : "Personalize with AI"}
          </Button>
          <Button
            onClick={toggleWorkflow}
            disabled={toggling}
            className={wf.active ? "h-9" : "h-9 bg-[#0F3B3D] text-white hover:bg-[#0F3B3D]/90"}
            variant={wf.active ? "outline" : "default"}
          >
            {wf.active ? "Turn off" : "Turn on"}
          </Button>
        </div>
      </div>

      {/* How it works */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">How it works</CardTitle>
          <CardDescription>Every lead gets an instant response, useful content, and a clear next step until they book, opt out, or finish the 180 days.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          {[
            { icon: UserPlus, title: "New lead arrives", text: "From your website form, a manual entry, or a CSV import. They're enrolled instantly; no setup needed." },
            { icon: Zap, title: "Instant follow-up", text: "An SMS within a minute and an email within two, then scheduled touches across five phases." },
            { icon: Bot, title: "AI takes over on reply", text: "When a lead replies, the AI sales agent answers from your knowledge base and books the visit. Replying or booking ends the sequence." },
            { icon: ShieldCheck, title: "Compliant by default", text: "Texts only go to leads with SMS consent, sends respect quiet hours, and STOP or unsubscribe is honoured immediately." },
          ].map(({ icon: Icon, title, text }) => (
            <div key={title} className="space-y-1.5">
              <div className="flex items-center gap-2 font-medium">
                <Icon className="h-4 w-4 text-[#b48c3c]" /> {title}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{text}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-2xl font-bold text-primary">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Phases */}
      {wf.phases.map((phase) => (
        <Card key={phase.id}>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">
                  Phase {phase.id}: {phase.name}{" "}
                  <span className="text-sm font-normal text-muted-foreground">· {phase.range}</span>
                </CardTitle>
                <CardDescription>{phase.goal}</CardDescription>
              </div>
              <Badge variant="secondary" className="border-none">{phase.activeLeads} leads here now</Badge>
            </div>
          </CardHeader>
          <CardContent className="divide-y divide-border/50">
            {wf.touches.filter((t) => t.phase === phase.id).map((t) => (
              <div key={t.id} className={`flex items-start gap-3 py-3 ${t.enabled ? "" : "opacity-50"}`}>
                <div className="w-20 shrink-0 text-xs font-medium text-muted-foreground pt-0.5">{timing(t.at)}</div>
                <div className="shrink-0 pt-0.5">
                  {t.type === "EMAIL" ? <Mail className="h-4 w-4 text-primary" /> : <MessageSquare className="h-4 w-4 text-[#b48c3c]" />}
                </div>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{t.theme}</span>
                    <span className="text-xs text-muted-foreground">· {t.goal}</span>
                    {t.edited && <Badge variant="outline" className="h-5 text-[10px]">Customized</Badge>}
                  </div>
                  {t.subject && <p className="text-xs font-medium truncate">{t.subject}</p>}
                  <p className="text-xs text-muted-foreground line-clamp-2">{t.body}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openEditor(t)} className="h-8 w-8 p-0" aria-label="Edit message">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <input type="checkbox" checked={t.enabled} onChange={() => toggleTouch(t)} aria-label={`Send ${t.theme}`} />
                    On
                  </label>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {/* Editor */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && !busy && setEditing(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing?.theme}</DialogTitle>
            <DialogDescription>
              {editing && `${timing(editing.at)} · ${editing.type === "EMAIL" ? "Email" : "SMS"} · ${editing.goal}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {editing?.type === "EMAIL" && (
              <div className="space-y-1.5">
                <Label htmlFor="auto-subject">Subject</Label>
                <Input id="auto-subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="auto-body">Message</Label>
              <Textarea id="auto-body" rows={editing?.type === "EMAIL" ? 10 : 5} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
              <p className="text-xs text-muted-foreground">
                Merge fields: {"{{firstName}}"}, {"{{companyName}}"}, {"{{city}}"}, {"{{bookingLink}}"}.
                {editing?.type === "SMS" && " Your company name and the opt-out line are added automatically."}
                {editing?.type === "EMAIL" && " The unsubscribe footer is added automatically."}
              </p>
            </div>
          </div>
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <div className="flex gap-2">
              <Button variant="outline" onClick={aiDraft} disabled={!!busy} className="gap-1.5">
                {busy === "ai" ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Rewrite with AI
              </Button>
              <Button variant="ghost" onClick={resetEdit} disabled={!!busy} className="gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </Button>
            </div>
            <Button onClick={saveEdit} disabled={!!busy || !draft.body.trim()} className="bg-[#0F3B3D] text-white hover:bg-[#0F3B3D]/90">
              {busy === "save" ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
