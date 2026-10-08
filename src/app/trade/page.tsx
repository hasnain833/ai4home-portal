"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CalendarCheck, CalendarClock, CheckCircle2, ChevronRight, Clock, MapPin, Wrench } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatVisit, type TradeJob } from "@/components/trade/jobs";

export default function TradeOverviewPage() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<TradeJob[] | null>(null);
  // What the trade still has to do in Calendly: connect it, or pick the event type.
  const [calendlyTodo, setCalendlyTodo] = useState<"connect" | "event-type" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/trade/jobs")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setJobs)
      .catch(() => setError("Could not load your jobs."));
    fetch("/api/trade/calendly")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) =>
        setCalendlyTodo(!s?.available ? null : !s.connected ? "connect" : !s.eventType ? "event-type" : null),
      )
      .catch(() => {});
  }, []);

  const open = (jobs || []).filter((j) => j.status === "DISPATCHED");
  const upcoming = open
    .filter((j) => j.nextVisit && !j.workDoneAt)
    .sort((a, b) => a.nextVisit!.scheduledAt.localeCompare(b.nextVisit!.scheduledAt));
  const stats = [
    { label: "Open jobs", value: open.length, icon: Wrench },
    { label: "Visits booked", value: upcoming.length, icon: CalendarClock },
    { label: "Waiting for homeowner", value: open.filter((j) => !j.nextVisit && !j.workDoneAt).length, icon: Clock },
    { label: "Awaiting sign-off", value: open.filter((j) => j.workDoneAt).length, icon: CheckCircle2 },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Welcome{user?.name ? `, ${user.name.split(" ")[0]}` : ""}</h1>
        <p className="text-muted-foreground mt-1">Your warranty jobs across every builder you work with.</p>
      </div>

      {calendlyTodo && (
        <Card className="border-[#E8B86B]/50 bg-[#E8B86B]/5">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-sm flex items-start gap-2">
              <CalendarCheck className="h-5 w-5 shrink-0 text-[#b48c3c]" />
              {calendlyTodo === "connect"
                ? "Connect your Calendly so homeowners book your visits from your real openings."
                : "Pick which Calendly event type homeowners book. Until you do, they book from the builder's hours, not your Calendly."}
            </p>
            <Button asChild size="sm" className="bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 shrink-0">
              <Link href="/trade/settings">{calendlyTodo === "connect" ? "Connect Calendly" : "Pick event type"}</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <s.icon className="h-5 w-5 text-[#0F3B3D] dark:text-[#E8B86B]" />
              <p className="text-3xl font-bold mt-2">{jobs ? s.value : "–"}</p>
              <p className="text-sm text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Upcoming visits</CardTitle>
          <Link href="/trade/jobs" className="text-sm text-muted-foreground hover:text-foreground">All jobs</Link>
        </CardHeader>
        <CardContent className="space-y-2">
          {jobs && upcoming.length === 0 && <p className="text-sm text-muted-foreground">No visits booked yet.</p>}
          {upcoming.slice(0, 5).map((job) => (
            <Link
              key={job.id}
              href={`/trade/jobs/${job.id}`}
              className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {formatVisit(job.nextVisit!.scheduledAt)} · {job.issueType}
                </p>
                <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                  <MapPin className="h-3 w-3 shrink-0" />
                  {job.address || "No address"}
                  {job.companyName ? ` · ${job.companyName}` : ""}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
