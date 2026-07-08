"use client";

import { useEffect, useState, use } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { CalendarDays, Video, CheckCircle2, XCircle } from "lucide-react";

type Slot = { iso: string; label: string };
type ManageData = {
  appointment: { id: string; title: string; time: string; meetingLink?: string | null; cancelToken: string; status: string };
  company: { name: string };
  timezone: string;
  slots: Slot[];
};

function splitLabel(label: string) {
  const idx = label.indexOf(" at ");
  if (idx === -1) return { day: label, time: label };
  return { day: label.slice(0, idx), time: label.slice(idx + 4) };
}

export default function ManageBookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const confirm = useConfirm();
  const [data, setData] = useState<ManageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [mode, setMode] = useState<"view" | "reschedule">("view");
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"rescheduled" | "cancelled" | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const res = await fetch(`/api/sales/scheduling/public/manage/${token}`);
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
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const reschedule = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/sales/scheduling/public/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, startTime: selected }),
      });
      const r = await res.json();
      if (!res.ok) {
        setError(res.status === 409 ? "That time was just taken. Please pick another." : r.message || r.reason || "Reschedule failed");
        if (res.status === 409) load();
        return;
      }
      setResult("rescheduled");
    } catch {
      setError("Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!data) return;
    if (!(await confirm({
      title: "Cancel appointment?",
      description: "This will cancel your appointment. You can always book again later.",
      confirmText: "Cancel appointment",
      cancelText: "Keep it",
    }))) return;
    setBusy(true);
    try {
      const res = await fetch("/api/sales/scheduling/public/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data.appointment.cancelToken }),
      });
      if (res.ok) setResult("cancelled");
      else setError("Cancel failed.");
    } catch {
      setError("Cancel failed.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Shell><p className="text-slate-400 text-sm py-20 text-center">Loading…</p></Shell>;
  if (notFound || !data)
    return (
      <Shell>
        <p className="text-slate-500 text-sm py-20 text-center">This link is no longer valid.</p>
      </Shell>
    );

  if (result === "cancelled")
    return (
      <Shell companyName={data.company.name}>
        <div className="text-center py-12">
          <XCircle className="h-14 w-14 text-slate-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-[#0F3B3D]">Appointment cancelled</h2>
          <p className="text-slate-500 mt-2">Reply to our email anytime to rebook.</p>
        </div>
      </Shell>
    );

  if (result === "rescheduled")
    return (
      <Shell companyName={data.company.name}>
        <div className="text-center py-12">
          <CheckCircle2 className="h-14 w-14 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-[#0F3B3D]">Rescheduled!</h2>
          <p className="text-slate-500 mt-2">We&apos;ve sent you an updated confirmation.</p>
        </div>
      </Shell>
    );

  const fmt = new Date(data.appointment.time).toLocaleString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

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
      <h2 className="text-lg font-bold text-[#0F3B3D] dark:text-white flex items-center gap-2">
        <CalendarDays className="h-5 w-5 text-[#b48c3c]" /> {data.appointment.title}
      </h2>
      <p className="text-sm text-slate-500 mt-1">
        Currently scheduled for <strong>{fmt}</strong>
      </p>
      {data.appointment.meetingLink && (
        <a
          href={data.appointment.meetingLink}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-[#b48c3c] mt-2"
        >
          <Video className="h-3.5 w-3.5" /> Join Google Meet
        </a>
      )}

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 my-4">{error}</p>}

      {mode === "view" ? (
        <div className="flex gap-2 mt-6">
          <button
            onClick={() => setMode("reschedule")}
            className="flex-1 bg-[#0F3B3D] text-white py-2.5 rounded-lg font-semibold text-sm"
          >
            Reschedule
          </button>
          <button
            onClick={cancel}
            disabled={busy}
            className="flex-1 border border-red-200 text-red-600 py-2.5 rounded-lg font-semibold text-sm disabled:opacity-50"
          >
            Cancel appointment
          </button>
        </div>
      ) : (
        <>
          <p className="text-xs font-bold text-slate-500 mt-6 mb-2">Pick a new time</p>
          {groups.length === 0 ? (
            <p className="text-slate-400 text-sm py-6 text-center">No other times available right now.</p>
          ) : (
            <div className="space-y-4 max-h-[45vh] overflow-y-auto pr-1">
              {groups.map((g) => (
                <div key={g.day}>
                  <p className="text-xs font-semibold text-slate-500 mb-2">{g.day}</p>
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
          <div className="flex gap-2 mt-5">
            <button onClick={() => setMode("view")} className="flex-1 border border-slate-200 py-2.5 rounded-lg text-sm font-semibold">
              Back
            </button>
            <button
              onClick={reschedule}
              disabled={!selected || busy}
              className="flex-1 bg-[#b48c3c] text-white py-2.5 rounded-lg font-semibold text-sm disabled:opacity-50"
            >
              {busy ? "Saving…" : "Confirm new time"}
            </button>
          </div>
        </>
      )}
    </Shell>
  );
}

function Shell({ children, companyName }: { children: React.ReactNode; companyName?: string }) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-lg border border-slate-100 dark:border-slate-800 overflow-hidden">
        <div className="bg-[#0F3B3D] px-8 py-5 border-b-4 border-[#b48c3c]">
          <h1 className="text-white font-bold text-lg">{companyName || "Manage Booking"}</h1>
        </div>
        <div className="p-8">{children}</div>
      </div>
    </div>
  );
}
