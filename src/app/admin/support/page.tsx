"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, LifeBuoy, Search, ShieldAlert, History } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface CompanyOption {
  id: string;
  name: string;
}

interface SupportLead {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  source: string | null;
  createdAt: string;
  owner: { name: string | null; email: string | null } | null;
}

interface AccessEntry {
  id: string;
  actorEmail: string | null;
  createdAt: string;
  metadata: {
    companyName?: string;
    returned?: number;
    reason?: string | null;
  } | null;
}

export default function AdminSupportPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
  const [leads, setLeads] = useState<SupportLead[] | null>(null);
  const [meta, setMeta] = useState<{
    total: number;
    truncated: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState<AccessEntry[]>([]);

  useEffect(() => {
    if (!user?.isSuperAdmin) return;
    (async () => {
      const res = await fetch("/api/admin/companies");
      if (res.ok) {
        const data = await res.json();
        setCompanies(
          (data || []).map((c: CompanyOption) => ({ id: c.id, name: c.name })),
        );
      }
    })();
  }, [user]);

  const loadLog = useCallback(async () => {
    const res = await fetch("/api/admin/support/access-log");
    if (res.ok) setLog(await res.json());
  }, []);

  useEffect(() => {
    if (user?.isSuperAdmin) loadLog();
  }, [user, loadLog]);

  const openLeads = async () => {
    if (!companyId) {
      toast.error("Pick a company first.");
      return;
    }
    if (reason.trim().length < 5) {
      toast.error("Give a short reason — it is written to the audit trail.");
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ reason: reason.trim() });
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(
        `/api/admin/support/leads/${companyId}?${params}`,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(data.message || "Could not open support view");
      setLeads(data.leads || []);
      setMeta({ total: data.total || 0, truncated: !!data.truncated });
      await loadLog();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not open support view",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#b48c3c]/10 text-[#b48c3c]">
              <LifeBuoy className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl text-foreground">
                Support Lead Access
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Read-only view into a tenant&apos;s leads for support work.
                Every access is written to the audit trail with your account,
                the tenant, and your reason.
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 p-4 md:p-6">
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-400">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              This is tenant customer data. Open it only for a specific support
              request — the record is permanent and reviewable.
            </span>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium text-muted-foreground">
                Company
              </Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Select a tenant…" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium text-muted-foreground">
                Reason (recorded)
              </Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Ticket #482 — leads missing after CSV import"
                className="h-9 text-xs"
                maxLength={500}
              />
            </div>
            <Button
              onClick={openLeads}
              disabled={loading}
              className="h-9 gap-1.5 text-xs">
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
              Open
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] font-medium text-muted-foreground">
              Filter by name, email or phone (optional)
            </Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Narrow the result set"
              className="h-9 text-xs"
            />
          </div>

          {leads && (
            <div className="rounded-xl border border-border">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <p className="text-xs font-semibold">
                  {meta?.total ?? 0} lead{meta?.total === 1 ? "" : "s"} matched
                </p>
                {meta?.truncated && (
                  <Badge variant="outline" className="text-[10px]">
                    showing the most recent {leads.length}
                  </Badge>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-[11px] text-muted-foreground">
                      <th className="px-4 py-2 font-semibold">Name</th>
                      <th className="px-4 py-2 font-semibold">Email</th>
                      <th className="px-4 py-2 font-semibold">Phone</th>
                      <th className="px-4 py-2 font-semibold">Status</th>
                      <th className="px-4 py-2 font-semibold">Owner</th>
                      <th className="px-4 py-2 font-semibold">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-4 py-8 text-center text-muted-foreground">
                          No leads matched.
                        </td>
                      </tr>
                    ) : (
                      leads.map((l) => (
                        <tr
                          key={l.id}
                          className="border-b border-border last:border-0">
                          <td className="px-4 py-2.5 font-medium">
                            {[l.firstName, l.lastName]
                              .filter(Boolean)
                              .join(" ") || "—"}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">
                            {l.email || "—"}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">
                            {l.phone || "—"}
                          </td>
                          <td className="px-4 py-2.5">{l.status || "—"}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">
                            {l.owner?.name || l.owner?.email || "—"}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">
                            {new Date(l.createdAt).toLocaleDateString()}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-bold">
              Recent support access
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {log.length === 0 ? (
            <p className="px-6 py-8 text-center text-xs text-muted-foreground">
              No support access recorded yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {log.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-baseline gap-x-2 px-6 py-3 text-xs">
                  <span className="font-medium">
                    {e.actorEmail || "unknown"}
                  </span>
                  <span className="text-muted-foreground">viewed</span>
                  <span className="font-medium">
                    {e.metadata?.companyName || "—"}
                  </span>
                  <span className="text-muted-foreground">
                    ({e.metadata?.returned ?? 0} leads)
                  </span>
                  <span className="ml-auto text-muted-foreground">
                    {new Date(e.createdAt).toLocaleString()}
                  </span>
                  {e.metadata?.reason && (
                    <p className="w-full pt-1 text-[11px] italic text-muted-foreground">
                      {e.metadata.reason}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
