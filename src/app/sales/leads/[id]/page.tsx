"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Sparkles,
  Target,
  Wallet,
  CalendarClock,
  Mail,
  Phone,
  MessageSquare,
  HelpCircle,
  Flag,
  Send,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, ApiError } from "@/lib/api";
import { toast } from "sonner";

type Agent = { id: string; name: string | null; email: string };

type Appointment = {
  id: string;
  title: string;
  time: string;
  durationMinutes: number;
  status: string;
  locationType: string;
  meetingLink: string | null;
  notes: string | null;
};

type Lead = {
  id: string;
  externalId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  status: string;
  tags: string[];
  emailOptIn: boolean;
  smsOptIn: boolean;
  consentSource: string | null;
  source: string;
  archived: boolean;
  createdAt: string;
  ownerId: string | null;
  owner: Agent | null;
  customFields: Record<string, unknown> | null;
  appointments: Appointment[];
  campaignEnrollments: {
    id: string;
    status: string;
    createdAt: string;
    campaign: { id: string; name: string } | null;
  }[];
};

type Payload = { lead: Lead; agents: Agent[]; statuses: string[] };

const statusColor = (status: string) => {
  switch (status) {
    case "Appointment Set":
      return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400";
    case "Qualified":
    case "Closed Won":
      return "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/20 dark:text-teal-400";
    case "Engaged":
      return "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/20 dark:text-indigo-400";
    case "Nurturing":
      return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400";
    case "Closed Lost":
    case "Unsubscribed":
      return "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/20 dark:text-rose-400";
    default:
      return "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-900/40 dark:text-slate-400";
  }
};

/**
 * The fields the "Mock up sales leads" sheet defines, grouped the way a sales
 * counsellor reads them. Anything in customFields that is NOT listed here — a
 * Salesforce-mapped field, say — still renders, in a catch-all section, so a
 * mapped field never silently vanishes.
 */
const FIELD_GROUPS: { title: string; icon: typeof Target; keys: [string, string][] }[] = [
  {
    title: "Fit & requirements",
    icon: Target,
    keys: [
      ["communityInterest", "Community interest"],
      ["preferredPlan", "Preferred plan"],
      ["mustHaves", "Must-haves"],
      ["whoIsComing", "Who is coming"],
      ["decisionPartners", "Decision partners"],
      ["reasonForPurchase", "Reason for purchase"],
      ["timeline", "Timeline"],
    ],
  },
  {
    title: "Money",
    icon: Wallet,
    keys: [
      ["budgetRange", "Budget range"],
      ["financingPosture", "Financing posture"],
      ["paymentEstimateShown", "Payment estimate shown"],
      ["needsToSellFirst", "Needs to sell first"],
    ],
  },
  {
    title: "Open items",
    icon: HelpCircle,
    keys: [
      ["questionsStillOpen", "Questions still open"],
      ["trustOrHesitation", "Trust / hesitation"],
      ["assetsAlreadySent", "Assets already sent"],
    ],
  },
];

// Rendered on their own, not in a group.
const SPECIAL_KEYS = new Set([
  "aiConversationSummary",
  "nextPromisedAction",
  "readinessScore",
  "preferredChannel",
  "appointmentLocation",
]);

const asText = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

