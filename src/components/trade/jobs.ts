/** Shared by the trade portal pages. */

export interface TradeJob {
  id: string;
  ref: string;
  issueType: string;
  ticketType: string | null;
  description: string | null;
  priority: string;
  isEmergency: boolean;
  status: "DISPATCHED" | "RESOLVED";
  dispatchNotes: string | null;
  workDoneAt: string | null;
  workDoneNotes: string | null;
  createdAt: string;
  companyName: string | null;
  companyPhone: string | null;
  address: string | null;
  homeowner: { name: string | null; phone: string | null; email: string | null };
  nextVisit: { scheduledAt: string; durationMinutes: number } | null;
}

export const formatVisit = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Where the job stands, from the trade's side. */
export function jobStage(job: TradeJob) {
  if (job.status === "RESOLVED") return { label: "Closed", className: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" };
  if (job.workDoneAt) return { label: "Done, awaiting sign-off", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" };
  if (job.nextVisit) return { label: "Visit booked", className: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" };
  return { label: "Waiting for homeowner to book", className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" };
}
