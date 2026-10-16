"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@/lib/use-query";
import { ArrowLeft, Mail, MessageSquare, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Period = "7d" | "30d" | "90d" | "180d";
type Tally = {
  sent: number;
  emailsSent: number;
  failed: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  booked: number;
};
type Metric = "sent" | "opened" | "clicked" | "replied" | "booked";
type Analytics = {
  campaign: { id: string; name: string; status: string; kind: string };
  days: number;
  funnel: Tally;
  steps: (Tally & { id: string; position: number; type: "EMAIL" | "SMS"; label: string; enabled: boolean })[];
  trend: ({ date: string } & Record<Metric, number>)[];
  timeToBook: { medianDays: number | null; bookings: number };
};

const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : "—");

const METRICS: { key: Metric; label: string }[] = [
  { key: "sent", label: "Sent" },
  { key: "opened", label: "Opened" },
  { key: "clicked", label: "Clicked" },
  { key: "replied", label: "Replied" },
  { key: "booked", label: "Booked" },
];

export default function CampaignAnalyticsPage() {
  const { id } = useParams<{ id: string }>();
  const [period, setPeriod] = useState<Period>("30d");
  const [metric, setMetric] = useState<Metric>("sent");
  const { data, loading, error, refresh } = useQuery<Analytics>(`/api/sales/campaigns/${id}/analytics?period=${period}`);
  const [refreshing, setRefreshing] = useState(false);
  const reload = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const f = data?.funnel;
  // Opens and clicks only exist for email, so their rates use emails sent.
  const funnel = f
    ? [
        { label: "Sent", value: f.sent, rate: "", base: f.sent },
        { label: "Delivered", value: f.delivered, rate: pct(f.delivered, f.sent), base: f.sent },
        { label: "Opened (email)", value: f.opened, rate: pct(f.opened, f.emailsSent), base: f.emailsSent },
        { label: "Clicked (email)", value: f.clicked, rate: pct(f.clicked, f.emailsSent), base: f.emailsSent },
        { label: "Replied", value: f.replied, rate: pct(f.replied, f.sent), base: f.sent },
        { label: "Booked", value: f.booked, rate: pct(f.booked, f.sent), base: f.sent },
      ]
    : [];
  const peak = Math.max(1, ...(data?.trend.map((p) => p[metric]) ?? [0]));

  return (
    <ProtectedRoute allowedRoles={["admin", "staff"]}>
      <PortalLayout workspace="sales">
        <div className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <Link href="/sales/campaigns" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-3.5 w-3.5" /> Campaigns
              </Link>
              <h1 className="font-serif text-3xl text-foreground">{data?.campaign.name ?? "Campaign analytics"}</h1>
              <p className="text-sm text-muted-foreground">How each message performed, from send to booking.</p>
            </div>
            <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={reload} disabled={refreshing} className="h-8 gap-2">
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing..." : "Refresh"}
            </Button>
            <div className="flex gap-1 rounded-lg bg-muted p-0.5">
              {(["7d", "30d", "90d", "180d"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                    period === p ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  {p.replace("d", " days")}
                </button>
              ))}
            </div>
            </div>
          </div>

          {error ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">{error.message}</CardContent>
            </Card>
          ) : loading || !data || !f ? (
            <Skeleton className="h-96 w-full rounded-xl" />
          ) : (
            <>
              <div className="grid gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-base">Funnel</CardTitle>
                    <CardDescription>Messages sent in the last {data.days} days and what happened next.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {funnel.map((row) => (
                      <div key={row.label} className="grid grid-cols-[8.5rem_1fr_4.5rem] items-center gap-3 text-sm">
                        <span className="text-muted-foreground">{row.label}</span>
                        <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-[#b48c3c]"
                            style={{ width: `${row.base > 0 ? (row.value / row.base) * 100 : 0}%` }}
                          />
                        </div>
                        <span className="text-right tabular-nums">
                          <strong className="text-foreground">{row.value.toLocaleString()}</strong>
                          {row.rate && <span className="ml-1.5 text-xs text-muted-foreground">{row.rate}</span>}
                        </span>
                      </div>
                    ))}
                    <p className="pt-2 text-xs text-muted-foreground">
                      Opens are approximate: Apple Mail pre-loads images and some links are checked by security scanners.
                      Replies and bookings are the reliable numbers.
                    </p>
                  </CardContent>
                </Card>

                <div className="grid gap-6">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>Median time to book</CardDescription>
                      <CardTitle className="text-3xl">
                        {data.timeToBook.medianDays === null ? "—" : `${data.timeToBook.medianDays} days`}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs text-muted-foreground">
                      From enrollment to booking, across {data.timeToBook.bookings} booking
                      {data.timeToBook.bookings === 1 ? "" : "s"}.
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>Failed or bounced</CardDescription>
                      <CardTitle className="text-3xl">{f.failed.toLocaleString()}</CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs text-muted-foreground">
                      Rejected by the provider, hard-bounced or undeliverable.
                    </CardContent>
                  </Card>
                </div>
              </div>

              <Card>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
                  <div>
                    <CardTitle className="text-base">Trend</CardTitle>
                    <CardDescription>Per day, by when it happened.</CardDescription>
                  </div>
                  <div className="flex gap-1 rounded-lg bg-muted p-0.5">
                    {METRICS.map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => setMetric(m.key)}
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                          metric === m.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex h-40 items-end gap-0.5 border-b border-border" role="img" aria-label={`${metric} per day`}>
                    {data.trend.map((p) => (
                      <div key={p.date} className="group relative flex h-full flex-1 items-end">
                        <div
                          className="w-full rounded-t bg-[#b48c3c] group-hover:bg-[#0F3B3D] dark:group-hover:bg-foreground"
                          style={{ height: `${(p[metric] / peak) * 100}%`, minHeight: p[metric] > 0 ? 2 : 0 }}
                        />
                        <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-hover:block">
                          {new Date(`${p.date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}:{" "}
                          <strong>{p[metric]}</strong>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                    <span>{data.trend[0]?.date}</span>
                    <span>Peak {peak}</span>
                    <span>{data.trend[data.trend.length - 1]?.date}</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Per step</CardTitle>
                  <CardDescription>Replies and bookings are credited to the last message the lead received.</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto p-0">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Step</th>
                        {["Sent", "Delivered", "Opened", "Clicked", "Replied", "Booked", "Failed"].map((h) => (
                          <th key={h} className="px-3 py-2 text-right font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.steps.map((s) => (
                        <tr key={s.id} className={`border-t border-border/60 ${s.enabled ? "" : "opacity-50"}`}>
                          <td className="max-w-xs px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              {s.type === "EMAIL" ? (
                                <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Email" />
                              ) : (
                                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="SMS" />
                              )}
                              <span className="truncate" title={s.label}>{s.label || `Step ${s.position}`}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{s.sent}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{pct(s.delivered, s.sent)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{s.type === "EMAIL" ? pct(s.opened, s.sent) : "—"}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{s.type === "EMAIL" ? pct(s.clicked, s.sent) : "—"}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{s.replied}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{s.booked}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{s.failed}</td>
                        </tr>
                      ))}
                      {data.steps.length === 0 && (
                        <tr>
                          <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">This campaign has no message steps.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
