"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Building2, FileImage, ExternalLink, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

// SOP: a new builder goes live within 30 days of signing.
const GO_LIVE_TARGET_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

function onboardingBadge(c: { contractSignedAt: string | null; goLiveAt: string | null }) {
  if (!c.contractSignedAt) return null;
  const signed = new Date(c.contractSignedAt).getTime();
  if (c.goLiveAt) {
    const days = Math.round((new Date(c.goLiveAt).getTime() - signed) / DAY_MS);
    const late = days > GO_LIVE_TARGET_DAYS;
    return { text: `Live in ${days} day${days === 1 ? "" : "s"}`, late };
  }
  const day = Math.max(0, Math.floor((Date.now() - signed) / DAY_MS));
  return { text: `Day ${day} of ${GO_LIVE_TARGET_DAYS}`, late: day > GO_LIVE_TARGET_DAYS };
}
import { useAuth } from "@/contexts/AuthContext";

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
  _count?: {
    users: number;
    integrations: number;
  };
}

const verificationBadge = (status: string) => {
  switch (status) {
    case "VERIFIED":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
    case "SUBMITTED":
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
    default:
      return "bg-zinc-500/15 text-zinc-500 dark:text-zinc-400";
  }
};

export default function AdminCompaniesPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<CompanyRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCompanies = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/companies");
      const data = await response.json();
      if (response.ok) setCompanies(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.isSuperAdmin) fetchCompanies();
  }, [user]);

  const [actingId, setActingId] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  // Looked up live so the dialog reflects the refetch after Verify / Reject.
  const reviewing = companies.find((c) => c.id === reviewingId) ?? null;

  const verify = async (id: string, action: "approve" | "reject") => {
    setActingId(id);
    try {
      const res = await fetch(`/api/admin/companies/${id}/verify`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Could not update verification");
      await fetchCompanies();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update verification");
    } finally {
      setActingId(null);
    }
  };

  const toggleWorkspace = async (company: CompanyRecord, field: "warrantyEnabled" | "salesEnabled") => {
    const previous = companies;
    const next = { warrantyEnabled: company.warrantyEnabled, salesEnabled: company.salesEnabled, [field]: !company[field] };
    setCompanies((list) => list.map((c) => (c.id === company.id ? { ...c, ...next } : c)));
    try {
      const res = await fetch(`/api/admin/companies/${company.id}/workspaces`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Could not save");
    } catch (e) {
      setCompanies(previous);
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  };

  // Submissions awaiting review float to the top.
  const sorted = [...companies].sort(
    (a, b) => Number(b.verificationStatus === "SUBMITTED") - Number(a.verificationStatus === "SUBMITTED"),
  );
  const pendingCount = companies.filter((c) => c.verificationStatus === "SUBMITTED").length;

  const saveOnboarding = async (id: string, field: "contractSignedAt" | "goLiveAt", value: string) => {
    const previous = companies;
    setCompanies((list) => list.map((c) => (c.id === id ? { ...c, [field]: value || null } : c)));
    try {
      const res = await fetch(`/api/admin/companies/${id}/onboarding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value || null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Could not save");
    } catch (e) {
      setCompanies(previous);
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-card border-border shadow-sm">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-[#b48c3c]/10 rounded-lg flex items-center justify-center text-[#b48c3c]">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl text-foreground">Tenant Companies</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Every registered tenant: review verification documents and switch workspaces on or off.
                {pendingCount > 0 && (
                  <span className="ml-1 font-medium text-amber-600 dark:text-amber-400">{pendingCount} awaiting review.</span>
                )}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="pl-6">Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Verification</TableHead>
                  <TableHead>Workspaces</TableHead>
                  <TableHead className="text-center">Users</TableHead>
                  <TableHead>Onboarding</TableHead>
                  <TableHead className="pr-6">Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                      Loading companies...
                    </TableCell>
                  </TableRow>
                ) : companies.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">No companies found.</TableCell>
                  </TableRow>
                ) : (
                  sorted.map((company) => (
                    <TableRow key={company.id} className="hover:bg-muted/40">
                      <TableCell className="pl-6 font-medium text-foreground">{company.name}</TableCell>
                      <TableCell>
                        <div className="flex flex-col text-sm text-muted-foreground">
                          <span>{company.email || "—"}</span>
                          <span className="text-xs">{company.phone || "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[220px] truncate">
                        {company.address || "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={`border-0 uppercase text-[10px] tracking-wider font-bold ${verificationBadge(company.verificationStatus)}`}>
                            {company.verificationStatus || "PENDING"}
                          </Badge>
                          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-[#b48c3c]" onClick={() => setReviewingId(company.id)}>
                            <FileImage className="h-3.5 w-3.5" /> Review
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            title={company.warrantyEnabled ? "Click to disable" : "Click to enable"}
                            onClick={() => toggleWorkspace(company, "warrantyEnabled")}
                            className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium transition hover:ring-1 hover:ring-[#b48c3c] ${company.warrantyEnabled ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-zinc-500/10 text-muted-foreground line-through"}`}
                          >
                            Warranty
                          </button>
                          <button
                            type="button"
                            title={company.salesEnabled ? "Click to disable" : "Click to enable"}
                            onClick={() => toggleWorkspace(company, "salesEnabled")}
                            className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium transition hover:ring-1 hover:ring-[#b48c3c] ${company.salesEnabled ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-zinc-500/10 text-muted-foreground line-through"}`}
                          >
                            Sales
                          </button>
                        </div>
                      </TableCell>
                      <TableCell className="text-center text-sm text-foreground/80">
                        {company._count?.users ?? "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-[170px] flex-col gap-1 text-[11px] text-muted-foreground">
                          <label className="flex items-center justify-between gap-2">
                            Signed
                            <input
                              type="date"
                              className="rounded border border-border bg-background px-1 py-0.5 text-foreground"
                              value={dateInput(company.contractSignedAt)}
                              onChange={(e) => saveOnboarding(company.id, "contractSignedAt", e.target.value)}
                            />
                          </label>
                          <label className="flex items-center justify-between gap-2">
                            Live
                            <input
                              type="date"
                              className="rounded border border-border bg-background px-1 py-0.5 text-foreground"
                              value={dateInput(company.goLiveAt)}
                              onChange={(e) => saveOnboarding(company.id, "goLiveAt", e.target.value)}
                            />
                          </label>
                          {(() => {
                            const badge = onboardingBadge(company);
                            return badge ? (
                              <span className={badge.late ? "font-semibold text-rose-600" : "font-semibold text-emerald-600"}>
                                {badge.text}
                              </span>
                            ) : null;
                          })()}
                        </div>
                      </TableCell>
                      <TableCell className="pr-6 text-sm text-muted-foreground whitespace-nowrap">
                        {company.createdAt ? new Date(company.createdAt).toLocaleDateString() : "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!reviewing} onOpenChange={(open) => !open && setReviewingId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          {reviewing && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {reviewing.name}
                  <Badge variant="outline" className={`border-0 uppercase text-[10px] tracking-wider font-bold ${verificationBadge(reviewing.verificationStatus)}`}>
                    {reviewing.verificationStatus || "PENDING"}
                  </Badge>
                </DialogTitle>
                <DialogDescription>
                  {reviewing.verificationSubmittedAt
                    ? `Submitted ${new Date(reviewing.verificationSubmittedAt).toLocaleString()}`
                    : "Nothing submitted yet."}{" "}
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
                        // eslint-disable-next-line @next/next/no-img-element -- arbitrary uploaded document URL
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
                  <Button variant="outline" className="text-red-600 hover:text-red-700" disabled={actingId === reviewing.id} onClick={() => verify(reviewing.id, "reject")}>
                    {actingId === reviewing.id ? "Working…" : "Revoke verification"}
                  </Button>
                ) : (
                  <>
                    {reviewing.verificationStatus === "SUBMITTED" && (
                      <Button variant="outline" className="text-red-600 hover:text-red-700" disabled={actingId === reviewing.id} onClick={() => verify(reviewing.id, "reject")}>
                        Reject
                      </Button>
                    )}
                    <Button
                      className="bg-[#0F3B3D] text-white hover:bg-[#0F3B3D]/90"
                      disabled={actingId === reviewing.id || !reviewing.verificationDocUrl || !reviewing.agreementDocUrl}
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
