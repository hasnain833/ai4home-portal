"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  ShieldCheck,
  Clock,
  CheckCircle2,
  FileImage,
  ExternalLink,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface CompanyRecord {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  verificationStatus: string;
  verificationDocUrl: string | null;
  verificationSubmittedAt: string | null;
  verifiedAt: string | null;
  warrantyEnabled: boolean;
  salesEnabled: boolean;
  createdAt: string;
}

const STATUS_ORDER: Record<string, number> = {
  SUBMITTED: 0,
  PENDING: 1,
  VERIFIED: 2,
};

export default function AdminVerificationsPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<CompanyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);

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

  const handleAction = async (companyId: string, action: "approve" | "reject") => {
    setActingId(companyId);
    try {
      await fetch(`/api/admin/companies/${companyId}/verify`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await fetchCompanies();
    } finally {
      setActingId(null);
    }
  };

  const sorted = [...companies].sort((a, b) => {
    const oa = STATUS_ORDER[a.verificationStatus] ?? 3;
    const ob = STATUS_ORDER[b.verificationStatus] ?? 3;
    if (oa !== ob) return oa - ob;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const pendingCount = companies.filter(
    (c) => c.verificationStatus === "SUBMITTED",
  ).length;

  const statusBadge = (status: string) => {
    switch (status) {
      case "SUBMITTED":
        return (
          <Badge className="gap-1 bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-400">
            <Clock className="h-3 w-3" /> Awaiting review
          </Badge>
        );
      case "VERIFIED":
        return (
          <Badge className="gap-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400">
            <CheckCircle2 className="h-3 w-3" /> Verified
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="gap-1 text-slate-500">
            Pending upload
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#b48c3c]/10 text-[#b48c3c]">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl text-foreground">
                Tenant Verifications
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Review documents submitted by new tenants and unlock their
                warranty workspace.
                {pendingCount > 0 && (
                  <span className="ml-1 font-medium text-amber-600 dark:text-amber-400">
                    {pendingCount} awaiting review.
                  </span>
                )}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 md:p-6">
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
              Loading verifications…
            </div>
          ) : sorted.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No companies found.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {sorted.map((company) => (
                <div
                  key={company.id}
                  className="flex flex-col rounded-xl border border-border bg-background p-4 shadow-sm"
                >
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">
                        {company.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {company.email || "—"}
                      </p>
                    </div>
                    {statusBadge(company.verificationStatus)}
                  </div>

                  {/* Document preview */}
                  <div className="mb-3 flex h-40 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted/40">
                    {company.verificationDocUrl ? (
                      <a
                        href={company.verificationDocUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group relative block h-full w-full"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={company.verificationDocUrl}
                          alt={`${company.name} verification document`}
                          className="h-full w-full object-contain"
                        />
                        <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
                          <span className="flex items-center gap-1.5 rounded-md bg-white/90 px-2.5 py-1 text-xs font-medium text-slate-800">
                            <ExternalLink className="h-3.5 w-3.5" /> View full
                          </span>
                        </span>
                      </a>
                    ) : (
                      <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
                        <FileImage className="h-6 w-6" />
                        <span className="text-xs">No document uploaded yet</span>
                      </div>
                    )}
                  </div>

                  {company.verificationSubmittedAt && (
                    <p className="mb-3 text-[11px] text-muted-foreground">
                      Submitted{" "}
                      {new Date(
                        company.verificationSubmittedAt,
                      ).toLocaleString()}
                    </p>
                  )}

                  <div className="mt-auto flex gap-2">
                    {company.verificationStatus === "VERIFIED" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full text-red-600 hover:text-red-700"
                        disabled={actingId === company.id}
                        onClick={() => handleAction(company.id, "reject")}
                      >
                        {actingId === company.id ? "Working…" : "Revoke"}
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          className="flex-1 bg-[#0F3B3D] text-white hover:bg-[#0F3B3D]/90"
                          disabled={
                            actingId === company.id ||
                            !company.verificationDocUrl
                          }
                          onClick={() => handleAction(company.id, "approve")}
                        >
                          {actingId === company.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <CheckCircle2 className="mr-1.5 h-4 w-4" /> Verify
                            </>
                          )}
                        </Button>
                        {company.verificationStatus === "SUBMITTED" && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-red-600 hover:text-red-700"
                            disabled={actingId === company.id}
                            onClick={() => handleAction(company.id, "reject")}
                          >
                            Reject
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
