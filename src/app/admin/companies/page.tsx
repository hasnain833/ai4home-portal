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
import { Loader2, Building2 } from "lucide-react";
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
              <p className="text-sm text-muted-foreground mt-1">Details for every registered tenant. Manage workspace access from Users &amp; Access.</p>
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
                  companies.map((company) => (
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
                        <Badge variant="outline" className={`border-0 uppercase text-[10px] tracking-wider font-bold ${verificationBadge(company.verificationStatus)}`}>
                          {company.verificationStatus || "PENDING"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${company.warrantyEnabled ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-zinc-500/10 text-muted-foreground line-through"}`}>
                            Warranty
                          </span>
                          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${company.salesEnabled ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-zinc-500/10 text-muted-foreground line-through"}`}>
                            Sales
                          </span>
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
    </div>
  );
}
