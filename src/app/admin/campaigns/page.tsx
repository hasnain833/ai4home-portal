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
import {
  AlertTriangle,
  BarChart3,
  Loader2,
  Mail,
  Megaphone,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { apiFetch } from "@/lib/api";
import {
  B2B_API,
  B2B_LEAD_STATUSES,
  type B2BCampaign,
  type B2BEnrollment,
  type B2BLeadStatus,
  type CampaignStep,
  sendJson,
  titleCase,
  useB2BCampaigns,
  useB2BLeads,
} from "@/lib/b2b-store";

const STATUS_STYLES: Record<B2BCampaign["status"], string> = {
  DRAFT: "bg-zinc-500/15 text-zinc-500 dark:text-zinc-400",
  ACTIVE: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  PAUSED: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  COMPLETED: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
};

const EXIT_LABELS: Record<string, string> = {
  APPOINTMENT: "Booked a meeting",
  REPLY: "Replied",
  UNSUBSCRIBE: "Unsubscribed",
  STATUS: "Marked signed/lost",
  MANUAL: "Removed",
  NOT_CONFIGURED: "Messaging not configured",
};

const newStep = (delayDays = 0): CampaignStep => ({ channel: "EMAIL", delayDays, subject: "", body: "" });
type Draft = { id?: string; name: string; steps: CampaignStep[] };
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const PLACEHOLDERS = ["{{firstName}}", "{{contactName}}", "{{companyName}}", "{{city}}", "{{bookingLink}}"];

export default function AdminCampaignsPage() {
  const confirm = useConfirm();
  const { items: campaigns, loading, reload } = useB2BCampaigns();
  const { items: leads, reload: reloadLeads } = useB2BLeads();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [enrollFor, setEnrollFor] = useState<B2BCampaign | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickFilter, setPickFilter] = useState<B2BLeadStatus | "ALL">("NEW");
  const [progressFor, setProgressFor] = useState<B2BCampaign | null>(null);
  const [enrollments, setEnrollments] = useState<B2BEnrollment[] | null>(null);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const updateStep = (i: number, patch: Partial<CampaignStep>) =>
    setDraft((d) => d && { ...d, steps: d.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) });

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) return toast.error("Give the campaign a name.");
    if (draft.steps.some((s) => !s.body.trim() || (s.channel === "EMAIL" && !s.subject.trim())))
      return toast.error("Every email needs a subject and a message; every SMS needs a message.");
    const ok = await run(
      () => (draft.id ? sendJson(`${B2B_API}/campaigns/${draft.id}`, "PUT", draft) : sendJson(`${B2B_API}/campaigns`, "POST", draft)),
      "Campaign saved.",
    );
    if (ok) {
      setDraft(null);
      await reload();
    }
  };

  const setStatus = async (c: B2BCampaign, status: "ACTIVE" | "PAUSED") => {
    if (status === "ACTIVE" && c.status === "DRAFT" && c.stats.enrolled === 0) {
      const ok = await confirm({
        title: "Launch without leads?",
        description: "No leads are enrolled yet. Leads you enroll later will start receiving messages right away.",
        confirmText: "Launch anyway",
        destructive: false,
      });
      if (!ok) return;
    }
    const verb = status === "PAUSED" ? "paused" : c.status === "DRAFT" ? "launched" : "resumed";
    if (await run(() => sendJson(`${B2B_API}/campaigns/${c.id}/status`, "PATCH", { status }), `Campaign ${verb}.`)) await reload();
  };

  const remove = async (c: B2BCampaign) => {
    const ok = await confirm({
      title: `Delete "${c.name}"?`,
      description:
        c.stats.active > 0
          ? `${c.stats.active} lead${c.stats.active === 1 ? " is" : "s are"} still in this campaign and will stop receiving messages. This can't be undone.`
          : "The campaign and its history will be removed. This can't be undone.",
      confirmText: "Delete campaign",
    });
    if (!ok) return;
    if (await run(() => sendJson(`${B2B_API}/campaigns/${c.id}`, "DELETE"))) await reload();
  };

  const openEnroll = async (c: B2BCampaign) => {
    setPicked(new Set());
    setPickFilter("NEW");
    setEnrollFor(c);
    await reloadLeads();
  };

  const enroll = async () => {
    if (!enrollFor || !picked.size) return;
    await run(async () => {
      const r = await sendJson<{
        enrolled: number;
        skipped: { closed: number; alreadyEnrolled: number; optedOut: number };
        startsOnLaunch: boolean;
      }>(`${B2B_API}/campaigns/${enrollFor.id}/enroll`, "POST", { leadIds: [...picked] });
      const skipped = r.skipped.closed + r.skipped.alreadyEnrolled + r.skipped.optedOut;
      toast.success(
        `Enrolled ${r.enrolled} lead${r.enrolled === 1 ? "" : "s"}` +
          (skipped ? ` · skipped ${skipped} (already in it, signed/lost, or opted out)` : "") +
          (r.startsOnLaunch && r.enrolled ? ". Messages start when you launch." : "."),
      );
      setEnrollFor(null);
      await reload();
    });
  };

  const openProgress = async (c: B2BCampaign) => {
    setProgressFor(c);
    setEnrollments(null);
    try {
      setEnrollments(await apiFetch<B2BEnrollment[]>(`${B2B_API}/campaigns/${c.id}/enrollments`));
    } catch (e) {
      toast.error(errorMessage(e));
      setEnrollments([]);
    }
  };

  const unenroll = async (e: B2BEnrollment) => {
    if (!progressFor) return;
    if (await run(() => sendJson(`${B2B_API}/campaigns/${progressFor.id}/unenroll`, "POST", { leadIds: [e.lead.id] }), "Lead removed.")) {
      await Promise.all([openProgress(progressFor), reload()]);
    }
  };

  const pickable = leads.filter(
    (l) => !["SIGNED", "LOST"].includes(l.status) && (pickFilter === "ALL" || l.status === pickFilter),
  );
  const allPicked = pickable.length > 0 && pickable.every((l) => picked.has(l.id));

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
                  <Link href="/admin/leads" className="text-[#b48c3c] hover:underline">business leads</Link> until they book a meeting.
                  A lead leaves the campaign when they book, reply or unsubscribe.
                </p>
              </div>
            </div>
            <Button size="sm" className="gap-1.5 bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" onClick={() => setDraft({ name: "", steps: [newStep()] })}>
              <Plus className="h-3.5 w-3.5" /> New campaign
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-4 md:p-6">
          {loading ? (
            <Loader2 className="mx-auto my-12 h-5 w-5 animate-spin text-muted-foreground" />
          ) : campaigns.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">No campaigns yet.</div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {campaigns.map((c) => {
                const emails = c.steps.filter((s) => s.channel === "EMAIL").length;
                const texts = c.steps.length - emails;
                return (
                  <div key={c.id} className="flex flex-col rounded-xl border border-border bg-background p-4 shadow-sm">
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate font-semibold text-foreground">{c.name}</p>
                      <Badge variant="outline" className={`border-0 text-[10px] font-bold uppercase tracking-wider ${STATUS_STYLES[c.status]}`}>
                        {c.status}
                      </Badge>
                    </div>
                    <div className="mb-3 flex items-center gap-3 text-xs text-muted-foreground">
                      {emails > 0 && <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {emails} email{emails === 1 ? "" : "s"}</span>}
                      {texts > 0 && <span className="flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" /> {texts} SMS</span>}
                    </div>
                    <dl className="mb-4 grid grid-cols-3 gap-2 text-center text-xs">
                      {(
                        [
                          ["Enrolled", c.stats.enrolled],
                          ["In progress", c.stats.active],
                          ["Booked", c.stats.booked],
                        ] as const
                      ).map(([label, n]) => (
                        <div key={label} className="rounded-lg bg-muted/50 py-2">
                          <dd className="text-base font-semibold text-foreground">{n}</dd>
                          <dt className="text-muted-foreground">{label}</dt>
                        </div>
                      ))}
                    </dl>
                    {(c.stats.replied > 0 || c.stats.unsubscribed > 0 || c.stats.withIssues > 0) && (
                      <p className="mb-3 text-[11px] text-muted-foreground">
                        {c.stats.replied} replied · {c.stats.unsubscribed} unsubscribed
                        {c.stats.withIssues > 0 && (
                          <span className="ml-1 inline-flex items-center gap-0.5 text-amber-600">
                            · <AlertTriangle className="h-3 w-3" /> {c.stats.withIssues} with send issues
                          </span>
                        )}
                      </p>
                    )}
                    <div className="mt-auto flex gap-2">
                      {c.status === "ACTIVE" ? (
                        <Button variant="outline" size="sm" className="flex-1 gap-1.5" disabled={busy} onClick={() => setStatus(c, "PAUSED")}>
                          <Pause className="h-3.5 w-3.5" /> Pause
                        </Button>
                      ) : c.status !== "COMPLETED" ? (
                        <Button size="sm" className="flex-1 gap-1.5 bg-[#0F3B3D] text-white hover:bg-[#0F3B3D]/90" disabled={busy} onClick={() => setStatus(c, "ACTIVE")}>
                          <Play className="h-3.5 w-3.5" /> {c.status === "DRAFT" ? "Launch" : "Resume"}
                        </Button>
                      ) : (
                        <span className="flex-1" />
                      )}
                      <Button variant="outline" size="icon" className="h-8 w-8" title="Enroll leads" onClick={() => openEnroll(c)}>
                        <UserPlus className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="outline" size="icon" className="h-8 w-8" title="Lead progress" onClick={() => openProgress(c)}>
                        <BarChart3 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        title="Edit"
                        onClick={() => setDraft({ id: c.id, name: c.name, steps: structuredClone(c.steps) })}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="outline" size="icon" className="h-8 w-8 text-red-500 hover:bg-red-500/10" title="Delete" onClick={() => remove(c)}>
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

      {/* Create / edit */}
      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit campaign" : "New campaign"}</DialogTitle>
            <DialogDescription>
              Messages go out in order; each step waits its delay after the previous one. Texts only go out 8am–9pm in the lead&apos;s
              time zone. Every message includes the booking link and an opt-out.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Builder intro sequence" className="h-9 text-sm" />
              </div>

              <div className="space-y-3">
                <Label className="text-xs">Steps</Label>
                {draft.steps.map((step, i) => (
                  <div key={i} className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">Step {i + 1}</span>
                        <div className="flex gap-1">
                          {(["EMAIL", "SMS"] as const).map((ch) => (
                            <Button
                              key={ch}
                              type="button"
                              size="sm"
                              variant={step.channel === ch ? "default" : "outline"}
                              className="h-7 px-2.5 text-xs"
                              onClick={() => updateStep(i, { channel: ch })}
                            >
                              {ch === "EMAIL" ? "Email" : "SMS"}
                            </Button>
                          ))}
                        </div>
                      </div>
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
                    {step.channel === "EMAIL" && (
                      <Input value={step.subject} onChange={(e) => updateStep(i, { subject: e.target.value })} placeholder="Subject" className="h-9 text-sm" />
                    )}
                    <Textarea
                      value={step.body}
                      onChange={(e) => updateStep(i, { body: e.target.value })}
                      rows={step.channel === "SMS" ? 3 : 5}
                      placeholder={
                        step.channel === "SMS"
                          ? "Hi {{firstName}}, quick note from AI4Home — want 15 min to see how we cut warranty calls? {{bookingLink}}"
                          : "Hi {{firstName}}, we help builders like {{companyName}}…"
                      }
                      className="text-sm"
                    />
                    {step.channel === "SMS" && (
                      <p className="text-[11px] text-muted-foreground">{step.body.length} characters · &quot;Reply STOP to opt out.&quot; is added automatically.</p>
                    )}
                  </div>
                ))}
                {draft.steps.length < 20 && (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setDraft({ ...draft, steps: [...draft.steps, newStep(3)] })}>
                    <Plus className="h-3.5 w-3.5" /> Add step
                  </Button>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Placeholders: {PLACEHOLDERS.map((p) => <span key={p} className="mr-1.5 font-mono">{p}</span>)}— if a message has no{" "}
                  <span className="font-mono">{"{{bookingLink}}"}</span>, the link is added at the end.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" disabled={busy} onClick={save}>Save campaign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Enroll */}
      <Dialog open={!!enrollFor} onOpenChange={(open) => !open && setEnrollFor(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Enroll leads in &quot;{enrollFor?.name}&quot;</DialogTitle>
            <DialogDescription>
              {enrollFor?.status === "ACTIVE"
                ? "The campaign is running, so enrolled leads start right away."
                : "Enrolled leads start receiving messages when you launch the campaign."}{" "}
              Signed and lost leads can&apos;t be enrolled.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-1.5">
            {(["ALL", ...B2B_LEAD_STATUSES.filter((s) => s !== "SIGNED" && s !== "LOST")] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setPickFilter(s)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  pickFilter === s ? "border-[#b48c3c] bg-[#b48c3c]/10 text-[#b48c3c]" : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {s === "ALL" ? "All open" : titleCase(s)}
              </button>
            ))}
          </div>
          <div className="rounded-md border border-border">
            <label className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium">
              <input
                type="checkbox"
                checked={allPicked}
                onChange={() =>
                  setPicked((prev) => {
                    const next = new Set(prev);
                    pickable.forEach((l) => (allPicked ? next.delete(l.id) : next.add(l.id)));
                    return next;
                  })
                }
              />
              Select all ({pickable.length})
            </label>
            <ul className="max-h-72 overflow-y-auto text-sm">
              {pickable.length === 0 && <li className="px-3 py-6 text-center text-xs text-muted-foreground">No leads here.</li>}
              {pickable.map((l) => {
                const inThis = l.activeCampaigns.some((c) => c.id === enrollFor?.id);
                return (
                  <li key={l.id} className="border-b border-border last:border-0">
                    <label className={`flex items-center gap-2 px-3 py-2 ${inThis ? "opacity-50" : ""}`}>
                      <input
                        type="checkbox"
                        disabled={inThis}
                        checked={picked.has(l.id)}
                        onChange={() =>
                          setPicked((prev) => {
                            const next = new Set(prev);
                            if (next.has(l.id)) next.delete(l.id);
                            else next.add(l.id);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{l.companyName}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{l.email}</span>
                      </span>
                      <span className="text-[10px] uppercase text-muted-foreground">{inThis ? "Already in" : l.status}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnrollFor(null)}>Cancel</Button>
            <Button className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" disabled={!picked.size || busy} onClick={enroll}>
              Enroll {picked.size || ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Progress */}
      <Dialog open={!!progressFor} onOpenChange={(open) => !open && setProgressFor(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{progressFor?.name}: lead progress</DialogTitle>
            <DialogDescription>Where each enrolled lead is in the sequence, and anything that went wrong.</DialogDescription>
          </DialogHeader>
          {!enrollments ? (
            <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin text-muted-foreground" />
          ) : enrollments.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No leads enrolled yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Lead</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Step</th>
                    <th className="px-3 py-2 font-medium">Next send</th>
                    <th className="px-3 py-2 font-medium">Sent</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {enrollments.map((e) => (
                    <tr key={e.id}>
                      <td className="px-3 py-2">
                        <div className="font-medium">{e.lead.companyName}</div>
                        <div className="text-xs text-muted-foreground">{e.lead.email}</div>
                        {e.lastError && (
                          <div className="mt-1 flex items-start gap-1 text-[11px] text-amber-600">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {e.lastError}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {e.status === "EXITED" ? EXIT_LABELS[e.exitedReason || ""] || "Exited" : titleCase(e.status)}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {Math.min(e.currentStep, progressFor?.steps.length || 0)} / {progressFor?.steps.length}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {e.status === "ACTIVE" && e.nextRunAt
                          ? progressFor?.status === "ACTIVE"
                            ? new Date(e.nextRunAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
                            : progressFor?.status === "PAUSED"
                              ? "Paused"
                              : "Waiting for launch"
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {e.sentCount}
                        {e.failedCount > 0 && <span className="text-red-500"> · {e.failedCount} failed</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {e.status === "ACTIVE" && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Remove from campaign" disabled={busy} onClick={() => unenroll(e)}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
