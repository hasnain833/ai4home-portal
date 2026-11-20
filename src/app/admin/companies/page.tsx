"use client";

import { isPlatformUser, canAdmin } from "@/lib/admin-permissions";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Building2, FileImage, ExternalLink, CheckCircle2, Ban, RotateCcw, Settings2, MessageSquare } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { api, errorMessage } from "@/lib/api";
import type { SmsRegistration } from "@/components/sms/SmsRegistrationFields";

// SOP: a new builder goes live within 30 days of signing.
const GO_LIVE_TARGET_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

function onboardingBadge(c: { contractSignedAt: string | null; goLiveAt: string | null }) {
  if (!c.contractSignedAt) return null;
  const signed = new Date(c.contractSignedAt).getTime();
  if (c.goLiveAt) {
    const days = Math.round((new Date(c.goLiveAt).getTime() - signed) / DAY_MS);
    return { text: `Live in ${days} day${days === 1 ? "" : "s"}`, late: days > GO_LIVE_TARGET_DAYS };
  }
  const day = Math.max(0, Math.floor((Date.now() - signed) / DAY_MS));
  return { text: `Day ${day} of ${GO_LIVE_TARGET_DAYS}`, late: day > GO_LIVE_TARGET_DAYS };
}

type SmsStatus = "NONE" | "PENDING" | "APPROVED" | "REJECTED";

interface CompanyRecord {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  warrantyEnabled: boolean;
  salesEnabled: boolean;
  verificationStatus: string;
  verificationDocUrl: string | null;
  verificationSubmittedAt: string | null;
  agreementDocUrl: string | null;
  agreementVersion: string | null;
  createdAt: string;
  contractSignedAt: string | null;
  goLiveAt: string | null;
  suspendedAt: string | null;
  smsNumber: string | null;
  smsStatus: SmsStatus;
  smsThisMonth: number;
  smsLastSharedAt: string | null;
  smsRejectReason: string | null;
  smsRegistration: SmsRegistration | null;
}

const TONE = {
  green: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  red: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  grey: "bg-zinc-500/15 text-zinc-500 dark:text-zinc-400",
};

const SMS_STATUS: Record<SmsStatus, { label: string; tone: string }> = {
  NONE: { label: "Shared number", tone: TONE.grey },
  PENDING: { label: "Pending", tone: TONE.amber },
  APPROVED: { label: "Own number", tone: TONE.green },
  REJECTED: { label: "Rejected", tone: TONE.red },
};

// SRS SMS-12/13: shared-number routing goes once every active builder has its own number
// and no builder has texted from the shared number for 60 days.
const SHARED_REPLY_WINDOW_DAYS = 60;
function smsMigration(companies: CompanyRecord[]) {
  const active = companies.filter((c) => !c.suspendedAt);
  const moved = active.filter((c) => c.smsStatus === "APPROVED").length;
  if (moved < active.length) {
    return { done: false, text: `${moved} of ${active.length} builders on their own texting number. Shared-number routing stays until all have moved.` };
  }
  const lastShared = Math.max(0, ...companies.map((c) => (c.smsLastSharedAt ? new Date(c.smsLastSharedAt).getTime() : 0)));
  const safeFrom = lastShared + SHARED_REPLY_WINDOW_DAYS * DAY_MS;
  return safeFrom <= Date.now()
    ? { done: true, text: "Every builder is on its own texting number. Removing shared-number routing (SMS Phase 3) is safe now." }
    : {
        done: false,
        text: `Every builder is on its own texting number. Removing shared-number routing (SMS Phase 3) is safe from ${new Date(safeFrom).toLocaleDateString()}, 60 days after the last shared-number text.`,
      };
}

const verificationTone =(status: string) => (status === "VERIFIED" ? TONE.green : status === "SUBMITTED" ? TONE.amber : TONE.grey);

const formatPhone = (e164: string | null) => {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 || "");
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
};

