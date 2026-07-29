
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

export const LEAD_STATUS = {
  NEW: "New",
  NURTURING: "Nurturing",
  ENGAGED: "Engaged",
  APPOINTMENT_SET: "Appointment Set",
  QUALIFIED: "Qualified",
  CLOSED_WON: "Closed Won",
  CLOSED_LOST: "Closed Lost",
  UNSUBSCRIBED: "Unsubscribed",
};

export function normalizeLeadStatuses(input) {
  void input;
  return DEFAULT_LEAD_STATUSES;
}

export function resolveLeadStatuses(company) {
  void company;
  return DEFAULT_LEAD_STATUSES;
}
