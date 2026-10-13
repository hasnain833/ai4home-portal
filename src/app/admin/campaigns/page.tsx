"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Mail, Megaphone, MessageSquare, Pause, Pencil, Play, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import {
  B2B_LEAD_STATUSES,
  type B2BCampaign,
  type B2BLeadStatus,
  type CampaignStep,
  useB2BCampaigns,
  useB2BLeads,
} from "@/lib/b2b-store";

const STATUS_STYLES: Record<B2BCampaign["status"], string> = {
  DRAFT: "bg-zinc-500/15 text-zinc-500 dark:text-zinc-400",
  ACTIVE: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  PAUSED: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
};

const NEW_STEP: CampaignStep = { delayDays: 0, subject: "", body: "" };
const blankCampaign = (): B2BCampaign => ({
  id: "",
  name: "",
  channel: "EMAIL",
  audience: ["NEW"],
  steps: [{ ...NEW_STEP }],
  status: "DRAFT",
  createdAt: "",
});

export default function AdminCampaignsPage() {
  const [campaigns, setCampaigns] = useB2BCampaigns();
  const [leads] = useB2BLeads();
  const [draft, setDraft] = useState<B2BCampaign | null>(null);

  const audienceSize = (audience: B2BLeadStatus[]) => leads.filter((l) => audience.includes(l.status)).length;

  const updateStep = (i: number, patch: Partial<CampaignStep>) =>
    setDraft((d) => d && { ...d, steps: d.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) });

  const save = () => {
    if (!draft) return;
    if (!draft.name.trim()) return toast.error("Give the campaign a name.");
    if (!draft.audience.length) return toast.error("Pick at least one lead status to target.");
    if (draft.steps.some((s) => !s.body.trim() || (draft.channel === "EMAIL" && !s.subject.trim())))
      return toast.error(draft.channel === "EMAIL" ? "Every email needs a subject and a message." : "Every SMS needs a message.");
    const saved = draft.id ? draft : { ...draft, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    setCampaigns((prev) => (draft.id ? prev.map((c) => (c.id === draft.id ? saved : c)) : [saved, ...prev]));
    setDraft(null);
    toast.success("Campaign saved.");
  };

  const setStatus = (id: string, status: B2BCampaign["status"]) =>
    setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));

  return (
    <div className="space-y-6">
      <Card className="bg-card border-border shadow-sm">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 bg-[#b48c3c]/10 rounded-lg flex items-center justify-center text-[#b48c3c]">
                <Megaphone className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-xl text-foreground">Business Campaigns</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Email and SMS sequences that nurture{" "}
                  <Link href="/admin/leads" className="text-[#b48c3c] hover:underline">business leads</Link> until they sign up.
                </p>
              </div>
            </div>
            <Button size="sm" className="gap-1.5 bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" onClick={() => setDraft(blankCampaign())}>
              <Plus className="h-3.5 w-3.5" /> New campaign
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-4 md:p-6">
          {campaigns.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">No campaigns yet.</div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {campaigns.map((c) => {
                const ChannelIcon = c.channel === "EMAIL" ? Mail : MessageSquare;
                return (
                  <div key={c.id} className="flex flex-col rounded-xl border border-border bg-background p-4 shadow-sm">
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate font-semibold text-foreground">{c.name}</p>
                      <Badge variant="outline" className={`border-0 text-[10px] font-bold uppercase tracking-wider ${STATUS_STYLES[c.status]}`}>
                        {c.status}
                      </Badge>
                    </div>
                    <dl className="mb-4 space-y-1.5 text-xs text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <ChannelIcon className="h-3.5 w-3.5" /> {c.channel === "EMAIL" ? "Email" : "SMS"} · {c.steps.length} step{c.steps.length === 1 ? "" : "s"}
                      </div>
                      <div className="flex items-center gap-2">
                        <Users className="h-3.5 w-3.5" /> {audienceSize(c.audience)} leads ·{" "}
                        {c.audience.map((s) => s.charAt(0) + s.slice(1).toLowerCase()).join(", ")}
                      </div>
                    </dl>
                    <div className="mt-auto flex gap-2">
                      {c.status === "ACTIVE" ? (
                        <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={() => setStatus(c.id, "PAUSED")}>
                          <Pause className="h-3.5 w-3.5" /> Pause
                        </Button>
                      ) : (
                        <Button size="sm" className="flex-1 gap-1.5 bg-[#0F3B3D] text-white hover:bg-[#0F3B3D]/90" onClick={() => setStatus(c.id, "ACTIVE")}>
                          <Play className="h-3.5 w-3.5" /> {c.status === "DRAFT" ? "Launch" : "Resume"}
                        </Button>
                      )}
                      <Button variant="outline" size="icon" className="h-8 w-8" title="Edit" onClick={() => setDraft(structuredClone(c))}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 text-red-500 hover:bg-red-500/10"
                        title="Delete"
                        onClick={() => setCampaigns((prev) => prev.filter((x) => x.id !== c.id))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit campaign" : "New campaign"}</DialogTitle>
            <DialogDescription>Messages go out in order; each step waits its delay after the previous one.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                <div className="space-y-1.5">
                  <Label className="text-xs">Name</Label>
                  <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Builder intro sequence" className="h-9 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Channel</Label>
                  <div className="flex gap-1.5">
                    {(["EMAIL", "SMS"] as const).map((ch) => (
                      <Button
                        key={ch}
                        type="button"
                        size="sm"
                        variant={draft.channel === ch ? "default" : "outline"}
                        className="h-9 flex-1"
                        onClick={() => setDraft({ ...draft, channel: ch })}
                      >
                        {ch === "EMAIL" ? "Email" : "SMS"}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Send to leads with status ({audienceSize(draft.audience)} leads)</Label>
                <div className="flex flex-wrap gap-1.5">
                  {B2B_LEAD_STATUSES.map((s) => {
                    const on = draft.audience.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setDraft({ ...draft, audience: on ? draft.audience.filter((x) => x !== s) : [...draft.audience, s] })}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                          on ? "border-[#b48c3c] bg-[#b48c3c]/10 text-[#b48c3c]" : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {s.charAt(0) + s.slice(1).toLowerCase()}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-xs">Steps</Label>
                {draft.steps.map((step, i) => (
                  <div key={i} className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold">Step {i + 1}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{i === 0 ? "Send after" : "Wait"}</span>
                        <Input
                          type="number"
                          min={0}
                          value={step.delayDays}
                          onChange={(e) => updateStep(i, { delayDays: Math.max(0, Number(e.target.value) || 0) })}
                          className="h-7 w-16 text-xs"
                        />
                        <span className="text-muted-foreground">days</span>
                        {draft.steps.length > 1 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-red-500 hover:bg-red-500/10"
                            onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, idx) => idx !== i) })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                    {draft.channel === "EMAIL" && (
                      <Input value={step.subject} onChange={(e) => updateStep(i, { subject: e.target.value })} placeholder="Subject" className="h-9 text-sm" />
                    )}
                    <Textarea
                      value={step.body}
                      onChange={(e) => updateStep(i, { body: e.target.value })}
                      rows={4}
                      placeholder="Hi {{contactName}}, we help builders like {{companyName}}…"
                      className="text-sm"
                    />
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setDraft({ ...draft, steps: [...draft.steps, { ...NEW_STEP, delayDays: 3 }] })}
                >
                  <Plus className="h-3.5 w-3.5" /> Add step
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Placeholders: <span className="font-mono">{"{{contactName}}"}</span>, <span className="font-mono">{"{{companyName}}"}</span>
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" onClick={save}>Save campaign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
