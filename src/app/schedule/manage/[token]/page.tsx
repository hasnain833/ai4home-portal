"use client";

import { useEffect, useState, use } from "react";
import { CalendarClock, CheckCircle2, MapPin, Wrench, XCircle } from "lucide-react";
import { ScheduleShell, SlotPicker, type Slot } from "@/components/warranty/ScheduleShell";

type ManageData = {
  ticketId: string;
  issueType: string;
  address: string | null;
  homeownerName: string;
  staffName: string | null;
  companyName: string;
  scheduledAt: string;
  durationMinutes: number;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  closed: boolean;
  timezone: string | null;
  slotDuration: number | null;
  slots: Slot[];
};

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * Reached from the "change or cancel" button on every appointment email. This
 * is what makes the reminders actionable rather than just informational.
 */
export default function ManageVisitPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<ManageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "reschedule" | "confirmCancel">("view");
  const [selected, setSelected] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ kind: "moved" | "cancelled"; label?: string } | null>(null);

  const load = async () => {
    const res = await fetch(`/api/ticket-scheduling/public/manage/${token}`);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBlocked(payload.message || "This link is no longer valid.");
      return null;
    }
    setData(payload);
    return payload as ManageData;
  };

  useEffect(() => {
    (async () => {
      try {
        await load();
      } catch {
        setBlocked("We couldn't load your visit. Please try again shortly.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const reschedule = async () => {
    if (!selected) return;
    setWorking(true);
    setError("");
    try {
      const res = await fetch("/api/ticket-scheduling/public/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, startTime: selected }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) {
          setError(result.message || "That time was just taken. Please pick another.");
          setSelected("");
          await load();
        } else {
          setError(result.message || "Could not move that visit.");
        }
        return;
      }
      const slot = data?.slots.find((s) => s.iso === selected);
      setDone({ kind: "moved", label: slot?.label || formatWhen(selected) });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setWorking(false);
    }
  };

  const cancel = async () => {
    setWorking(true);
    setError("");
    try {
      const res = await fetch("/api/ticket-scheduling/public/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(result.message || "Could not cancel that visit.");
        return;
      }
      setDone({ kind: "cancelled" });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setWorking(false);
    }
  };

  if (loading) {
    return (
      <ScheduleShell>
        <p className="text-slate-400 text-sm py-20 text-center">Loading your visit…</p>
      </ScheduleShell>
    );
  }

  if (blocked || !data) {
    return (
      <ScheduleShell>
        <p className="text-slate-500 text-sm py-20 text-center">
          {blocked || "This link is no longer valid."}
        </p>
      </ScheduleShell>
    );
  }

  if (done) {
    return (
      <ScheduleShell companyName={data.companyName}>
        <div className="text-center py-10">
          {done.kind === "moved" ? (
            <>
              <CheckCircle2 className="h-14 w-14 text-green-500 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-[#0F3B3D] dark:text-white">Visit moved</h2>
              <p className="text-slate-600 dark:text-slate-300 mt-2">{done.label}</p>
            </>
          ) : (
            <>
              <XCircle className="h-14 w-14 text-slate-400 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-[#0F3B3D] dark:text-white">Visit cancelled</h2>
              <p className="text-slate-600 dark:text-slate-300 mt-2">
                We&apos;ve let the team know. They&apos;ll be in touch to rebook.
              </p>
            </>
          )}
          <p className="text-xs text-slate-400 mt-6">A confirmation has been emailed to you.</p>
        </div>
      </ScheduleShell>
    );
  }

  if (data.closed) {
    return (
      <ScheduleShell companyName={data.companyName}>
        <div className="text-center py-12">
          <CalendarClock className="h-12 w-12 text-slate-300 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-[#0F3B3D] dark:text-white">
            {data.status === "CANCELLED" ? "This visit was cancelled" : "This visit is closed"}
          </h2>
          <p className="text-sm text-slate-500 mt-2">
            {data.status === "CANCELLED"
              ? "Nothing further is scheduled. Please contact us if you still need a visit."
              : "This claim is complete, so the visit can no longer be changed."}
          </p>
        </div>
      </ScheduleShell>
    );
  }

  return (
    <ScheduleShell companyName={data.companyName}>
      <div className="mb-5">
        <h2 className="text-lg font-bold text-[#0F3B3D] dark:text-white flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-[#b48c3c]" /> Your repair visit
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Hi {data.homeownerName}, here&apos;s what&apos;s booked.
        </p>
      </div>

      <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 p-4 mb-5 space-y-1.5">
        <p className="text-base font-bold text-[#0F3B3D] dark:text-white">
          {formatWhen(data.scheduledAt)}
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-300">{data.issueType}</p>
        {data.staffName && (
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <Wrench className="h-3 w-3 shrink-0" /> {data.staffName}
          </p>
        )}
        {data.address && (
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <MapPin className="h-3 w-3 shrink-0" /> {data.address}
          </p>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 dark:bg-red-950/30 rounded-lg px-3 py-2 mb-4">
          {error}
        </p>
      )}

      {mode === "view" && (
        <div className="flex gap-3">
          <button
            onClick={() => setMode("reschedule")}
            className="flex-1 bg-[#0F3B3D] text-white py-3 rounded-lg font-semibold text-sm"
          >
            Pick a different time
          </button>
          <button
            onClick={() => setMode("confirmCancel")}
            className="flex-1 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 py-3 rounded-lg font-semibold text-sm"
          >
            Cancel visit
          </button>
        </div>
      )}

      {mode === "reschedule" && (
        <>
          <p className="text-xs font-bold text-slate-500 mb-3">
            Choose a new time{data.timezone ? ` (${data.timezone})` : ""}
          </p>
          <SlotPicker slots={data.slots} selected={selected} onSelect={setSelected} />
          <div className="flex gap-3 mt-6">
            <button
              onClick={() => {
                setMode("view");
                setSelected("");
                setError("");
              }}
              className="flex-1 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 py-3 rounded-lg font-semibold text-sm"
            >
              Keep current time
            </button>
            <button
              onClick={reschedule}
              disabled={!selected || working}
              className="flex-1 bg-[#b48c3c] text-white py-3 rounded-lg font-semibold text-sm disabled:opacity-50"
            >
              {working ? "Moving…" : "Move visit"}
            </button>
          </div>
        </>
      )}

      {mode === "confirmCancel" && (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
            Cancel this visit? We&apos;ll let {data.staffName || "the team"} know, and someone
            will be in touch to rebook.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => {
                setMode("view");
                setError("");
              }}
              className="flex-1 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 py-3 rounded-lg font-semibold text-sm"
            >
              Keep my visit
            </button>
            <button
              onClick={cancel}
              disabled={working}
              className="flex-1 bg-rose-600 text-white py-3 rounded-lg font-semibold text-sm disabled:opacity-50"
            >
              {working ? "Cancelling…" : "Yes, cancel it"}
            </button>
          </div>
        </>
      )}
    </ScheduleShell>
  );
}
