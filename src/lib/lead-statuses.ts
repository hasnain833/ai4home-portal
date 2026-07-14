export const DEFAULT_LEAD_STATUSES = [
  "New",
  "Nurturing",
  "Engaged",
  "Appointment Set",
  "Qualified",
  "Closed Won",
  "Closed Lost",
  "Unsubscribed",
];

const FALLBACK_PALETTE = [
  "bg-blue-50 text-blue-700 border-blue-200/50 dark:bg-blue-900/20 dark:text-blue-300",
  "bg-slate-50 text-slate-700 border-slate-200/50 dark:bg-slate-900/20 dark:text-slate-300",
  "bg-amber-50 text-amber-700 border-amber-200/50 dark:bg-amber-900/20 dark:text-amber-300",
  "bg-purple-50 text-purple-700 border-purple-200/50 dark:bg-purple-900/20 dark:text-purple-300",
  "bg-emerald-50 text-emerald-700 border-emerald-200/50 dark:bg-emerald-900/20 dark:text-emerald-300",
  "bg-cyan-50 text-cyan-700 border-cyan-200/50 dark:bg-cyan-900/20 dark:text-cyan-300",
  "bg-rose-50 text-rose-700 border-rose-200/50 dark:bg-rose-900/20 dark:text-rose-300",
];

const KNOWN_STATUS_COLORS: Record<string, string> = {
  New: "bg-blue-50 text-blue-700 border-blue-200/50 dark:bg-blue-900/20 dark:text-blue-300",
  Nurturing: "bg-slate-50 text-slate-700 border-slate-200/50 dark:bg-slate-900/20 dark:text-slate-300",
  Engaged: "bg-amber-50 text-amber-700 border-amber-200/50 dark:bg-amber-900/20 dark:text-amber-300",
  "Appointment Set": "bg-purple-50 text-purple-700 border-purple-200/50 dark:bg-purple-900/20 dark:text-purple-300",
  Qualified: "bg-emerald-50 text-emerald-700 border-emerald-200/50 dark:bg-emerald-900/20 dark:text-emerald-300",
  "Closed Won": "bg-green-50 text-green-700 border-green-200/50 dark:bg-green-900/20 dark:text-green-300",
  "Closed Lost": "bg-rose-50 text-rose-700 border-rose-200/50 dark:bg-rose-900/20 dark:text-rose-300",
  Unsubscribed: "bg-gray-50 text-gray-700 border-gray-200/50 dark:bg-gray-900/20 dark:text-gray-300",
};

export function statusColor(status: string, index?: number): string {
  if (KNOWN_STATUS_COLORS[status]) return KNOWN_STATUS_COLORS[status];
  let hash = 0;
  for (let i = 0; i < status.length; i++) hash = (hash * 31 + status.charCodeAt(i)) & 0xffff;
  const idx = index !== undefined ? index : hash;
  return FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length];
}

export function resolveLeadStatuses(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    const cleaned = raw
      .map((s) => String(s ?? "").trim())
      .filter(Boolean);
    if (cleaned.length) return cleaned;
  }
  return DEFAULT_LEAD_STATUSES;
}
