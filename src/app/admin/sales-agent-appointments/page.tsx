"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Calendar, Clock } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, errorMessage } from "@/lib/api";
import { B2B_API, sendJson } from "@/lib/b2b-store";

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
  assignedUserId: string | null;
  createdAt: string;
};

type CalendarPerson = { userId: string; name: string | null; provider: "GOOGLE" | "OUTLOOK"; email: string | null; error: string | null };
type Calendars = { providers: { GOOGLE: boolean; OUTLOOK: boolean }; me: CalendarPerson | null; team: CalendarPerson[] };

const CALENDAR_API = "/api/admin/calendar";
const PROVIDER_NAMES = { GOOGLE: "Google Calendar", OUTLOOK: "Outlook" } as const;
const UNASSIGNED = "__team";

const CAMPAIGN_STATUSES = ["PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW", "CANCELLED"];
const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-amber-500/10 text-amber-600",
  CONFIRMED: "bg-green-500/10 text-green-600",
  COMPLETED: "bg-sky-500/10 text-sky-600",
  NO_SHOW: "bg-amber-500/10 text-amber-600",
  CANCELLED: "bg-zinc-500/10 text-zinc-500",
};

export default function SalesAgentAppointmentsPage() {
  const [appointments, setAppointments] = useState<SalesAgentAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState<SalesAgentAppointment | null>(null);
  const [meetingTime, setMeetingTime] = useState("");
  const [savingMeeting, setSavingMeeting] = useState(false);
  const [calendars, setCalendars] = useState<Calendars | null>(null);

  const loadCalendars = useCallback(async () => {
    try {
      setCalendars(await apiFetch<Calendars>(CALENDAR_API));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, []);

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
    const result = new URLSearchParams(window.location.search).get("calendar");
    if (result === "connected") toast.success("Calendar connected. New meetings assigned to you will appear in it.");
    if (result === "failed") toast.error("The calendar couldn't be connected. Please try again.");
    if (result) window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    load();
    void loadCalendars();
  }, [load, loadCalendars]);

  const setAssignee = async (id: string, value: string) => {
    try {
      await sendJson(`/api/admin/sales-agent-appointments/${id}/assignee`, "PATCH", { userId: value === UNASSIGNED ? null : value });
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const team = calendars?.team || [];
  const personName = (userId: string | null) => (userId ? team.find((p) => p.userId === userId)?.name || "Former team member" : "Whole team");

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

      <AvailabilityCard />

      <CalendarCard calendars={calendars} reload={loadCalendars} />

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
                    <th className="px-4 py-3 font-medium">Assigned to</th>
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
                        {apt.source !== "BOTPRESS" && team.length ? (
                          <Select value={apt.assignedUserId || UNASSIGNED} onValueChange={(value) => setAssignee(apt.id, value)}>
                            <SelectTrigger size="sm" aria-label={`Assigned person for ${apt.name}`} className="w-auto min-w-36 text-xs"><SelectValue>{personName(apt.assignedUserId)}</SelectValue></SelectTrigger>
                            <SelectContent align="start">
                              <SelectItem value={UNASSIGNED}>Whole team</SelectItem>
                              {team.map((p) => <SelectItem key={p.userId} value={p.userId}>{p.name || p.email || "Team member"}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-xs text-muted-foreground">{apt.source === "BOTPRESS" ? "—" : personName(apt.assignedUserId)}</span>
                        )}
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

type Availability = {
  dayStart: string;
  dayEnd: string;
  slotDuration: number;
  bufferMinutes: number;
  workingDays: string;
  timezone: string;
  meetingLink?: string;
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The platform team's bookable hours: offered on booking links, by the B2B agent and in website chat. */
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
          The times offered on booking links, by the B2B agent and in website chat. Booked meetings reserve their slots automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days.includes(d)}
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
            <Label htmlFor="availability-from" className="text-xs">From</Label>
            <Input id="availability-from" type="time" value={form.dayStart} onChange={(e) => setForm({ ...form, dayStart: e.target.value })} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="availability-to" className="text-xs">To</Label>
            <Input id="availability-to" type="time" value={form.dayEnd} onChange={(e) => setForm({ ...form, dayEnd: e.target.value })} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="availability-length" className="text-xs">Meeting length (min)</Label>
            <Input id="availability-length" type="number" min={10} max={240} value={form.slotDuration} onChange={(e) => setForm({ ...form, slotDuration: Number(e.target.value) })} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="availability-gap" className="text-xs">Gap between (min)</Label>
            <Input id="availability-gap" type="number" min={0} max={120} value={form.bufferMinutes} onChange={(e) => setForm({ ...form, bufferMinutes: Number(e.target.value) })} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="availability-timezone" className="text-xs">Time zone</Label>
            <Select value={form.timezone} onValueChange={(timezone) => setForm({ ...form, timezone })}>
              <SelectTrigger id="availability-timezone" className="h-9"><SelectValue placeholder="Select a time zone" /></SelectTrigger>
              <SelectContent align="start">{[...new Set([form.timezone, ...Intl.supportedValuesOf("timeZone")])].filter(Boolean).map((timezone) => <SelectItem key={timezone} value={timezone}>{timezone.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="availability-meeting-link" className="text-xs">Meeting link (optional, goes in invites and reminders)</Label>
          <Input id="availability-meeting-link" type="url" value={form.meetingLink || ""} onChange={(e) => setForm({ ...form, meetingLink: e.target.value })} placeholder="https://" className="h-9 text-sm" />
        </div>
        <Button size="sm" className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" disabled={saving} onClick={save}>
          {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save availability
        </Button>
      </CardContent>
    </Card>
  );
}

/** Your own Google or Outlook calendar: meetings assigned to you go into it, and its busy times block open slots. */
function CalendarCard({ calendars, reload }: { calendars: Calendars | null; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  if (!calendars) return null;
  const { me, team, providers } = calendars;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  };
  const connect = (provider: "GOOGLE" | "OUTLOOK") =>
    run(async () => {
      const { url } = await sendJson<{ url: string }>(`${CALENDAR_API}/connect`, "POST", { provider });
      window.location.href = url;
    });
  const disconnect = () =>
    run(async () => {
      await sendJson(CALENDAR_API, "DELETE");
      await reload();
      setBusy(false);
      toast.success("Calendar disconnected. Its AI4Home meetings were removed from it.");
    });
  const others = team.filter((p) => p.userId !== me?.userId);

  return (
    <Card className="border border-border/80 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Calendar className="h-4 w-4 text-[#b48c3c]" /> Your calendar
        </CardTitle>
        <CardDescription>
          Connect your Google or Outlook calendar. Busy times there are kept out of the open times, and each new meeting goes to a free team member and into their calendar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {me ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div className="text-sm">
              <p>
                Connected to <span className="font-medium">{PROVIDER_NAMES[me.provider]}</span>
                {me.email ? <span className="text-muted-foreground"> · {me.email}</span> : null}
              </p>
              {me.error && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{me.error} Until then you aren&apos;t offered for new meetings.</p>}
            </div>
            <div className="flex gap-2">
              {me.error && (
                <Button size="sm" className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" disabled={busy} onClick={() => connect(me.provider)}>
                  Reconnect
                </Button>
              )}
              <Button variant="outline" size="sm" disabled={busy} onClick={disconnect}>
                {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {(["GOOGLE", "OUTLOOK"] as const).map((provider) => (
              <Button key={provider} variant="outline" size="sm" disabled={busy || !providers[provider]} onClick={() => connect(provider)}>
                Connect {PROVIDER_NAMES[provider]}
              </Button>
            ))}
            {!providers.GOOGLE && !providers.OUTLOOK && (
              <p className="w-full text-xs text-muted-foreground">Calendar sign-in isn&apos;t set up on this portal yet (Google and Microsoft app keys).</p>
            )}
          </div>
        )}
        <div className="text-xs text-muted-foreground">
          {team.length === 0
            ? "No one has connected a calendar yet, so every meeting is with the whole team and only the hours above apply."
            : others.length
              ? `Also connected: ${others.map((p) => `${p.name || p.email || "Team member"} (${PROVIDER_NAMES[p.provider]}${p.error ? ", needs reconnecting" : ""})`).join(", ")}.`
              : "You're the only one connected, so new meetings go to you."}
        </div>
      </CardContent>
    </Card>
  );
}
