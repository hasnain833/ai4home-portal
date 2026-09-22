"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, MapPin, Wrench, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

// `datetime-local` works in local time, so both the field's value and its
// minimum have to be shifted out of UTC first.
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

const localNow = () => toLocalInput(new Date().toISOString());

/**
 * Repair visits for one ticket. Visits are booked by dispatching the ticket from
 * the tickets list, so this card only moves or calls off what is already booked.
 * Everyone else sees the schedule read-only.
 *
 * `ticketClosed` freezes the card: once the claim is resolved the work is done,
 * so there is nothing left to move or call off.
 */
export function TicketAppointments({
  ticketId,
  canSchedule,
  ticketClosed = false,
}: {
  ticketId: string;
  canSchedule: boolean;
  ticketClosed?: boolean;
}) {
  const [items, setItems] = useState<Appointment[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [scheduledAt, setScheduledAt] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("60");

  const canAct = canSchedule && !ticketClosed;

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

  const openReschedule = (appointment: Appointment) => {
    setEditingId(appointment.id);
    setScheduledAt(toLocalInput(appointment.scheduledAt));
    setDurationMinutes(String(appointment.durationMinutes || 60));
  };

  const closeReschedule = () => {
    setEditingId(null);
    setScheduledAt("");
    setDurationMinutes("60");
  };

  const reschedule = async (id: string) => {
    if (!scheduledAt) {
      toast.error("Pick a new date and time for the visit.");
      return;
    }
    if (new Date(scheduledAt).getTime() <= Date.now()) {
      toast.error("The new time has to be in the future.");
      return;
    }
    setSaving(true);
    try {
      const updated = await apiFetch<Appointment>(`/api/ticket-appointments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          scheduledAt: new Date(scheduledAt).toISOString(),
          durationMinutes: Number(durationMinutes) || 60,
        }),
      });

      // The move succeeded either way — the notice only says whether the
      // homeowner and staff member were emailed as well as notified in the portal.
      if (updated.notice) toast.warning(updated.notice);
      else toast.success("Visit moved. Both sides have been emailed the new time.");

      closeReschedule();
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not move the appointment.",
      );
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (id: string) => {
    setBusyId(id);
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
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card className="border-slate-200/60 dark:border-slate-800/60 shadow-xs overflow-hidden bg-white/70 dark:bg-slate-900/60 backdrop-blur-md">
      <div className="border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/40 py-4 px-6 flex items-center gap-3">
        <div className="p-2 rounded-xl bg-primary/10 text-primary">
          <CalendarClock className="h-5 w-5" />
        </div>
        <div>
          <CardTitle className="text-lg font-bold">Repair Visits</CardTitle>
          <p className="text-xs text-muted-foreground">
            Appointments between the assigned staff member and the homeowner
          </p>
        </div>
      </div>

      <CardContent className="p-6 space-y-5">
        {ticketClosed && items.length > 0 && (
          <p className="text-xs text-muted-foreground">
            This claim is resolved — its visits are closed and can no longer be moved or
            cancelled.
          </p>
        )}

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No visits scheduled yet
            {canAct ? " — dispatch this ticket from the tickets list to book one." : "."}
          </p>
        ) : (
          <ul className="space-y-3">
            {items.map((a) => (
              <li
                key={a.id}
                className="rounded-xl border border-slate-200/70 dark:border-slate-800/60 p-4 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
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

                  {canAct && a.status === "SCHEDULED" && (
                    <div className="flex items-center gap-1.5">
                      {editingId === a.id ? (
                        <Button variant="ghost" size="sm" onClick={closeReschedule}>
                          <X className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => openReschedule(a)}>
                          Reschedule
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyId === a.id}
                        onClick={() => cancel(a.id)}
                      >
                        {busyId === a.id ? "Cancelling…" : "Cancel visit"}
                      </Button>
                    </div>
                  )}
                </div>

                {canAct && editingId === a.id && a.status === "SCHEDULED" && (
                  <div className="space-y-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor={`appt-when-${a.id}`}>New date &amp; time</Label>
                        <Input
                          id={`appt-when-${a.id}`}
                          type="datetime-local"
                          min={localNow()}
                          value={scheduledAt}
                          onChange={(e) => setScheduledAt(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`appt-duration-${a.id}`}>Duration (minutes)</Label>
                        <Input
                          id={`appt-duration-${a.id}`}
                          type="number"
                          min={15}
                          step={15}
                          value={durationMinutes}
                          onChange={(e) => setDurationMinutes(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={closeReschedule}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={() => reschedule(a.id)} disabled={saving}>
                        {saving ? "Saving…" : "Move visit"}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Both the homeowner and the assigned staff member are emailed the new
                      time, and reminded 24 hours and 1 hour before it.
                    </p>
                  </div>
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
