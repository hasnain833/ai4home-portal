"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Plus, X, MapPin, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { apiFetch, ApiError } from "@/lib/api";

type Appointment = {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  tradeName: string | null;
  tradeEmail: string | null;
  location: string | null;
  notes: string | null;
  notice?: string;
};

const STATUS_STYLES: Record<Appointment["status"], string> = {
  SCHEDULED: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400",
  COMPLETED: "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-900/40 dark:text-slate-400",
  CANCELLED: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/20 dark:text-rose-400",
};

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * Repair visits for one ticket. Staff and admins can book and cancel; everyone
 * else sees the schedule read-only.
 */
export function TicketAppointments({
  ticketId,
  canSchedule,
}: {
  ticketId: string;
  canSchedule: boolean;
}) {
  const [items, setItems] = useState<Appointment[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [scheduledAt, setScheduledAt] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [tradeName, setTradeName] = useState("");
  const [tradeEmail, setTradeEmail] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<Appointment[]>(
        `/api/ticket-appointments?ticketId=${encodeURIComponent(ticketId)}`,
        { credentials: "include" },
      );
      setItems(data);
    } catch {
      // The ticket page still works without the schedule; stay quiet.
    }
  }, [ticketId]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const data = await apiFetch<Appointment[]>(
          `/api/ticket-appointments?ticketId=${encodeURIComponent(ticketId)}`,
          { credentials: "include" },
        );
        if (!cancelled) setItems(data);
      } catch {
        // Ignore — see load().
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  const resetForm = () => {
    setScheduledAt("");
    setDurationMinutes("60");
    setTradeName("");
    setTradeEmail("");
    setLocation("");
    setNotes("");
  };

  const submit = async () => {
    if (!scheduledAt) {
      toast.error("Pick a date and time for the visit.");
      return;
    }
    setSaving(true);
    try {
      const created = await apiFetch<Appointment>("/api/ticket-appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ticketId,
          scheduledAt: new Date(scheduledAt).toISOString(),
          durationMinutes: Number(durationMinutes) || 60,
          tradeName,
          tradeEmail,
          location,
          notes,
        }),
      });

      // The booking succeeded either way — the notice only says whether the
      // homeowner and trade were emailed as well as notified in the portal.
      if (created.notice) toast.warning(created.notice);
      else toast.success("Appointment scheduled. Both sides have been notified.");

      resetForm();
      setShowForm(false);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not schedule the appointment.",
      );
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (id: string) => {
    try {
      const updated = await apiFetch<Appointment>(`/api/ticket-appointments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "CANCELLED" }),
      });
      if (updated.notice) toast.warning(updated.notice);
      else toast.success("Appointment cancelled. Both sides have been notified.");
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not cancel the appointment.",
      );
    }
  };

  return (
    <Card className="border-slate-200/60 dark:border-slate-800/60 shadow-xs overflow-hidden bg-white/70 dark:bg-slate-900/60 backdrop-blur-md">
      <div className="border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/40 py-4 px-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10 text-primary">
            <CalendarClock className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-lg font-bold">Repair Visits</CardTitle>
            <p className="text-xs text-muted-foreground">
              Appointments between the trade and the homeowner
            </p>
          </div>
        </div>
        {canSchedule && (
          <Button size="sm" variant={showForm ? "ghost" : "default"} onClick={() => setShowForm((v) => !v)}>
            {showForm ? <X className="h-4 w-4" /> : <><Plus className="h-4 w-4 mr-1" /> Schedule</>}
          </Button>
        )}
      </div>

      <CardContent className="p-6 space-y-5">
        {showForm && canSchedule && (
          <div className="space-y-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="appt-when">Date &amp; time</Label>
                <Input
                  id="appt-when"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="appt-duration">Duration (minutes)</Label>
                <Input
                  id="appt-duration"
                  type="number"
                  min={15}
                  step={15}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="appt-trade">Trade / crew name</Label>
                <Input
                  id="appt-trade"
                  placeholder="e.g. Bright Spark Electrical"
                  value={tradeName}
                  onChange={(e) => setTradeName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="appt-trade-email">Trade email (optional)</Label>
                <Input
                  id="appt-trade-email"
                  type="email"
                  placeholder="Also send reminders here"
                  value={tradeEmail}
                  onChange={(e) => setTradeEmail(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="appt-location">Location (optional)</Label>
              <Input
                id="appt-location"
                placeholder="Defaults to the property address"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="appt-notes">Notes (optional)</Label>
              <Textarea
                id="appt-notes"
                rows={2}
                placeholder="Anything the homeowner or trade should know"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); resetForm(); }}>
                Cancel
              </Button>
              <Button size="sm" onClick={submit} disabled={saving}>
                {saving ? "Scheduling…" : "Schedule visit"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Both the homeowner and the trade are notified now, and reminded 24 hours
              and 1 hour before the visit.
            </p>
          </div>
        )}

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No visits scheduled yet
            {canSchedule ? " — use Schedule to book one." : "."}
          </p>
        ) : (
          <ul className="space-y-3">
            {items.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200/70 dark:border-slate-800/60 p-4"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{formatWhen(a.scheduledAt)}</span>
                    <Badge variant="outline" className={STATUS_STYLES[a.status]}>
                      {a.status.toLowerCase()}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{a.durationMinutes} min</span>
                  </div>
                  {a.tradeName && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Wrench className="h-3 w-3 shrink-0" /> {a.tradeName}
                    </p>
                  )}
                  {a.location && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3 shrink-0" /> {a.location}
                    </p>
                  )}
                  {a.notes && <p className="text-xs text-muted-foreground">{a.notes}</p>}
                </div>
                {canSchedule && a.status === "SCHEDULED" && (
                  <Button variant="ghost" size="sm" onClick={() => cancel(a.id)}>
                    Cancel visit
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default TicketAppointments;
