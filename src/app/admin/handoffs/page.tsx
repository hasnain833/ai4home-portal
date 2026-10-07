"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRightLeft, CheckCircle2, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface HandoffIssue {
  id: string;
  company: { id: string; name: string };
  lead: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    status: string;
  } | null;
  error: string;
  attempts: number;
  partial: boolean;
  requestedBy: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Failed sales-to-warranty hand-offs (Closed Won) across every builder. */
export default function HandoffIssuesPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"PENDING" | "RESOLVED">("PENDING");
  const [issues, setIssues] = useState<HandoffIssue[]>([]);
  const [open, setOpen] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const fetchIssues = useCallback(async () => {
    const res = await fetch(`/api/admin/handoff-issues?status=${tab}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Could not load issues");
    return data as { issues: HandoffIssue[]; open: number };
  }, [tab]);

  // Callers set loading first; state is only set after the fetch resolves.
  const load = useCallback(async () => {
    try {
      const data = await fetchIssues();
      setIssues(data.issues || []);
      setOpen(data.open || 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load issues");
    } finally {
      setLoading(false);
    }
  }, [fetchIssues]);

  useEffect(() => {
    if (!user?.isSuperAdmin) return;
    let cancelled = false;
    fetchIssues()
      .then((data) => {
        if (cancelled) return;
        setIssues(data.issues || []);
        setOpen(data.open || 0);
      })
      .catch((e) => !cancelled && toast.error(e instanceof Error ? e.message : "Could not load issues"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [user, fetchIssues]);

  const act = async (issue: HandoffIssue, action: "retry" | "resolve") => {
    setBusy(issue.id);
    try {
      const res = await fetch(`/api/admin/handoff-issues/${issue.id}/${action}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "That did not work");
      toast.success(action === "retry" ? "Hand-off completed." : "Marked resolved.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work");
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#b48c3c]/10 text-[#b48c3c]">
                <ArrowRightLeft className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-xl text-foreground">Hand-off Issues</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Sales-to-warranty hand-offs (Closed Won) that did not fully work. Fix the cause,
                  then retry, or mark resolved if it was handled another way.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoading(true);
                void load();
              }}
              className="gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
          <div className="mt-4 flex gap-2">
            {(["PENDING", "RESOLVED"] as const).map((t) => (
              <Button
                key={t}
                size="sm"
                variant={tab === t ? "default" : "outline"}
                onClick={() => {
                  if (t === tab) return;
                  setLoading(true);
                  setTab(t);
                }}
              >
                {t === "PENDING" ? `Open (${open})` : "Resolved"}
              </Button>
            ))}
          </div>
        </CardHeader>

        <CardContent className="space-y-3 p-4 md:p-6">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : issues.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-emerald-500" />
              {tab === "PENDING" ? "No open hand-off issues." : "Nothing resolved yet."}
            </div>
          ) : (
            issues.map((issue) => (
              <div key={issue.id} className="rounded-xl border border-border bg-background p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="font-semibold text-foreground">
                      {issue.lead ? `${issue.lead.firstName} ${issue.lead.lastName}` : "Deleted lead"}
                      <span className="font-normal text-muted-foreground"> · {issue.company.name}</span>
                    </p>
                    {issue.lead && (
                      <p className="text-xs text-muted-foreground">
                        {issue.lead.email || "No email"} · {issue.lead.phone || "No phone"} · Lead status:{" "}
                        {issue.lead.status}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <Badge variant="outline" className="text-[10px]">
                        {issue.partial ? "Welcome email failed" : "Hand-off failed"}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {issue.attempts} attempt{issue.attempts === 1 ? "" : "s"}
                      </Badge>
                    </div>
                  </div>
                  {issue.status === "PENDING" && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={busy === issue.id || !issue.lead}
                        onClick={() => act(issue, "retry")}
                      >
                        {busy === issue.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" />
                        )}
                        {issue.partial ? "Resend welcome email" : "Retry hand-off"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === issue.id}
                        onClick={() => act(issue, "resolve")}
                      >
                        Mark resolved
                      </Button>
                    </div>
                  )}
                </div>
                <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
                  {issue.error}
                </p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  First failed {when(issue.createdAt)} · last {when(issue.updatedAt)}
                  {issue.requestedBy && ` · by ${issue.requestedBy}`}
                  {issue.resolvedAt && ` · resolved ${when(issue.resolvedAt)}`}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
