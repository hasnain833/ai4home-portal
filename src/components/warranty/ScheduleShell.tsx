"use client";

import { Clock } from "lucide-react";

export type Slot = { iso: string; label: string };

// "Mon, Jul 7 at 2:00 PM EDT" -> { day: "Mon, Jul 7", time: "2:00 PM EDT" }
export function splitLabel(label: string) {
  const idx = label.indexOf(" at ");
  if (idx === -1) return { day: label, time: label };
  return { day: label.slice(0, idx), time: label.slice(idx + 4) };
}

/**
 * The frame for the two pages a homeowner reaches from an email. They have no
 * account and no portal chrome, so this carries the whole page on its own.
 */
export function ScheduleShell({
  children,
  companyName,
}: {
  children: React.ReactNode;
  companyName?: string;
}) {
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

/** The slot grid, shared by the booking page and the reschedule page. */
export function SlotPicker({
  slots,
  selected,
  onSelect,
}: {
  slots: Slot[];
  selected: string;
  onSelect: (iso: string) => void;
}) {
  const groups: { day: string; slots: { iso: string; time: string }[] }[] = [];
  for (const s of slots) {
    const { day, time } = splitLabel(s.label);
    let g = groups.find((x) => x.day === day);
    if (!g) {
      g = { day, slots: [] };
      groups.push(g);
    }
    g.slots.push({ iso: s.iso, time });
  }

  if (groups.length === 0) {
    return (
      <p className="text-slate-400 text-sm py-10 text-center">
        No times are currently available. Please reply to your email and we&apos;ll arrange
        one with you directly.
      </p>
    );
  }

  return (
    <div className="space-y-5 max-h-[50vh] overflow-y-auto pr-1">
      {groups.map((g) => (
        <div key={g.day}>
          <p className="text-xs font-bold text-slate-500 mb-2 flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" /> {g.day}
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {g.slots.map((slot) => (
              <button
                key={slot.iso}
                onClick={() => onSelect(slot.iso)}
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
  );
}
