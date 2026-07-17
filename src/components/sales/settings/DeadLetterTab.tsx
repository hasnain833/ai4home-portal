"use client";
import { useState, useEffect, useCallback, Fragment } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Inbox,
  RefreshCcw,
  Send,
  Ban,
  Mail,
  MessageSquare,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

interface DeadLetterRow {
  id: string;
  source: string;
  channel: string;
  leadId: string | null;
  refId: string | null;
  payload: { to?: string; subject?: string; body?: string; html?: string };
  error: string;
  attempts: number;
  status: string;
  replayedAt: string | null;
  createdAt: string;
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400",
  REPLAYED: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400",
  DISCARDED: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

const FILTERS = ["PENDING", "REPLAYED", "DISCARDED", "ALL"] as const;
type Filter = (typeof FILTERS)[number];

export default function DeadLetterTab() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DeadLetterRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<Filter>("PENDING");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadRows = useCallback(async (status: Filter) => {
    try {
      const qs = status === "ALL" ? "" : `?status=${status}`;
      const res = await fetch(`/api/sales/dead-letters${qs}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setRows(data.deadLetters || []);
        setCounts(data.counts || {});
      } else {
        toast.error("Could not load the dead-letter queue.");
      }
    } catch (error) {
      console.error("Failed to fetch dead letters:", error);
      toast.error("Could not load the dead-letter queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await loadRows(filter);
    })();
  }, [filter, loadRows]);

  const act = async (id: string, action: "replay" | "discard") => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/sales/dead-letters/${id}/${action}`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || "Done.");
      } else {
        toast.error(data.message || "Action failed.");
      }
      await loadRows(filter);
    } catch (error) {
      console.error(`Dead letter ${action} failed:`, error);
      toast.error("Action failed.");
    } finally {
      setBusyId(null);
    }
  };

  const pending = counts.PENDING || 0;

  return (
    <Card className="border border-border/80 shadow-xs">
      <CardHeader>
        <div className="flex justify-between items-start gap-4 flex-wrap">
          <div>
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Inbox className="h-4.5 w-4.5 text-[#b48c3c]" />
              Failed Sends (Dead-Letter Queue)
            </CardTitle>
            <CardDescription className="text-xs">
              Emails and texts that failed permanently after automatic retries. Replaying
              re-checks consent and suppression first, so an opted-out lead won&apos;t be
              messaged.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setLoading(true);
              loadRows(filter);
            }}
            disabled={loading}
            className="gap-1.5 h-8 text-xs shrink-0"
          >
            <RefreshCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <div className="flex items-center gap-1.5 pt-3 flex-wrap">
          {FILTERS.map((f) => {
            const n = f === "ALL" ? Object.values(counts).reduce((a, b) => a + b, 0) : counts[f] || 0;
            return (
              <button
                key={f}
                type="button"
                onClick={() => {
                  if (f === filter) return;
                  setLoading(true);
                  setFilter(f);
                }}
                className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors ${
                  filter === f
                    ? "bg-[#0F3B3D] text-white"
                    : "bg-slate-100 dark:bg-slate-900/60 text-muted-foreground hover:bg-slate-200 dark:hover:bg-slate-800"
                }`}
              >
                {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
                <span className="ml-1.5 opacity-70 tabular-nums">{n}</span>
              </button>
            );
          })}
          {pending > 0 && filter !== "PENDING" && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400 ml-1">
              {pending} still awaiting action
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0 overflow-x-auto">
        {loading ? (
          <div className="p-8 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">
            {filter === "PENDING"
              ? "Nothing has failed permanently — the queue is clear."
              : `No ${filter.toLowerCase()} entries.`}
          </p>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900/40 border-b border-border/50">
                <th className="py-2.5 px-4 font-semibold text-muted-foreground pl-6">Recipient</th>
                <th className="py-2.5 px-4 font-semibold text-muted-foreground">Source</th>
                <th className="py-2.5 px-4 font-semibold text-muted-foreground">Error</th>
                <th className="py-2.5 px-4 font-semibold text-muted-foreground">Failed</th>
                <th className="py-2.5 px-4 font-semibold text-muted-foreground">Status</th>
                <th className="py-2.5 px-4 font-semibold text-muted-foreground text-right pr-6">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOpen = expanded === r.id;
                return (
                  // Fragment (not <>) so the row + its detail row share one key.
                  <Fragment key={r.id}>
                    <tr className="border-b border-border/30 hover:bg-slate-50/40 dark:hover:bg-slate-900/10">
                      <td className="py-2.5 px-4 pl-6">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : r.id)}
                          className="flex items-center gap-2 text-left"
                        >
                          {isOpen ? (
                            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                          )}
                          {r.channel === "SMS" ? (
                            <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <span className="font-medium text-slate-800 dark:text-slate-200">
                            {r.payload?.to || "—"}
                          </span>
                        </button>
                      </td>
                      <td className="py-2.5 px-4">
                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                          {r.source}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4 text-muted-foreground max-w-[240px] truncate" title={r.error}>
                        {r.error}
                      </td>
                      <td className="py-2.5 px-4 text-muted-foreground whitespace-nowrap">
                        {new Date(r.createdAt).toLocaleDateString()}
                        {r.attempts > 1 && (
                          <span className="ml-1.5 text-[10px] opacity-70">
                            ×{r.attempts}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        <Badge
                          className={`text-[9px] border-none ${
                            STATUS_STYLES[r.status] || "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {r.status}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4 text-right pr-6 whitespace-nowrap">
                        {r.status === "PENDING" ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busyId === r.id}
                              onClick={() => act(r.id, "replay")}
                              className="h-7 text-[10px] gap-1 text-emerald-600 hover:bg-emerald-500/10"
                            >
                              {busyId === r.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Send className="h-3 w-3" />
                              )}
                              Replay
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={busyId === r.id}
                              onClick={() => act(r.id, "discard")}
                              title="Discard — stop tracking this failure"
                              className="h-7 w-7 text-muted-foreground hover:bg-slate-500/10"
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">
                            {r.replayedAt
                              ? new Date(r.replayedAt).toLocaleDateString()
                              : "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-border/30">
                        <td colSpan={6} className="bg-slate-50/60 dark:bg-slate-900/30 px-6 py-3">
                          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[10px]">
                            {r.payload?.subject && (
                              <>
                                <dt className="font-semibold text-muted-foreground">Subject</dt>
                                <dd>{r.payload.subject}</dd>
                              </>
                            )}
                            {r.payload?.body && (
                              <>
                                <dt className="font-semibold text-muted-foreground">Message</dt>
                                <dd className="font-mono whitespace-pre-wrap">{r.payload.body}</dd>
                              </>
                            )}
                            <dt className="font-semibold text-muted-foreground">Error</dt>
                            <dd className="text-red-600 dark:text-red-400 break-words">{r.error}</dd>
                            <dt className="font-semibold text-muted-foreground">Attempts</dt>
                            <dd className="tabular-nums">{r.attempts}</dd>
                            {r.refId && (
                              <>
                                <dt className="font-semibold text-muted-foreground">Ref</dt>
                                <dd className="font-mono">{r.refId}</dd>
                              </>
                            )}
                          </dl>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
