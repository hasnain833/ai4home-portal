"use client";

import { useEffect, useState, use } from "react";
import { CalendarDays, Clock, Video, CheckCircle2 } from "lucide-react";

type Slot = { iso: string; label: string };
type BookingData = {
  lead: { firstName: string; lastName: string };
  company: { name: string };
  timezone: string;
  slotDuration: number;
  slots: Slot[];
};

// "Mon, Jul 7 at 2:00 PM EDT" -> { day: "Mon, Jul 7", time: "2:00 PM EDT" }
function splitLabel(label: string) {
  const idx = label.indexOf(" at ");
  if (idx === -1) return { day: label, time: label };
  return { day: label.slice(0, idx), time: label.slice(idx + 4) };
}

export default function PublicBookingPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = use(params);
  const [data, setData] = useState<BookingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const [booking, setBooking] = useState(false);
  const [confirmed, setConfirmed] = useState<{ label: string; meetingLink?: string | null; manageToken: string } | null>(
    null
  );
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/sales/scheduling/public/lead/${leadId}`);
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        setData(await res.json());
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [leadId]);

  const book = async () => {
    if (!selected) return;
    setBooking(true);
    setError("");
    try {
      const res = await fetch("/api/sales/scheduling/public/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, startTime: selected, locationType: "VIRTUAL", title: "Model Home Visit" }),
      });
      const result = await res.json();
      if (!res.ok) {
        // 409 = slot just taken; refresh availability.
        if (res.status === 409) {
          setError("Sorry, that time was just taken. Please pick another.");
          const refresh = await fetch(`/api/sales/scheduling/public/lead/${leadId}`);
          if (refresh.ok) setData(await refresh.json());
          setSelected("");
        } else {
          setError(result.reason || result.message || "Could not book that slot.");
        }
        return;
      }
      const slot = data?.slots.find((s) => s.iso === selected);
      setConfirmed({
        label: slot?.label || new Date(selected).toLocaleString(),
        meetingLink: result.appointment?.meetingLink,
        manageToken: result.appointment?.manageToken,
      });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBooking(false);
    }
  };

  if (loading) {
    return <Shell><p className="text-slate-400 text-sm py-20 text-center">Loading available times…</p></Shell>;
  }
  if (notFound || !data) {
    return (
      <Shell>
        <p className="text-slate-500 text-sm py-20 text-center">
          This booking link is no longer valid. Please contact us directly.
        </p>
      </Shell>
    );
  }

  if (confirmed) {
    return (
      <Shell companyName={data.company.name}>
        <div className="text-center py-10">
          <CheckCircle2 className="h-14 w-14 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-[#0F3B3D]">You&apos;re booked!</h2>
          <p className="text-slate-600 mt-2">{confirmed.label}</p>
          {confirmed.meetingLink && (
            <a
              href={confirmed.meetingLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 mt-5 bg-[#b48c3c] text-white px-5 py-2.5 rounded-lg font-semibold text-sm"
            >
              <Video className="h-4 w-4" /> Join Google Meet
            </a>
          )}
          <p className="text-xs text-slate-400 mt-6">
            A confirmation has been sent to you. Need to change it?{" "}
            <a href={`/book/manage/${confirmed.manageToken}`} className="text-[#b48c3c] underline">
              Manage booking
            </a>
          </p>
        </div>
      </Shell>
    );
  }

  // Group slots by day (label is already in the correct timezone).
  const groups: { day: string; slots: { iso: string; time: string }[] }[] = [];
  for (const s of data.slots) {
    const { day, time } = splitLabel(s.label);
    let g = groups.find((x) => x.day === day);
    if (!g) {
      g = { day, slots: [] };
      groups.push(g);
    }
    g.slots.push({ iso: s.iso, time });
  }

  return (
    <Shell companyName={data.company.name}>
      <div className="mb-5">
        <h2 className="text-lg font-bold text-[#0F3B3D] dark:text-white flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-[#b48c3c]" /> Book your visit
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Hi {data.lead.firstName}, pick a time that works for you. Times shown in your local timezone ({data.timezone}).
          Each visit is {data.slotDuration} minutes.
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

function Shell({ children, companyName }: { children: React.ReactNode; companyName?: string }) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-lg border border-slate-100 dark:border-slate-800 overflow-hidden">
        <div className="bg-[#0F3B3D] px-8 py-5 border-b-4 border-[#b48c3c]">
          <h1 className="text-white font-bold text-lg">{companyName || "Schedule a Visit"}</h1>
        </div>
        <div className="p-8">{children}</div>
      </div>
    </div>
  );
}
