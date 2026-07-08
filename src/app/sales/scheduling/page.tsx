"use client";

import { useState, useEffect, useCallback } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Clock, Save, RefreshCw, CheckCircle2, Link2, XCircle, Video } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const TIMEZONES = [
  { value: "America/New_York", label: "Eastern Time (ET)" },
  { value: "America/Chicago", label: "Central Time (CT)" },
  { value: "America/Denver", label: "Mountain Time (MT)" },
  { value: "America/Phoenix", label: "Arizona (MST)" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const APPOINTMENT_MODES = [
  { value: "AI", label: "AI conversational agent" },
  { value: "SIMPLE", label: "Send booking link only" },
  { value: "OFF", label: "Off (no auto-scheduling)" },
];

type Slot = { iso: string; label: string };
type Appointment = {
  id: string;
  leadId: string;
  title: string;
  time: string;
  status: string;
  locationType?: string;
  meetingLink?: string | null;
  lead?: { firstName?: string; lastName?: string; email?: string };
  agent?: { name?: string; email?: string };
};

export default function AppointmentsPage() {
  const [activeTab, setActiveTab] = useState<"list" | "settings">("list");

  const [settings, setSettings] = useState({
    dayStart: "09:00",
    dayEnd: "17:00",
    bufferMinutes: "15",
    slotDuration: "30",
    workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    timezone: "America/New_York",
    appointmentMode: "AI",
  });
  const [google, setGoogle] = useState({ connected: false, accountEmail: "", configured: false });
  const [savingSettings, setSavingSettings] = useState(false);

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loadingAppts, setLoadingAppts] = useState(true);

  const [reschedule, setReschedule] = useState<{
    open: boolean;
    appt: Appointment | null;
    slots: Slot[];
    selected: string;
    loading: boolean;
  }>({ open: false, appt: null, slots: [], selected: "", loading: false });

  // ─── Loaders ────────────────────────────────────────────────────────────────

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/sales/scheduling/settings");
      if (!res.ok) return;
      const data = await res.json();
      const s = data.setting || {};
      setSettings({
        dayStart: s.dayStart || "09:00",
        dayEnd: s.dayEnd || "17:00",
        bufferMinutes: String(s.bufferMinutes ?? 15),
        slotDuration: String(s.slotDuration ?? 30),
        workingDays: (s.workingDays || "Mon,Tue,Wed,Thu,Fri").split(",").map((d: string) => d.trim()),
        timezone: s.timezone || "America/New_York",
        appointmentMode: data.appointmentMode || "AI",
      });
      setGoogle({
        connected: !!data.integrations?.google?.connected,
        accountEmail: data.integrations?.google?.accountEmail || "",
        configured: !!data.googleConfigured,
      });
    } catch {
      /* ignore */
    }
  }, []);

  const loadAppointments = useCallback(async () => {
    setLoadingAppts(true);
    try {
      const res = await fetch("/api/sales/appointments");
      if (res.ok) setAppointments(await res.json());
    } catch {
      /* ignore */
    } finally {
      setLoadingAppts(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
    loadAppointments();
    // Surface the Google OAuth round-trip result and land on the settings tab.
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "settings") setActiveTab("settings");
    const g = params.get("google");
    if (g === "connected") toast.success("Google Calendar connected");
    else if (g === "denied") toast.error("Google connection was cancelled");
    else if (g === "error") toast.error("Could not connect Google Calendar");
    if (g) window.history.replaceState({}, "", window.location.pathname);
  }, [loadSettings, loadAppointments]);

  // ─── Actions ──────────────────────────────────────────────────────────────────

  const toggleDay = (day: string) =>
    setSettings((s) => ({
      ...s,
      workingDays: s.workingDays.includes(day)
        ? s.workingDays.filter((d) => d !== day)
        : [...s.workingDays, day],
    }));

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const res = await fetch("/api/sales/scheduling/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayStart: settings.dayStart,
          dayEnd: settings.dayEnd,
          bufferMinutes: Number(settings.bufferMinutes),
          slotDuration: Number(settings.slotDuration),
          workingDays: DAYS.filter((d) => settings.workingDays.includes(d)).join(","),
          timezone: settings.timezone,
          appointmentMode: settings.appointmentMode,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Save failed");
      toast.success("Availability settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingSettings(false);
    }
  };

  const connectGoogle = async () => {
    try {
      const res = await fetch("/api/sales/scheduling/google/connect");
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Could not start Google connection");
      window.location.href = data.url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google connect failed");
    }
  };

  const disconnectGoogle = async () => {
    try {
      const res = await fetch("/api/sales/scheduling/google/disconnect", { method: "POST" });
      if (!res.ok) throw new Error("Disconnect failed");
      setGoogle((g) => ({ ...g, connected: false, accountEmail: "" }));
      toast.success("Google Calendar disconnected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Disconnect failed");
    }
  };

  const openReschedule = async (appt: Appointment) => {
    setReschedule({ open: true, appt, slots: [], selected: "", loading: true });
    try {
      const res = await fetch(`/api/sales/scheduling/slots?leadId=${appt.leadId}&limit=24`);
      const data = await res.json();
      setReschedule((r) => ({ ...r, slots: data.slots || [], loading: false }));
    } catch {
      setReschedule((r) => ({ ...r, loading: false }));
    }
  };

  const doReschedule = async () => {
    if (!reschedule.appt || !reschedule.selected) return;
    try {
      const res = await fetch("/api/sales/scheduling/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId: reschedule.appt.id, startTime: reschedule.selected }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.reason || "Reschedule failed");
      toast.success("Appointment rescheduled");
      setReschedule({ open: false, appt: null, slots: [], selected: "", loading: false });
      loadAppointments();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reschedule failed");
    }
  };

  const confirm = useConfirm();

  const doCancel = async (appt: Appointment) => {
    if (!(await confirm({
      title: "Cancel appointment?",
      description: `Cancel "${appt.title}" with ${appt.lead?.firstName || "this lead"}?`,
      confirmText: "Cancel appointment",
      cancelText: "Keep it",
    }))) return;
    try {
      const res = await fetch("/api/sales/scheduling/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId: appt.id }),
      });
      if (!res.ok) throw new Error("Cancel failed");
      toast.success("Appointment cancelled");
      loadAppointments();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cancel failed");
    }
  };

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <ProtectedRoute allowedRoles={["admin", "staff"]}>
      <PortalLayout workspace="sales">
        <div className="space-y-6 max-w-7xl mx-auto">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
                Appointment Scheduling
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                Manage virtual and on-site model home visits, and coordinate agent hours.
              </p>
            </div>
            <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-xl">
              <Button
                variant={activeTab === "list" ? "default" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("list")}
                className="h-8 text-xs font-semibold rounded-lg"
              >
                Booked Slots
              </Button>
              <Button
                variant={activeTab === "settings" ? "default" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("settings")}
                className="h-8 text-xs font-semibold rounded-lg"
              >
                Availability Settings
              </Button>
            </div>
          </div>

          {activeTab === "list" ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-bold">Scheduled Visits</CardTitle>
                <Button variant="ghost" size="sm" onClick={loadAppointments} className="h-7 text-xs gap-1">
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh
                </Button>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-900 border-b text-xs font-semibold text-slate-400">
                      <th className="py-3 px-6">Lead Name</th>
                      <th className="py-3 px-4">Visit Type</th>
                      <th className="py-3 px-4">Time Slot</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Assigned Agent</th>
                      <th className="py-3 px-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingAppts ? (
                      <tr>
                        <td colSpan={6} className="py-10 text-center text-slate-400 text-xs">
                          Loading appointments…
                        </td>
                      </tr>
                    ) : appointments.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-10 text-center text-slate-400 text-xs">
                          No appointments booked yet.
                        </td>
                      </tr>
                    ) : (
                      appointments.map((appt) => (
                        <tr
                          key={appt.id}
                          className="border-b dark:border-slate-800 hover:bg-slate-50/20 dark:hover:bg-slate-900/10 transition"
                        >
                          <td className="py-3.5 px-6 font-semibold">
                            <div>
                              <p>
                                {appt.lead?.firstName} {appt.lead?.lastName}
                              </p>
                              <p className="text-[10px] text-slate-400 font-normal mt-0.5">{appt.lead?.email}</p>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-xs font-medium">
                            <div className="flex items-center gap-1.5">
                              {appt.locationType === "VIRTUAL" && <Video className="h-3.5 w-3.5 text-slate-400" />}
                              {appt.title}
                            </div>
                            {appt.meetingLink && (
                              <a
                                href={appt.meetingLink}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[10px] text-[#b48c3c] hover:underline"
                              >
                                Join link
                              </a>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-xs">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5 text-slate-400" /> {fmt(appt.time)}
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            <Badge
                              className={
                                appt.status === "CONFIRMED"
                                  ? "bg-green-50 text-green-700 border-green-200/50 dark:bg-green-950/20 dark:text-green-400"
                                  : "bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300"
                              }
                            >
                              {appt.status}
                            </Badge>
                          </td>
                          <td className="py-3.5 px-4 text-xs text-slate-500">{appt.agent?.name || "—"}</td>
                          <td className="py-3.5 px-6 text-right whitespace-nowrap">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openReschedule(appt)}
                              className="text-xs"
                            >
                              Reschedule
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => doCancel(appt)}
                              className="text-red-500 hover:bg-red-50 text-xs"
                            >
                              Cancel
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : (
            <Card className="max-w-xl border border-border/80 shadow-xs">
              <CardHeader className="border-b">
                <CardTitle className="text-sm font-bold">Define Work Hours & Time Zones</CardTitle>
                <CardDescription className="text-xs">
                  Used by the AI conversational agent and the public booking page to offer slots.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <form onSubmit={handleSaveSettings} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="startTime" className="font-semibold">
                        Day Starts At
                      </Label>
                      <Input
                        id="startTime"
                        type="time"
                        value={settings.dayStart}
                        onChange={(e) => setSettings((s) => ({ ...s, dayStart: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="endTime" className="font-semibold">
                        Day Ends At
                      </Label>
                      <Input
                        id="endTime"
                        type="time"
                        value={settings.dayEnd}
                        onChange={(e) => setSettings((s) => ({ ...s, dayEnd: e.target.value }))}
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="buffer" className="font-semibold">
                        Buffer Time (Minutes)
                      </Label>
                      <Input
                        id="buffer"
                        type="number"
                        min={0}
                        value={settings.bufferMinutes}
                        onChange={(e) => setSettings((s) => ({ ...s, bufferMinutes: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="duration" className="font-semibold">
                        Slot Length (Minutes)
                      </Label>
                      <Input
                        id="duration"
                        type="number"
                        min={5}
                        step={5}
                        value={settings.slotDuration}
                        onChange={(e) => setSettings((s) => ({ ...s, slotDuration: e.target.value }))}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="font-semibold">TimeZone</Label>
                    <Select
                      value={settings.timezone}
                      onValueChange={(val) => setSettings((s) => ({ ...s, timezone: val }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIMEZONES.map((tz) => (
                          <SelectItem key={tz.value} value={tz.value}>
                            {tz.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="font-semibold">Working Days</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {DAYS.map((day) => (
                        <button
                          key={day}
                          type="button"
                          onClick={() => toggleDay(day)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                            settings.workingDays.includes(day)
                              ? "bg-[#0F3B3D] text-white border-[#0F3B3D]"
                              : "bg-transparent text-slate-500 border-slate-200 dark:border-slate-700"
                          }`}
                        >
                          {day}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="font-semibold">When a lead replies, the agent should…</Label>
                    <Select
                      value={settings.appointmentMode}
                      onValueChange={(val) => setSettings((s) => ({ ...s, appointmentMode: val }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {APPOINTMENT_MODES.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="p-4 bg-slate-50 dark:bg-slate-900 border rounded-xl space-y-3">
                    <h4 className="font-bold text-xs">Calendar Integrations</h4>
                    <div className="flex items-center justify-between border-t dark:border-slate-800 pt-3 text-xs">
                      <div>
                        <span className="text-muted-foreground">Google Calendar</span>
                        {google.connected && google.accountEmail && (
                          <span className="ml-2 text-[10px] text-green-600">{google.accountEmail}</span>
                        )}
                      </div>
                      {google.connected ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={disconnectGoogle}
                          className="h-7 text-[10px] gap-1 text-red-500"
                        >
                          <XCircle className="h-3 w-3" /> Disconnect
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={connectGoogle}
                          disabled={!google.configured}
                          title={google.configured ? "" : "Google OAuth not configured on the server"}
                          className="h-7 text-[10px] gap-1"
                        >
                          <Link2 className="h-3 w-3" /> Connect
                        </Button>
                      )}
                    </div>
                    {google.connected && (
                      <p className="flex items-center gap-1 text-[10px] text-green-600">
                        <CheckCircle2 className="h-3 w-3" /> Two-way busy/free sync + Google Meet links active
                      </p>
                    )}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Microsoft Outlook 365</span>
                      <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled title="Coming soon">
                        Coming soon
                      </Button>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    disabled={savingSettings}
                    className="w-full bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90 gap-1.5 font-semibold"
                  >
                    <Save className="h-4 w-4" /> {savingSettings ? "Saving…" : "Save Availability Settings"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Reschedule dialog */}
        <Dialog
          open={reschedule.open}
          onOpenChange={(open) => setReschedule((r) => ({ ...r, open }))}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reschedule appointment</DialogTitle>
              <DialogDescription>
                Pick a new available slot for {reschedule.appt?.lead?.firstName} {reschedule.appt?.lead?.lastName}.
              </DialogDescription>
            </DialogHeader>
            {reschedule.loading ? (
              <p className="text-sm text-slate-400 py-6 text-center">Loading available slots…</p>
            ) : reschedule.slots.length === 0 ? (
              <p className="text-sm text-slate-400 py-6 text-center">
                No available slots. Check your availability settings.
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto grid grid-cols-2 gap-2 py-2">
                {reschedule.slots.map((slot) => (
                  <button
                    key={slot.iso}
                    type="button"
                    onClick={() => setReschedule((r) => ({ ...r, selected: slot.iso }))}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border text-left transition ${
                      reschedule.selected === slot.iso
                        ? "bg-[#0F3B3D] text-white border-[#0F3B3D]"
                        : "border-slate-200 dark:border-slate-700 hover:border-[#b48c3c]"
                    }`}
                  >
                    {slot.label}
                  </button>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setReschedule({ open: false, appt: null, slots: [], selected: "", loading: false })}
              >
                Cancel
              </Button>
              <Button
                onClick={doReschedule}
                disabled={!reschedule.selected}
                className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90"
              >
                Confirm reschedule
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PortalLayout>
    </ProtectedRoute>
  );
}
