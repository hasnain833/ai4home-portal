"use client";

import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Calendar, Clock } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { B2B_API, sendJson } from "@/lib/b2b-store";

type SalesAgentAppointment = {
  id: string;
  name: string;
  email: string;
  phone: string;
  preferredTime: string;
  status: string;
  source: "BOTPRESS" | "CAMPAIGN";
  campaignName: string | null;
  startTime: string | null;
  createdAt: string;
};

type Availability = {
  dayStart: string;
  dayEnd: string;
  slotDuration: number;
  bufferMinutes: number;
  workingDays: string;
  timezone: string;
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CAMPAIGN_STATUSES = ["CONFIRMED", "COMPLETED", "NO_SHOW", "CANCELLED"];
const STATUS_STYLES: Record<string, string> = {
  CONFIRMED: "bg-green-500/10 text-green-600",
  COMPLETED: "bg-sky-500/10 text-sky-600",
  NO_SHOW: "bg-amber-500/10 text-amber-600",
  CANCELLED: "bg-zinc-500/10 text-zinc-500",
};
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

export default function SalesAgentAppointmentsPage() {
  const [appointments, setAppointments] = useState<SalesAgentAppointment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setAppointments(await apiFetch<SalesAgentAppointment[]>("/api/admin/sales-agent-appointments"));
    } catch (error) {
      console.error("Failed to load appointments:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    load();
  }, [load]);

  const setStatus = async (id: string, status: string) => {
    try {
      await sendJson(`/api/admin/sales-agent-appointments/${id}/status`, "PATCH", { status });
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Appointments</h1>
        <p className="text-muted-foreground mt-2">
          Meetings booked with the platform team, from the website Botpress agent or from a business-lead campaign.
        </p>
      </div>

      <AvailabilityCard />

      <Card className="border border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle>Recent Bookings</CardTitle>
          <CardDescription>Each booking is tagged with where it came from: Botpress or the campaign&apos;s name.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : appointments.length === 0 ? (
            <div className="py-12 text-center flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg bg-zinc-50 dark:bg-zinc-900/50">
              <Calendar className="h-8 w-8 mb-3 opacity-20" />
              <p>No appointments booked yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 font-medium rounded-tl-lg">Date Booked</th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Contact</th>
                    <th className="px-4 py-3 font-medium">Source</th>
                    <th className="px-4 py-3 font-medium">Time</th>
                    <th className="px-4 py-3 font-medium rounded-tr-lg">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {appointments.map((apt) => (
                    <tr key={apt.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        {format(new Date(apt.createdAt), "MMM d, yyyy h:mm a")}
                      </td>
                      <td className="px-4 py-3 font-medium">{apt.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <div>{apt.email}</div>
                        <div className="text-xs">{apt.phone}</div>
                      </td>
                      <td className="px-4 py-3">
                        {apt.source === "CAMPAIGN" ? (
                          <span className="inline-flex max-w-[180px] items-center truncate px-2 py-1 rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-400 text-xs font-medium" title={apt.campaignName || "Campaign"}>
                            {apt.campaignName || "Campaign"}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400 text-xs font-medium">
                            Botpress
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-1 rounded-md bg-[#b48c3c]/10 text-[#b48c3c] text-xs font-medium whitespace-nowrap">
                          {apt.startTime ? format(new Date(apt.startTime), "EEE, MMM d · h:mm a") : apt.preferredTime}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {apt.source === "CAMPAIGN" ? (
                          <select
                            value={apt.status}
                            onChange={(e) => setStatus(apt.id, e.target.value)}
                            className={`rounded-full border-0 px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${STATUS_STYLES[apt.status] || ""}`}
                          >
                            {CAMPAIGN_STATUSES.map((s) => (
                              <option key={s} value={s} className="bg-background text-foreground">
                                {s.replace("_", " ")}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 rounded-full bg-green-500/10 text-green-500 text-[10px] font-bold uppercase tracking-wider">
                            {apt.status}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** The platform team's bookable hours, offered on the booking link in campaign messages. */
function AvailabilityCard() {
  const [form, setForm] = useState<Availability | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<Availability>(`${B2B_API}/availability`)
      .then(setForm)
      .catch((e) => toast.error(errorMessage(e)));
  }, []);

  if (!form) return null;
  const days = form.workingDays.split(",");
  const toggleDay = (d: string) =>
    setForm({ ...form, workingDays: DAYS.filter((x) => (x === d ? !days.includes(d) : days.includes(x))).join(",") });

  const save = async () => {
    setSaving(true);
    try {
      setForm(await sendJson<Availability>(`${B2B_API}/availability`, "PUT", form));
      toast.success("Availability saved.");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border border-border/80 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Clock className="h-4 w-4 text-[#b48c3c]" /> Meeting availability
        </CardTitle>
        <CardDescription>
          The times business leads can pick from the booking link in campaign emails and texts. Booked slots disappear automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => toggleDay(d)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                days.includes(d) ? "border-[#b48c3c] bg-[#b48c3c]/10 text-[#b48c3c]" : "border-border text-muted-foreground"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-5">
          <div className="space-y-1.5">
            <Label className="text-xs">From</Label>
            <Input type="time" value={form.dayStart} onChange={(e) => setForm({ ...form, dayStart: e.target.value })} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">To</Label>
            <Input type="time" value={form.dayEnd} onChange={(e) => setForm({ ...form, dayEnd: e.target.value })} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Meeting length (min)</Label>
            <Input type="number" min={10} max={240} value={form.slotDuration} onChange={(e) => setForm({ ...form, slotDuration: Number(e.target.value) })} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Gap between (min)</Label>
            <Input type="number" min={0} max={120} value={form.bufferMinutes} onChange={(e) => setForm({ ...form, bufferMinutes: Number(e.target.value) })} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Time zone</Label>
            <select
              value={form.timezone}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {Intl.supportedValuesOf("timeZone").map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>
        </div>
        <Button size="sm" className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" disabled={saving} onClick={save}>
          Save availability
        </Button>
      </CardContent>
    </Card>
  );
}
