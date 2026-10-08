"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, ChevronRight, MapPin, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatVisit, jobStage, type TradeJob } from "@/components/trade/jobs";

export default function TradeJobsPage() {
  const [jobs, setJobs] = useState<TradeJob[] | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"open" | "closed">("open");

  useEffect(() => {
    fetch("/api/trade/jobs")
      .then(async (r) => (r.ok ? setJobs(await r.json()) : Promise.reject()))
      .catch(() => setError("Could not load your jobs."));
  }, []);

  const open = (jobs || []).filter((j) => j.status === "DISPATCHED");
  const closed = (jobs || []).filter((j) => j.status === "RESOLVED");
  const shown = tab === "open" ? open : closed;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">My Jobs</h1>
        <Tabs value={tab} onValueChange={(v) => setTab(v as "open" | "closed")}>
          <TabsList>
            <TabsTrigger value="open">Open ({open.length})</TabsTrigger>
            <TabsTrigger value="closed">Closed ({closed.length})</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!jobs && !error && (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />)}</div>
      )}

      {jobs && shown.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Wrench className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">{tab === "open" ? "No open jobs" : "No closed jobs yet"}</p>
          {tab === "open" && <p className="text-sm mt-1">New jobs show here when a builder dispatches one to you.</p>}
        </div>
      )}

      <div className="space-y-3">
        {shown.map((job) => {
          const stage = jobStage(job);
          return (
            <Link key={job.id} href={`/trade/jobs/${job.id}`} className="block">
              <Card className="hover:border-[#0F3B3D]/40 transition-colors">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{job.ref}</span>
                      <span className="font-semibold">{job.issueType}</span>
                      {(job.isEmergency || job.priority === "URGENT") && <Badge variant="destructive">Urgent</Badge>}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stage.className}`}>{stage.label}</span>
                    </div>
                    <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{job.address || "No address"}</span>
                    </p>
                    <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                      {job.companyName && <span>{job.companyName}</span>}
                      {job.nextVisit && (
                        <span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />{formatVisit(job.nextVisit.scheduledAt)}</span>
                      )}
                      {job.workDoneAt && (
                        <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />Done {new Date(job.workDoneAt).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
