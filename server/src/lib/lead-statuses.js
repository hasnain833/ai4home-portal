
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

export function normalizeLeadStatuses(input) {
  if (!Array.isArray(input)) return null;
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    const label = String(raw ?? "").trim().slice(0, 40);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= 30) break;
  }
  return out.length ? out : null;
}

export function resolveLeadStatuses(company) {
  const configured = normalizeLeadStatuses(company?.leadStatuses);
  return configured || DEFAULT_LEAD_STATUSES;
}
