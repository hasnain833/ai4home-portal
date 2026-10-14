"use client";

import { useCallback, useEffect, useState, use } from "react";
import { useSearchParams } from "next/navigation";
import { splitLabel } from "@/components/warranty/ScheduleShell";
import { CalendarDays, Clock, CheckCircle2 } from "lucide-react";

type Slot = { iso: string; label: string };
type BookingData = {
  lead: { contactName: string; companyName: string };
  timezone: string;
  slotDuration: number;
  existing: { label: string } | null;
  slots: Slot[];
};

/** Public page a business lead reaches from the booking link in a platform campaign message. */
export default function PlatformBookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const campaignId = useSearchParams().get("c");
  const [data, setData] = useState<BookingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selected, setSelected] = useState("");
  const [booking, setBooking] = useState(false);
  const [confirmed, setConfirmed] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/b2b/booking/${token}`);
      if (!res.ok) return setNotFound(true);
      setData(await res.json());
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    load();
  }, [load]);

  const book = async () => {
    if (!selected) return;
    setBooking(true);
    setError("");
    try {
      const res = await fetch(`/api/public/b2b/booking/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startTime: selected, campaignId }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(result.message || "Could not book that time.");
        if (res.status === 409) {
          setSelected("");
          await load();
        }
        return;
      }
      setConfirmed(result.label);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBooking(false);
    }
  };

  if (loading) return <Shell><p className="text-slate-400 text-sm py-20 text-center">Loading available times…</p></Shell>;
  if (notFound || !data) {
    return (
      <Shell>
        <p className="text-slate-500 text-sm py-20 text-center">This booking link is no longer valid. Please contact us directly.</p>
      </Shell>
    );
  }

  const done = confirmed || data.existing?.label;
  if (done) {
    return (
      <Shell>
        <div className="text-center py-10">
          <CheckCircle2 className="h-14 w-14 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-[#0F3B3D] dark:text-white">{confirmed ? "You're booked!" : "You already have a meeting with us"}</h2>
          <p className="text-slate-600 dark:text-slate-300 mt-2">{done}</p>
          <p className="text-xs text-slate-400 mt-6">A confirmation was sent to your email. Need to change it? Just reply to that email.</p>
        </div>
      </Shell>
    );
  }

  const groups: { day: string; slots: { iso: string; time: string }[] }[] = [];
  for (const s of data.slots) {
    const { day, time } = splitLabel(s.label);
    let g = groups.find((x) => x.day === day);
    if (!g) groups.push((g = { day, slots: [] }));
    g.slots.push({ iso: s.iso, time });
  }

  return (
    <Shell>
      <div className="mb-5">
        <h2 className="text-lg font-bold text-[#0F3B3D] dark:text-white flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-[#b48c3c]" /> Book a call with our team
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Hi {data.lead.contactName.split(" ")[0] || data.lead.companyName}, pick a time that works for you. Each call is {data.slotDuration}{" "}
          minutes. Times are shown in {data.timezone.replace(/_/g, " ")}.
        </p>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">{error}</p>}

      {groups.length === 0 ? (
        <p className="text-slate-400 text-sm py-10 text-center">No times are currently available. Please check back soon.</p>
      ) : (
        <div className="space-y-5 max-h-[55vh] overflow-y-auto pr-1">
          {groups.map((g) => (
            <div key={g.day}>
              <p className="text-xs font-bold text-slate-500 mb-2 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" /> {g.day}
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {g.slots.map((slot) => (
                  <button
                    key={slot.iso}
                    onClick={() => setSelected(slot.iso)}
                    className={`px-2 py-2 rounded-lg text-xs font-medium border transition ${
                      selected === slot.iso
                        ? "bg-[#0F3B3D] text-white border-[#0F3B3D]"
                        : "border-slate-200 dark:border-slate-700 hover:border-[#b48c3c]"
                    }`}
                  >
                    {slot.time}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={book}
        disabled={!selected || booking}
        className="w-full mt-6 bg-[#b48c3c] text-white py-3 rounded-lg font-semibold text-sm disabled:opacity-50"
      >
        {booking ? "Booking…" : "Confirm Booking"}
      </button>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-lg border border-slate-100 dark:border-slate-800 overflow-hidden">
        <div className="bg-[#0F3B3D] px-8 py-5 border-b-4 border-[#b48c3c]">
          <h1 className="text-white font-bold text-lg">Aiforhomebuilder</h1>
        </div>
        <div className="p-8">{children}</div>
      </div>
    </div>
  );
}