const prettifyKey = (key: string) =>
  key
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default function LeadDetailPage() {
  const { id } = useParams();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState<"status" | "ownerId" | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await apiFetch<Payload>(`/api/sales/leads/${id}`);
      setData(payload);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) setNotFound(true);
      else toast.error("We couldn't load this lead. Please refresh and try again.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  // The fetch is kicked off inside the effect and guarded, so the effect body
  // never sets state synchronously and a slow response cannot land after the
  // page has been navigated away from.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const payload = await apiFetch<Payload>(`/api/sales/leads/${id}`);
        if (!cancelled) setData(payload);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) setNotFound(true);
        else toast.error("We couldn't load this lead. Please refresh and try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const patch = async (field: "status" | "ownerId", value: string) => {
    if (!data) return;
    const previous = data.lead;
    setSaving(field);
    // Optimistic, so the select does not snap back mid-request.
    setData((prev) =>
      prev ? { ...prev, lead: { ...prev.lead, [field]: value } } : prev,
    );
    try {
      await apiFetch(`/api/sales/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      // Reload so the owner object matches the new ownerId.
      await load();
      toast.success(field === "status" ? "Status updated." : "Lead reassigned.");
    } catch (error) {
      setData((prev) => (prev ? { ...prev, lead: previous } : prev));
      toast.error(error instanceof ApiError ? error.message : "Could not save that change.");
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <ProtectedRoute allowedRoles={["admin", "staff"]}>
        <PortalLayout workspace="sales">
          <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
            <div className="h-8 w-56 bg-muted rounded animate-pulse" />
            <div className="h-64 bg-muted rounded-xl animate-pulse" />
          </div>
        </PortalLayout>
      </ProtectedRoute>
    );
  }

  if (notFound || !data) {
    return (
      <ProtectedRoute allowedRoles={["admin", "staff"]}>
        <PortalLayout workspace="sales">
          <div className="max-w-2xl mx-auto p-12 text-center">
            <h2 className="text-lg font-bold">Lead not found</h2>
            <p className="text-sm text-muted-foreground mt-2">
              It may have been deleted, or it belongs to another workspace.
            </p>
            <Link href="/sales/leads" className="text-sm text-[#b48c3c] hover:underline mt-4 inline-block">
              Back to leads
            </Link>
          </div>
        </PortalLayout>
      </ProtectedRoute>
    );
  }

  const { lead, agents, statuses } = data;
  const fields = (lead.customFields ?? {}) as Record<string, unknown>;

  const summary = asText(fields.aiConversationSummary);
  const nextAction = asText(fields.nextPromisedAction);
  const readiness = fields.readinessScore;
  const channel = asText(fields.preferredChannel);

  const groupedKeys = new Set(FIELD_GROUPS.flatMap((g) => g.keys.map(([k]) => k)));
  const leftover = Object.entries(fields).filter(
    ([k, v]) => !groupedKeys.has(k) && !SPECIAL_KEYS.has(k) && asText(v) !== null,
  );

  const readinessScore = typeof readiness === "number" ? readiness : null;

  return (
    <ProtectedRoute allowedRoles={["admin", "staff"]}>
      <PortalLayout workspace="sales">
        <div className="max-w-7xl mx-auto space-y-6 pb-12 p-4 md:p-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-6">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Link
                  href="/sales/leads"
                  className="p-2 rounded-lg hover:bg-muted transition text-muted-foreground"
                  aria-label="Back to leads"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Link>
                <h1 className="text-2xl font-bold tracking-tight">
                  {lead.firstName} {lead.lastName}
                </h1>
                {lead.externalId && (
                  <span className="font-mono text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border/50">
                    {lead.externalId}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-12">
                <Badge
                  variant="outline"
                  className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-semibold border", statusColor(lead.status))}
                >
                  {lead.status}
                </Badge>
                {readinessScore !== null && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground"
                    title="Readiness score, 0–5"
                  >
                    <Flag className="h-3 w-3" />
                    Readiness {readinessScore}/5
                  </span>
                )}
                {lead.tags.map((t) => (
                  <span
                    key={t}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/50"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main column */}
            <div className="lg:col-span-2 space-y-6">
              {/* The most useful thing on the page, so it leads. */}
              {summary && (
                <Card className="border-amber-500/20 bg-linear-to-br from-slate-900 to-slate-950 text-slate-100 overflow-hidden">
                  <div className="bg-linear-to-r from-amber-600/10 to-orange-600/10 px-6 py-4 flex items-center gap-3 border-b border-slate-800">
                    <div className="p-2 bg-amber-500/20 rounded-xl">
                      <Sparkles className="h-5 w-5 text-amber-400" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-bold tracking-tight">
                        AI Conversation Summary
                      </CardTitle>
                      <p className="text-[10px] text-amber-300/80 font-medium">
                        What happened in the conversation so far
                      </p>
                    </div>
                  </div>
                  <CardContent className="p-6">
                    <p className="text-sm leading-relaxed text-slate-200 whitespace-pre-line">
                      {summary}
                    </p>
                  </CardContent>
                </Card>
              )}

              {FIELD_GROUPS.map((group) => {
                const rows = group.keys
                  .map(([key, label]) => [label, asText(fields[key])] as const)
                  .filter(([, value]) => value !== null);
                if (rows.length === 0) return null;
                const Icon = group.icon;
                return (
                  <Card key={group.title} className="overflow-hidden">
                    <CardHeader className="border-b bg-muted/20 py-4 px-6 flex flex-row items-center gap-3">
                      <div className="p-2 bg-primary/10 text-primary rounded-lg">
                        <Icon className="h-4 w-4" />
                      </div>
                      <CardTitle className="text-base font-bold">{group.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {rows.map(([label, value]) => (
                        <div key={label} className="space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            {label}
                          </p>
                          <p className="text-sm text-foreground/90">{value}</p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                );
              })}

              {leftover.length > 0 && (
                <Card className="overflow-hidden">
                  <CardHeader className="border-b bg-muted/20 py-4 px-6">
                    <CardTitle className="text-base font-bold">Other details</CardTitle>
                    <CardDescription className="text-[11px]">
                      Fields carried in from an import or a CRM mapping
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {leftover.map(([key, value]) => (
                      <div key={key} className="space-y-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          {prettifyKey(key)}
                        </p>
                        <p className="text-sm text-foreground/90">{asText(value)}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {nextAction && (
                // Pinned high on purpose: it is the one thing somebody has to do.
                <Card className="border-[#b48c3c]/40 bg-[#b48c3c]/5 overflow-hidden">
                  <CardContent className="p-5 space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#b48c3c] flex items-center gap-1.5">
                      <Send className="h-3 w-3" />
                      Next promised action
                    </p>
                    <p className="text-sm font-medium text-foreground">{nextAction}</p>
                  </CardContent>
                </Card>
              )}

              <Card className="overflow-hidden">
                <CardHeader className="border-b bg-muted/20 py-4 px-6 flex flex-row items-center gap-3">
                  <div className="p-2 bg-primary/10 text-primary rounded-lg">
                    <User className="h-4 w-4" />
                  </div>
                  <CardTitle className="text-base font-bold">Contact</CardTitle>
                </CardHeader>
                <CardContent className="p-6 space-y-4">
                  <div className="space-y-2">
                    {lead.email ? (
                      <a
                        href={`mailto:${lead.email}`}
                        className="text-xs text-[#b48c3c] hover:underline flex items-center gap-1.5 min-w-0"
                      >
                        <Mail className="h-3 w-3 shrink-0" />
                        <span className="truncate">{lead.email}</span>
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Mail className="h-3 w-3" /> No email
                      </span>
                    )}
                    {lead.phone ? (
                      <a
                        href={`tel:${lead.phone}`}
                        className="text-xs text-[#b48c3c] hover:underline flex items-center gap-1.5"
                      >
                        <Phone className="h-3 w-3 shrink-0" />
                        {lead.phone}
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Phone className="h-3 w-3" /> No phone
                      </span>
                    )}
                    {channel && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <MessageSquare className="h-3 w-3 shrink-0" />
                        Prefers {channel}
                      </p>
                    )}
                  </div>

                  <Separator />

                  <div className="space-y-1.5 text-[11px]">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Consent
                    </p>
                    <p className={lead.emailOptIn ? "text-emerald-600" : "text-muted-foreground"}>
                      {lead.emailOptIn ? "✓" : "✗"} Email
                    </p>
                    <p className={lead.smsOptIn ? "text-emerald-600" : "text-muted-foreground"}>
                      {lead.smsOptIn ? "✓" : "✗"} SMS
                    </p>
                    {lead.consentSource && (
                      <p className="text-muted-foreground">Source: {lead.consentSource}</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="overflow-hidden">
                <CardHeader className="border-b bg-muted/20 py-4 px-6">
                  <CardTitle className="text-base font-bold">Ownership</CardTitle>
                  <CardDescription className="text-[11px]">Status and assigned agent</CardDescription>
                </CardHeader>
                <CardContent className="p-6 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Status
                    </label>
                    <Select
                      value={lead.status}
                      onValueChange={(v) => patch("status", v)}
                      disabled={saving !== null}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {statuses.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Assigned agent
                    </label>
                    <Select
                      value={lead.ownerId ?? ""}
                      onValueChange={(v) => patch("ownerId", v)}
                      disabled={saving !== null}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Unassigned" />
                      </SelectTrigger>
                      <SelectContent>
                        {agents.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name || a.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <p className="text-[11px] text-muted-foreground">
                    Added {new Date(lead.createdAt).toLocaleDateString()} · source{" "}
                    {lead.source.toLowerCase()}
                  </p>
                </CardContent>
              </Card>

              <Card className="overflow-hidden">
                <CardHeader className="border-b bg-muted/20 py-4 px-6 flex flex-row items-center gap-3">
                  <div className="p-2 bg-primary/10 text-primary rounded-lg">
                    <CalendarClock className="h-4 w-4" />
                  </div>
                  <CardTitle className="text-base font-bold">Appointments</CardTitle>
                </CardHeader>
                <CardContent className="p-6 space-y-3">
                  {lead.appointments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing booked yet.</p>
                  ) : (
                    lead.appointments.map((a) => (
                      <div
                        key={a.id}
                        className="rounded-xl border border-border/60 p-3 space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold">{formatWhen(a.time)}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {a.status.toLowerCase()}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{a.title}</p>
                        {a.notes && <p className="text-[11px] text-muted-foreground">{a.notes}</p>}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {lead.campaignEnrollments.length > 0 && (
                <Card className="overflow-hidden">
                  <CardHeader className="border-b bg-muted/20 py-4 px-6">
                    <CardTitle className="text-base font-bold">Campaigns</CardTitle>
                  </CardHeader>
                  <CardContent className="p-6 space-y-2">
                    {lead.campaignEnrollments.map((e) => (
                      <div key={e.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate">{e.campaign?.name || "Campaign"}</span>
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {e.status.toLowerCase()}
                        </Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
