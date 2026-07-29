import { LEAD_STATUS } from "./lead-statuses.js";

export const INACTIVE_LEAD_STATUSES = [
  LEAD_STATUS.CLOSED_WON,
  LEAD_STATUS.UNSUBSCRIBED,
];

export function activeLeadFilter() {
  return {
    archived: false,
    status: { notIn: INACTIVE_LEAD_STATUSES },
  };
}

// A complete tenant-scoped `where` for active leads.
export function activeLeadWhere(companyId) {
  return { companyId, ...activeLeadFilter() };
}

export function withActiveLeadFilter(where) {
  return { ...where, ...activeLeadFilter() };
}

export function isActiveLead(lead) {
  if (!lead) return false;
  if (lead.archived) return false;
  return !INACTIVE_LEAD_STATUSES.includes(lead.status);
}
