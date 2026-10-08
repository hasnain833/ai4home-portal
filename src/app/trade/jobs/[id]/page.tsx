"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Building2, CalendarClock, CheckCircle2, Loader2, Mail, MapPin, Phone, StickyNote, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { formatVisit, jobStage, type TradeJob } from "@/components/trade/jobs";

type JobDetail = TradeJob & { photos?: { id: string; url: string | null; fileName: string }[] };

export default function TradeJobPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Bumped after marking done to refetch.
  const [version, setVersion] = useState(0);
  const load = () => setVersion((v) => v + 1);

  useEffect(() => {
    fetch(`/api/trade/jobs/${id}`).then(async (r) => {
      if (r.ok) setJob(await r.json());
      else setError(r.status === 404 ? "This job isn't assigned to you." : "Could not load this job.");
    });
  }, [id, version]);

  const markDone = async () => {
    setSaving(true);
    setError("");
    const r = await fetch(`/api/trade/jobs/${id}/done`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    const data = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) return setError(data.message || "Could not mark this job done.");
    load();
  };

  if (error && !job) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">{error}</p>
        <Link href="/trade/jobs" className="text-sm underline mt-3 inline-block">Back to my jobs</Link>
      </div>
    );
  }
  if (!job) {
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const stage = jobStage(job);
  const canMarkDone = job.status === "DISPATCHED" && !job.workDoneAt;

  return (
    <div className="space-y-5">
      <Link href="/trade/jobs" className="text-sm text-muted-foreground inline-flex items-center gap-1.5 hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> My jobs
      </Link>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-muted-foreground">{job.ref}</span>
          {(job.isEmergency || job.priority === "URGENT") && <Badge variant="destructive">Urgent</Badge>}
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stage.className}`}>{stage.label}</span>
        </div>
        <h1 className="text-2xl font-bold">{job.issueType}</h1>
        {job.companyName && (
          <p className="text-sm text-muted-foreground flex items-center gap-1.5">
            <Building2 className="h-4 w-4" /> For {job.companyName}
            {job.companyPhone && <> · <a href={`tel:${job.companyPhone}`} className="underline">{job.companyPhone}</a></>}
          </p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Visit</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="flex items-start gap-2"><MapPin className="h-4 w-4 mt-0.5 shrink-0" />{job.address || "No address on file"}</p>
            <p className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 shrink-0" />
              {job.nextVisit ? formatVisit(job.nextVisit.scheduledAt) : "The homeowner hasn't picked a time yet"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Homeowner</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="flex items-center gap-2"><User className="h-4 w-4 shrink-0" />{job.homeowner.name || "Homeowner"}</p>
            {job.homeowner.phone && (
              <p className="flex items-center gap-2"><Phone className="h-4 w-4 shrink-0" /><a href={`tel:${job.homeowner.phone}`} className="underline">{job.homeowner.phone}</a></p>
            )}
            {job.homeowner.email && (
              <p className="flex items-center gap-2"><Mail className="h-4 w-4 shrink-0" /><a href={`mailto:${job.homeowner.email}`} className="underline break-all">{job.homeowner.email}</a></p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">The issue</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="whitespace-pre-wrap">{job.description || "No description given."}</p>
          {job.dispatchNotes && (
            <div className="rounded-lg border bg-amber-50 dark:bg-amber-950/30 p-3 flex gap-2">
              <StickyNote className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
              <div><p className="font-medium">Notes from the builder</p><p className="whitespace-pre-wrap">{job.dispatchNotes}</p></div>
            </div>
          )}
          {!!job.photos?.length && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {job.photos.map((p) =>
                p.url ? (
                  <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                    <img src={p.url} alt={p.fileName} className="aspect-square w-full object-cover rounded-lg border" />
                  </a>
                ) : null,
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Finish the job</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {job.workDoneAt ? (
            <div className="flex gap-2 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <div>
                <p className="font-medium">Marked done {new Date(job.workDoneAt).toLocaleString()}</p>
                {job.workDoneNotes && <p className="whitespace-pre-wrap text-foreground mt-1">{job.workDoneNotes}</p>}
                {job.status === "DISPATCHED" && <p className="text-muted-foreground mt-1">The builder will check it and close the claim.</p>}
              </div>
            </div>
          ) : canMarkDone ? (
            <>
              <Textarea rows={3} placeholder="What did you fix? (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
              {error && <p className="text-red-600">{error}</p>}
              <Button onClick={markDone} disabled={saving} className="bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Mark work done
              </Button>
            </>
          ) : (
            <p className="text-muted-foreground">This claim is closed.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
