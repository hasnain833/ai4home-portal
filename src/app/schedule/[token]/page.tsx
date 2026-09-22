"use client";

import { useEffect, useState, use } from "react";
import { CalendarDays, CheckCircle2, MapPin, Wrench } from "lucide-react";
import { ScheduleShell, SlotPicker, type Slot } from "@/components/warranty/ScheduleShell";

type BookingData = {
  ticketId: string;
  issueType: string;
  address: string | null;
  homeownerName: string;
  staffName: string | null;
  companyName: string;
  timezone: string;
  slotDuration: number;
  slots: Slot[];
};

/**
 * Where a dispatched ticket's booking link lands. No account, no session — the
 * token in the URL is the whole of the authorisation.
 */
export default function TicketBookingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [data, setData] = useState<BookingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [booking, setBooking] = useState(false);
  const [confirmed, setConfirmed] = useState<{ label: string; manageToken: string } | null>(null);
  const [error, setError] = useState("");

  const loadSlots = async () => {
    const res = await fetch(`/api/ticket-scheduling/public/${token}`);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBlocked(payload.message || "This booking link is no longer valid.");
      return null;
    }
    setData(payload);
    return payload as BookingData;
  };

  useEffect(() => {
    (async () => {
      try {
        await loadSlots();
      } catch {
        setBlocked("We couldn't load your booking. Please try again shortly.");
      } finally {
        setLoading(false);
      }
    })();
    // The token is the page; nothing else can change what is loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const book = async () => {
    if (!selected) return;
    setBooking(true);
    setError("");
    try {
      const res = await fetch("/api/ticket-scheduling/public/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, startTime: selected }),
      });
      const result = await res.json().catch(() => ({}));

      if (!res.ok) {
        // 409 means somebody took the slot while this page was open — the times
        // on screen are stale, so they get refreshed rather than re-submitted.
        if (res.status === 409) {
          setError(result.message || "That time was just taken. Please pick another.");
          setSelected("");
          await loadSlots();
        } else {
          setError(result.message || "Could not book that time.");
        }
        return;
      }

      const slot = data?.slots.find((s) => s.iso === selected);
      setConfirmed({
        label: slot?.label || new Date(selected).toLocaleString(),
        manageToken: result.manageToken,
      });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBooking(false);
    }
  };

  if (loading) {
    return (
      <ScheduleShell>
        <p className="text-slate-400 text-sm py-20 text-center">Loading available times…</p>
      </ScheduleShell>
    );
  }

  if (blocked || !data) {
    return (
      <ScheduleShell>
        <p className="text-slate-500 text-sm py-20 text-center">
          {blocked || "This booking link is no longer valid."}
        </p>
      </ScheduleShell>
    );
  }

  if (confirmed) {
    return (
      <ScheduleShell companyName={data.companyName}>
        <div className="text-center py-10">
          <CheckCircle2 className="h-14 w-14 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-[#0F3B3D] dark:text-white">
            Your visit is booked
          </h2>
          <p className="text-slate-600 dark:text-slate-300 mt-2">{confirmed.label}</p>
          {data.staffName && (
            <p className="text-sm text-slate-500 mt-1">{data.staffName} will be attending.</p>
          )}
          <p className="text-xs text-slate-400 mt-6">
            A confirmation has been emailed to you. Need to change it?{" "}
            <a
              href={`/schedule/manage/${confirmed.manageToken}`}
              className="text-[#b48c3c] underline"
            >
              Manage your visit
            </a>
          </p>
        </div>
      </ScheduleShell>
    );
  }

  return (
    <ScheduleShell companyName={data.companyName}>
      <div className="mb-5">
        <h2 className="text-lg font-bold text-[#0F3B3D] dark:text-white flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-[#b48c3c]" /> Book your repair visit
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Hi {data.homeownerName}, pick a time that suits you. Times are shown in{" "}
          {data.timezone} and each visit is about {data.slotDuration} minutes.
        </p>
      </div>

      <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 p-3 mb-5 space-y-1.5">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
          {data.issueType}
        </p>
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

      <SlotPicker slots={data.slots} selected={selected} onSelect={setSelected} />

      <button
        onClick={book}
        disabled={!selected || booking}
        className="w-full mt-6 bg-[#b48c3c] text-white py-3 rounded-lg font-semibold text-sm disabled:opacity-50"
      >
        {booking ? "Booking…" : "Confirm Booking"}
      </button>
    </ScheduleShell>
  );
}
