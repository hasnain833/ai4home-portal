"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Calendar } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { sendJson } from "@/lib/b2b-store";

type SalesAgentAppointment = {
  id: string;
  name: string;
  email: string;
  phone: string;
  preferredTime: string;
  status: string;
  source: "BOTPRESS" | "CAMPAIGN" | "WEBSITE_SALES";
  notifications?: { adminSentAt: string | null; visitorSentAt: string | null; adminSmsSentAt: string | null; visitorSmsSentAt: string | null; lastError: string | null } | null;
  campaignName: string | null;
  startTime: string | null;
  createdAt: string;
};

const CAMPAIGN_STATUSES = ["PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW", "CANCELLED"];
const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-amber-500/10 text-amber-600",
  CONFIRMED: "bg-green-500/10 text-green-600",
  COMPLETED: "bg-sky-500/10 text-sky-600",
  NO_SHOW: "bg-amber-500/10 text-amber-600",
  CANCELLED: "bg-zinc-500/10 text-zinc-500",
};
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

export default function SalesAgentAppointmentsPage() {
  const [appointments, setAppointments] = useState<SalesAgentAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState<SalesAgentAppointment | null>(null);
  const [meetingTime, setMeetingTime] = useState("");
  const [savingMeeting, setSavingMeeting] = useState(false);

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
    const appointment = appointments.find((item) => item.id === id);
    if (status === "CONFIRMED" && appointment && !appointment.startTime) {
      setMeetingTime("");
      setConfirming(appointment);
      return;
    }
    try {
      await sendJson(`/api/admin/sales-agent-appointments/${id}/status`, "PATCH", { status });
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const confirmMeeting = async () => {
    const start = new Date(meetingTime);
    if (!confirming || !meetingTime || !Number.isFinite(start.getTime())) return;
    setSavingMeeting(true);
    try {
      await sendJson(`/api/admin/sales-agent-appointments/${confirming.id}/status`, "PATCH", { status: "CONFIRMED", startTime: start.toISOString() });
      setConfirming(null);
      await load();
      toast.success("Meeting confirmed and time reserved.");
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setSavingMeeting(false); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Appointments</h1>
        <p className="text-muted-foreground mt-2">
          Consultation requests and meetings with the platform team, from the website sales assistant, legacy Botpress agent, or a business-lead campaign.
        </p>
      </div>

      <CalendlyCard />

      <Card className="border border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle>Requests & Appointments</CardTitle>
          <CardDescription>Each booking is tagged with where it came from: Website Sales, Botpress, or the campaign&apos;s name.</CardDescription>
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
                        {new Date(apt.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                      </td>
                      <td className="px-4 py-3 font-medium">{apt.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <div>{apt.email}</div>
                        <div className="text-xs">{apt.phone}</div>
                      </td>
                      <td className="px-4 py-3">
                        {apt.source !== "BOTPRESS" ? (
                          <span className="inline-flex max-w-45 items-center truncate px-2 py-1 rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-400 text-xs font-medium" title={apt.source === "WEBSITE_SALES" ? "Website Sales" : apt.campaignName || "Campaign"}>
                            {apt.source === "WEBSITE_SALES" ? "Website Sales" : apt.campaignName || "Campaign"}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400 text-xs font-medium">
                            Botpress
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-1 rounded-md bg-[#b48c3c]/10 text-[#b48c3c] text-xs font-medium whitespace-nowrap">
                          {apt.startTime ? new Date(apt.startTime).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : apt.preferredTime}
                        </span>
                        {apt.notifications && <p className="mt-1 text-xs text-muted-foreground" title={apt.notifications.lastError || undefined}>
                          Email: {apt.notifications.adminSentAt && apt.notifications.visitorSentAt ? "sent to both" : "pending"} · SMS: {apt.notifications.adminSmsSentAt && apt.notifications.visitorSmsSentAt ? "sent to both" : "pending"}
                          {apt.notifications.lastError ? " (retry queued)" : ""}
                        </p>}
                      </td>
                      <td className="px-4 py-3">
                        {apt.source !== "BOTPRESS" ? (
                          <Select value={apt.status} onValueChange={(status) => setStatus(apt.id, status)}>
                            <SelectTrigger size="sm" aria-label={`Appointment status for ${apt.name}`} className={`w-auto min-w-36 rounded-full border-transparent text-xs font-semibold ${STATUS_STYLES[apt.status] || ""}`}><SelectValue /></SelectTrigger>
                            <SelectContent align="start">{CAMPAIGN_STATUSES.map((status) => <SelectItem key={status} value={status}>{status.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                          </Select>
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
      <Dialog open={!!confirming} onOpenChange={(open) => { if (!open && !savingMeeting) setConfirming(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm consultation</DialogTitle>
            <DialogDescription>Choose the time agreed with {confirming?.name}. This reserves the time in the platform calendar. Contact the visitor directly to confirm the arrangements.</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Requested: {confirming?.preferredTime}</p>
          <Label htmlFor="consultation-time">Agreed time ({Intl.DateTimeFormat().resolvedOptions().timeZone})</Label>
          <Input id="consultation-time" type="datetime-local" value={meetingTime} onChange={(event) => setMeetingTime(event.target.value)} disabled={savingMeeting} />
          <DialogFooter>
            <Button variant="outline" disabled={savingMeeting} onClick={() => setConfirming(null)}>Cancel</Button>
            <Button disabled={!meetingTime || savingMeeting} onClick={() => void confirmMeeting()}>Confirm and reserve time</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type CalendlyState = {
  available: boolean;
  connected: boolean;
  email?: string | null;
  eventType?: { uri: string; name: string; duration: number } | null;
  eventTypes?: { uri: string; name: string; duration: number }[];
  schedule?: { name: string; timezone: string | null; days: { day: string; intervals: string[] }[] } | null;
  webhook?: boolean;
};

const CALENDLY_API = "/api/admin/platform-calendly";
const WEEK = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/** The Calendly account every platform booking uses: booking links, the B2B agent and website chat. */
function CalendlyCard() {
  const [state, setState] = useState<CalendlyState | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await apiFetch<CalendlyState>(CALENDLY_API);
      setState(next);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("calendly");
    if (result === "connected") toast.success("Calendly connected.");
    if (result === "failed") toast.error("Calendly couldn't be connected. Please try again.");
    if (result) window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const connect = () =>
    run(async () => {
      const { url } = await sendJson<{ url: string }>(`${CALENDLY_API}/connect`, "POST", {});
      window.location.href = url;
    });

  if (!state) return null;
  const days = new Map((state.schedule?.days || []).map((d) => [d.day, d.intervals]));

  return (
    <Card className="border border-border/80 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Calendar className="h-4 w-4 text-[#b48c3c]" /> Calendly
        </CardTitle>
        <CardDescription>
          Booking links, the B2B agent and the website chat offer the open times from this Calendly account and book them there.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!state.connected ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border p-4">
            <p className="text-sm text-muted-foreground">
              {state.available
                ? "Not connected. Until it is, booking keeps using the previous fixed hours (Mon–Fri, 9 AM–5 PM Eastern, 30 minutes)."
                : "Calendly isn't set up on this portal yet (CALENDLY_CLIENT_ID and CALENDLY_CLIENT_SECRET). Until it is, booking keeps using the previous fixed hours."}
            </p>
            {state.available && (
              <Button size="sm" className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" disabled={busy} onClick={connect}>
                {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Connect Calendly
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">
                Connected as <span className="font-medium">{state.email || "your Calendly account"}</span>
              </p>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => run(() => sendJson(CALENDLY_API, "DELETE"))}>
                Disconnect
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="calendly-event-type" className="text-xs">Meeting type to book</Label>
                <Select
                  value={state.eventType?.uri || ""}
                  onValueChange={(uri) => run(() => sendJson(`${CALENDLY_API}/event-type`, "PUT", { uri }))}
                  disabled={busy}
                >
                  <SelectTrigger id="calendly-event-type" className="h-9"><SelectValue placeholder="Choose a Calendly event type" /></SelectTrigger>
                  <SelectContent>
                    {(state.eventTypes || []).map((t) => (
                      <SelectItem key={t.uri} value={t.uri}>{t.name} ({t.duration} min)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!state.eventType && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">Choose a meeting type. Until then, booking keeps using the previous fixed hours.</p>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">
                    {state.schedule?.name || "Hours"}{state.schedule?.timezone ? ` · ${state.schedule.timezone.replace(/_/g, " ")}` : ""}
                  </span>
                  <a href="https://calendly.com/app/availability/schedules" target="_blank" rel="noreferrer" className="text-xs font-medium text-[#b48c3c] hover:underline">
                    Edit hours in Calendly ↗
                  </a>
                </div>
                <div className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-0.5 rounded-lg border border-border p-3 text-xs">
                  {WEEK.map((d) => (
                    <div key={d} className="contents">
                      <span className="capitalize text-muted-foreground">{d}</span>
                      <span>{days.get(d)?.length ? days.get(d)!.join(", ") : <span className="text-muted-foreground">Unavailable</span>}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">Calendly&apos;s API can read these hours but not change them; edits made in Calendly show here.</p>
              </div>
            </div>

            {state.webhook === false && (
              <p className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                Calendly didn&apos;t accept our update subscription (it needs a paid Calendly plan). Bookings still work, but cancellations and reschedules made in Calendly won&apos;t show here.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