function StatusPill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <Badge variant="outline" className={`border-0 text-[10px] font-bold uppercase tracking-wider ${tone}`}>
      {children}
    </Badge>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="truncate text-sm text-foreground">{value || "—"}</p>
    </div>
  );
}

export default function AdminCompaniesPage() {
  const { user } = useAuth();
  // View-only staff see the list; the server rejects changes regardless.
  const canManage = canAdmin(user, "companies.manage");
  const confirm = useConfirm();
  const [companies, setCompanies] = useState<CompanyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const patchCompany = (id: string, changes: Partial<CompanyRecord>) =>
    setCompanies((list) => list.map((c) => (c.id === id ? { ...c, ...changes } : c)));

  const fetchCompanies = async () => {
    setLoading(true);
    try {
      setCompanies(await api.get<CompanyRecord[]>("/api/admin/companies"));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load data on mount/change
    if (isPlatformUser(user)) fetchCompanies();
  }, [user]);

  const [actingId, setActingId] = useState<string | null>(null);
  // Dialogs look companies up live, so they reflect every save and refetch.
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const reviewing = companies.find((c) => c.id === reviewingId) ?? null;
  const [managingId, setManagingId] = useState<string | null>(null);
  const managing = companies.find((c) => c.id === managingId) ?? null;

  const verify = async (id: string, action: "approve" | "reject") => {
    setActingId(id);
    try {
      await api.patch(`/api/admin/companies/${id}/verify`, { action });
      await fetchCompanies();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setActingId(null);
    }
  };

  const toggleWorkspace = async (company: CompanyRecord, field: "warrantyEnabled" | "salesEnabled") => {
    const next = { warrantyEnabled: company.warrantyEnabled, salesEnabled: company.salesEnabled, [field]: !company[field] };
    patchCompany(company.id, next);
    try {
      await api.patch(`/api/admin/companies/${company.id}/workspaces`, next);
    } catch (e) {
      patchCompany(company.id, { [field]: company[field] });
      toast.error(errorMessage(e));
    }
  };

  const setSuspended = async (company: CompanyRecord, suspended: boolean) => {
    if (suspended) {
      const ok = await confirm({
        title: `Suspend ${company.name}?`,
        description:
          "Their users can't sign in, their website chat and lead form stop working, and no emails or texts go out. Nothing is deleted, and you can reactivate at any time.",
        confirmText: "Suspend",
        destructive: true,
      });
      if (!ok) return;
    }
    setActingId(company.id);
    try {
      const { suspendedAt } = await api.patch<{ suspendedAt: string | null }>(`/api/admin/companies/${company.id}/suspension`, { suspended });
      patchCompany(company.id, { suspendedAt });
      toast.success(suspended ? `${company.name} suspended.` : `${company.name} reactivated.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setActingId(null);
    }
  };

  const saveOnboarding = async (company: CompanyRecord, field: "contractSignedAt" | "goLiveAt", value: string) => {
    patchCompany(company.id, { [field]: value || null });
    try {
      await api.patch(`/api/admin/companies/${company.id}/onboarding`, { [field]: value || null });
    } catch (e) {
      patchCompany(company.id, { [field]: company[field] });
      toast.error(errorMessage(e));
    }
  };

  // Manual override, for a number registered by hand in the Telnyx portal.
  const [override, setOverride] = useState<{ smsNumber: string; smsStatus: SmsStatus } | null>(null);
  const [overrideSaving, setOverrideSaving] = useState(false);
  const saveOverride = async (company: CompanyRecord) => {
    if (!override) return;
    setOverrideSaving(true);
    try {
      const saved = await api.patch<Partial<CompanyRecord>>(`/api/admin/companies/${company.id}/sms`, {
        smsNumber: override.smsNumber.trim() || null,
        smsStatus: override.smsStatus,
      });
      patchCompany(company.id, saved);
      setOverride(null);
      toast.success(`Texting number saved for ${company.name}.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setOverrideSaving(false);
    }
  };

  const openManage = (id: string) => {
    setOverride(null);
    setManagingId(id);
  };

  // Submissions awaiting review float to the top.
  const sorted = [...companies].sort(
    (a, b) => Number(b.verificationStatus === "SUBMITTED") - Number(a.verificationStatus === "SUBMITTED"),
  );
  const pendingCount = companies.filter((c) => c.verificationStatus === "SUBMITTED").length;

  const workspaceChip = (company: CompanyRecord, field: "warrantyEnabled" | "salesEnabled", label: string) => (
    <button
      type="button"
      disabled={!canManage}
      title={company[field] ? `${label} on. Click to turn off` : `${label} off. Click to turn on`}
      onClick={() => toggleWorkspace(company, field)}
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium transition enabled:hover:ring-1 enabled:hover:ring-[#b48c3c] ${
        company[field] ? TONE.green : "bg-zinc-500/10 text-muted-foreground line-through"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-6">
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#b48c3c]/10 text-[#b48c3c]">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl text-foreground">Tenant Companies</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Every registered tenant. Click a verification status to review documents, or Manage for everything else.
                {pendingCount > 0 && <span className="ml-1 font-medium text-amber-600 dark:text-amber-400">{pendingCount} awaiting review.</span>}
              </p>
              {!loading && companies.length > 0 && (() => {
                const migration = smsMigration(companies);
                return (
                  <p className={`mt-1 flex items-center gap-1.5 text-xs ${migration.done ? "font-medium text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                    <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                    {migration.text}
                  </p>
                );
              })()}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="pl-6">Company</TableHead>
                  <TableHead>Verification</TableHead>
                  <TableHead>Workspaces</TableHead>
                  <TableHead>Onboarding</TableHead>
                  <TableHead>Texting</TableHead>
                  <TableHead className="pr-6" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                      Loading companies...
                    </TableCell>
                  </TableRow>
                ) : companies.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                      No companies found.
                    </TableCell>
                  </TableRow>
                ) : (
                  sorted.map((company) => {
                    const onboarding = onboardingBadge(company);
                    const sms = SMS_STATUS[company.smsStatus] ?? SMS_STATUS.NONE;
                    return (
                      <TableRow key={company.id} className={`hover:bg-muted/40 ${company.suspendedAt ? "opacity-60" : ""}`}>
                        <TableCell className="py-4 pl-6">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">{company.name}</span>
                            {company.suspendedAt && <StatusPill tone={TONE.red}>Suspended</StatusPill>}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {[company.email, company.phone].filter(Boolean).join(" · ") || "No contact details"}
                          </p>
                        </TableCell>
                        <TableCell>
                          <button type="button" title="Review documents" onClick={() => setReviewingId(company.id)} className="rounded-md transition hover:opacity-80">
                            <StatusPill tone={verificationTone(company.verificationStatus)}>{company.verificationStatus || "PENDING"}</StatusPill>
                          </button>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1.5">
                            {workspaceChip(company, "warrantyEnabled", "Warranty")}
                            {workspaceChip(company, "salesEnabled", "Sales")}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {onboarding ? (
                            <span className={`font-semibold ${onboarding.late ? "text-rose-600" : "text-emerald-600"}`}>{onboarding.text}</span>
                          ) : (
                            <span className="text-muted-foreground">Not signed</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusPill tone={sms.tone}>{sms.label}</StatusPill>
                          {company.smsStatus === "APPROVED" && company.smsNumber && (
                            <p className="mt-1 font-mono text-xs text-muted-foreground">{formatPhone(company.smsNumber)}</p>
                          )}
                        </TableCell>
                        <TableCell className="pr-6 text-right">
                          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => openManage(company.id)}>
                            <Settings2 className="h-3.5 w-3.5" /> Manage
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!managing} onOpenChange={(open) => !open && setManagingId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          {managing && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {managing.name}
                  {managing.suspendedAt && <StatusPill tone={TONE.red}>Suspended</StatusPill>}
                </DialogTitle>
                <DialogDescription>Joined {new Date(managing.createdAt).toLocaleDateString()}</DialogDescription>
              </DialogHeader>

              <div className="space-y-5">
                <Section title="Contact">
                  <div className="grid grid-cols-2 gap-3">
                    <Detail label="Email" value={managing.email} />
                    <Detail label="Phone" value={managing.phone} />
                    <div className="col-span-2">
                      <Detail label="Address" value={managing.address} />
                    </div>
                  </div>
                </Section>

                <Section title="Onboarding">
                  <div className="grid grid-cols-2 gap-3">
                    {(
                      [
                        ["contractSignedAt", "Contract signed"],
                        ["goLiveAt", "Went live"],
                      ] as const
                    ).map(([field, label]) => (
                      <div key={field} className="space-y-1.5">
                        <Label htmlFor={`onb-${field}`} className="text-[11px] text-muted-foreground">
                          {label}
                        </Label>
                        <Input
                          id={`onb-${field}`}
                          type="date"
                          disabled={!canManage}
                          value={dateInput(managing[field])}
                          onChange={(e) => saveOnboarding(managing, field, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                  {(() => {
                    const badge = onboardingBadge(managing);
                    return badge ? (
                      <p className={`text-xs font-semibold ${badge.late ? "text-rose-600" : "text-emerald-600"}`}>
                        {badge.text} (target: live within {GO_LIVE_TARGET_DAYS} days)
                      </p>
                    ) : null;
                  })()}
                </Section>

                <Section title="Texting">
                  <div className="flex items-center justify-between gap-3">
                    <StatusPill tone={(SMS_STATUS[managing.smsStatus] ?? SMS_STATUS.NONE).tone}>
                      {(SMS_STATUS[managing.smsStatus] ?? SMS_STATUS.NONE).label}
                    </StatusPill>
                    <span className="text-xs text-muted-foreground">{managing.smsThisMonth.toLocaleString()} texts this month</span>
                  </div>
                  {managing.smsNumber && <p className="font-mono text-base font-semibold">{formatPhone(managing.smsNumber)}</p>}
                  {managing.smsStatus === "REJECTED" && managing.smsRejectReason && (
                    <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">{managing.smsRejectReason}</p>
                  )}
                  {managing.smsRegistration ? (
                    <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3">
                      <Detail label="Legal name" value={managing.smsRegistration.legalName} />
                      <Detail label="EIN" value={`•••••${managing.smsRegistration.ein.slice(-4)}`} />
                      <Detail
                        label="Contact"
                        value={`${managing.smsRegistration.contactFirstName} ${managing.smsRegistration.contactLastName}`}
                      />
                      <Detail label="Website" value={managing.smsRegistration.website} />
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      The builder hasn&apos;t registered yet. They do it from Settings → Email &amp; SMS in their Sales Hub.
                    </p>
                  )}

                  {canManage &&
                    (override ? (
                      <div className="space-y-3 rounded-lg border border-border p-3">
                        <p className="text-xs text-muted-foreground">
                          Only for a number registered by hand in the Telnyx portal. Texts go out from it once it&apos;s approved.
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label htmlFor="sms-number" className="text-[11px] text-muted-foreground">
                              Phone number
                            </Label>
                            <Input
                              id="sms-number"
                              placeholder="+1 555 123 4567"
                              value={override.smsNumber}
                              onChange={(e) => setOverride({ ...override, smsNumber: e.target.value })}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="sms-status" className="text-[11px] text-muted-foreground">
                              Status
                            </Label>
                            <select
                              id="sms-status"
                              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                              value={override.smsStatus}
                              onChange={(e) => setOverride({ ...override, smsStatus: e.target.value as SmsStatus })}
                            >
                              <option value="NONE">Not registered</option>
                              <option value="PENDING">Pending</option>
                              <option value="APPROVED">Approved</option>
                              <option value="REJECTED">Rejected</option>
                            </select>
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => setOverride(null)}>
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            className="bg-[#0F3B3D] text-white hover:bg-[#0F3B3D]/90"
                            disabled={overrideSaving}
                            onClick={() => saveOverride(managing)}
                          >
                            {overrideSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        onClick={() => setOverride({ smsNumber: managing.smsNumber || "", smsStatus: managing.smsStatus })}
                      >
                        Set number manually
                      </button>
                    ))}
                </Section>

                {canManage && (
                  <Section title="Account">
                    {managing.suspendedAt ? (
                      <Button variant="outline" size="sm" className="gap-1.5" disabled={actingId === managing.id} onClick={() => setSuspended(managing, false)}>
                        {actingId === managing.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Reactivate
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 text-red-600 hover:bg-red-500/10 hover:text-red-700"
                        disabled={actingId === managing.id}
                        onClick={() => setSuspended(managing, true)}
                      >
                        {actingId === managing.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} Suspend account
                      </Button>
                    )}
                  </Section>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!reviewing} onOpenChange={(open) => !open && setReviewingId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          {reviewing && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {reviewing.name}
                  <StatusPill tone={verificationTone(reviewing.verificationStatus)}>{reviewing.verificationStatus || "PENDING"}</StatusPill>
                </DialogTitle>
                <DialogDescription>
                  {reviewing.verificationSubmittedAt ? `Submitted ${new Date(reviewing.verificationSubmittedAt).toLocaleString()}` : "Nothing submitted yet."}{" "}
                  Both documents are needed before the company can be verified.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ["Signed agreement", reviewing.agreementDocUrl, reviewing.agreementVersion ? `Version ${reviewing.agreementVersion}` : "Platform Services Agreement"],
                    ["Business document", reviewing.verificationDocUrl, "Invoice or proof of business"],
                  ] as const
                ).map(([label, url, hint]) => (
                  <div key={label} className="flex flex-col gap-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">{label}</p>
                        <p className="text-[11px] text-muted-foreground">{hint}</p>
                      </div>
                      {url && (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs text-[#b48c3c] hover:underline">
                          Open <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    {url ? (
                      /\.pdf($|\?)/i.test(url) ? (
                        <iframe src={url} title={label} className="h-80 w-full rounded-lg border border-border bg-muted" />
                      ) : (
                        <img src={url} alt={label} className="h-80 w-full rounded-lg border border-border bg-muted object-contain" />
                      )
                    ) : (
                      <div className="flex h-80 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 text-sm text-muted-foreground">
                        <FileImage className="h-6 w-6" /> Not uploaded yet
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <DialogFooter>
                {reviewing.verificationStatus === "VERIFIED" ? (
                  <Button variant="outline" className="text-red-600 hover:text-red-700" disabled={!canManage || actingId === reviewing.id} onClick={() => verify(reviewing.id, "reject")}>
                    {actingId === reviewing.id ? "Working…" : "Revoke verification"}
                  </Button>
                ) : (
                  <>
                    {reviewing.verificationStatus === "SUBMITTED" && (
                      <Button variant="outline" className="text-red-600 hover:text-red-700" disabled={!canManage || actingId === reviewing.id} onClick={() => verify(reviewing.id, "reject")}>
                        Reject
                      </Button>
                    )}
                    <Button
                      className="bg-[#0F3B3D] text-white hover:bg-[#0F3B3D]/90"
                      disabled={!canManage || actingId === reviewing.id || !reviewing.verificationDocUrl || !reviewing.agreementDocUrl}
                      onClick={() => verify(reviewing.id, "approve")}
                    >
                      {actingId === reviewing.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CheckCircle2 className="mr-1.5 h-4 w-4" /> Verify</>}
                    </Button>
                  </>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
