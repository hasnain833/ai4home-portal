// DEMO ONLY: client-side mock ticket store (localStorage). No database.
// ponytail: localStorage per-browser, replace with Prisma model when this goes real.

export type TicketType = "BUG" | "FEATURE" | "IMPROVEMENT" | "QUESTION";
export type TicketStatus = "NEW" | "TRIAGED" | "IN_PROGRESS" | "IN_REVIEW" | "DONE";
export type TicketPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface TicketComment {
  id: string;
  author: string;
  body: string;
  at: string;
}

export interface DemoTicket {
  id: string;
  number: number;
  type: TicketType;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  reporterName: string;
  reporterEmail: string;
  company?: string;
  area?: string;
  assignee?: string;
  labels: string[];
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
  comments: TicketComment[];
  activity: { at: string; text: string }[];
}

export interface DemoNotification {
  id: string;
  ticketNumber: number;
  text: string;
  at: string;
  read: boolean;
}

// Tones follow the platform palette (navy / gold / cream); red only for bugs & urgent.
const NEUTRAL = "bg-muted text-muted-foreground";
const NAVY = "bg-primary/10 text-foreground";
const GOLD = "bg-[#b48c3c]/15 text-[#8a6a2a] dark:text-[#d4a853]";
const GREEN = "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400";
const RED = "bg-red-500/10 text-red-700 dark:text-red-400";

export const STATUSES: { key: TicketStatus; label: string; color: string; tone: string }[] = [
  { key: "NEW", label: "New", color: "bg-primary", tone: NAVY },
  { key: "TRIAGED", label: "To Do", color: "bg-muted-foreground", tone: NEUTRAL },
  { key: "IN_PROGRESS", label: "In Progress", color: "bg-[#b48c3c]", tone: GOLD },
  { key: "IN_REVIEW", label: "In Review", color: "bg-[#d4a853]", tone: GOLD },
  { key: "DONE", label: "Done", color: "bg-emerald-600", tone: GREEN },
];

export const TYPES: { key: TicketType; label: string; className: string }[] = [
  { key: "BUG", label: "Bug", className: RED },
  { key: "FEATURE", label: "Feature", className: GOLD },
  { key: "IMPROVEMENT", label: "Improvement", className: NAVY },
  { key: "QUESTION", label: "Question", className: NEUTRAL },
];

export const PRIORITIES: { key: TicketPriority; label: string; className: string }[] = [
  { key: "LOW", label: "Low", className: NEUTRAL },
  { key: "MEDIUM", label: "Medium", className: NAVY },
  { key: "HIGH", label: "High", className: GOLD },
  { key: "URGENT", label: "Urgent", className: RED },
];

export const AREAS = [
  "Warranty Portal",
  "Sales Agent",
  "Homeowner Chat",
  "Trade Portal",
  "Reports",
  "Integrations (Salesforce)",
  "Billing",
  "Other",
];

// Super admin's support staff, the only people tickets get assigned to.
export const TEAM = ["Emily Carter", "Daniel Brooks", "Olivia Reed", "Michael Hayes"];

const TICKETS_KEY = "ai4h-demo-tickets-v2";
const NOTIF_KEY = "ai4h-demo-notifications-v2";
const CHANGE_EVENT = "ai4h-demo-tickets-change";

const daysAgo = (d: number, h = 0) => new Date(Date.now() - d * 86400000 - h * 3600000).toISOString();
const daysAhead = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

function seed(): DemoTicket[] {
  const raw: Array<Partial<DemoTicket> & Pick<DemoTicket, "type" | "title" | "status" | "priority">> = [
    { type: "BUG", title: "Homeowner chat freezes after uploading 3+ photos", status: "IN_PROGRESS", priority: "URGENT", reporterName: "Mark Davies", reporterEmail: "mark@summitbuilders.com", company: "Summit Builders", area: "Homeowner Chat", assignee: "Daniel Brooks", labels: ["mobile", "uploads"], dueDate: daysAhead(1), description: "When a homeowner attaches more than 3 photos in the warranty chat on iPhone, the send button stops responding and the chat freezes." },
    { type: "FEATURE", title: "Export warranty tickets to Excel with photos", status: "TRIAGED", priority: "MEDIUM", reporterName: "Linda Park", reporterEmail: "linda@oakridgehomes.com", company: "Oakridge Homes", area: "Reports", assignee: "Olivia Reed", labels: ["reports"], dueDate: daysAhead(10), description: "We need to export all tickets for a community to Excel including photo links for our monthly review with the trades." },
    { type: "BUG", title: "Salesforce sync shows 'Pending' for closed leads", status: "NEW", priority: "HIGH", reporterName: "James Wright", reporterEmail: "james@legacyhomes.com", company: "Legacy Homes", area: "Integrations (Salesforce)", labels: ["salesforce", "sync"], description: "Leads marked Closed Won in Salesforce still show Pending sync status in the portal after 24h." },
    { type: "IMPROVEMENT", title: "Faster loading of the communities dashboard", status: "IN_REVIEW", priority: "MEDIUM", reporterName: "Internal", reporterEmail: "team@bitzsol.com", area: "Warranty Portal", assignee: "Emily Carter", labels: ["performance"], dueDate: daysAhead(3), description: "Dashboard takes ~6s with 40+ communities. Add pagination and caching." },
    { type: "FEATURE", title: "SMS reminder to trades 24h before appointment", status: "NEW", priority: "MEDIUM", reporterName: "Rachel Green", reporterEmail: "rachel@brightviewbuilders.com", company: "Brightview Builders", area: "Trade Portal", labels: ["sms", "trades"], description: "Trades miss appointments. An automatic SMS reminder the day before would help a lot." },
    { type: "BUG", title: "Wrong timezone on booking confirmation email", status: "DONE", priority: "HIGH", reporterName: "Tom Baker", reporterEmail: "tom@crestviewhomes.com", company: "Crestview Homes", area: "Warranty Portal", assignee: "Michael Hayes", labels: ["email", "timezone"], description: "Confirmation email shows UTC time instead of the homeowner's local time." },
    { type: "QUESTION", title: "How do we add a second admin to our company?", status: "DONE", priority: "LOW", reporterName: "Nina Patel", reporterEmail: "nina@heritagebuilt.com", company: "Heritage Built", area: "Other", assignee: "Emily Carter", labels: ["onboarding"], description: "We want our operations manager to also have admin access." },
    { type: "FEATURE", title: "Dark mode for homeowner chat widget", status: "TRIAGED", priority: "LOW", reporterName: "Chris Evans", reporterEmail: "chris@northstarhomes.com", company: "Northstar Homes", area: "Homeowner Chat", assignee: "Emily Carter", labels: ["ui"], dueDate: daysAhead(21), description: "Widget should follow the site's dark theme." },
    { type: "BUG", title: "Sales agent repeats the same answer twice", status: "IN_PROGRESS", priority: "HIGH", reporterName: "Internal", reporterEmail: "team@bitzsol.com", area: "Sales Agent", assignee: "Emily Carter", labels: ["ai"], dueDate: daysAhead(2), description: "On some lead conversations the AI sends the same message twice in a row." },
    { type: "IMPROVEMENT", title: "Show warranty expiry countdown on homeowner profile", status: "NEW", priority: "LOW", reporterName: "Anna Lee", reporterEmail: "anna@meadowbrook.com", company: "Meadowbrook Homes", area: "Warranty Portal", labels: ["ux"], description: "Display days remaining on the 1-year warranty directly on the homeowner card." },
    { type: "FEATURE", title: "Bulk assign tickets to a trade", status: "IN_REVIEW", priority: "MEDIUM", reporterName: "Mark Davies", reporterEmail: "mark@summitbuilders.com", company: "Summit Builders", area: "Trade Portal", assignee: "Daniel Brooks", labels: ["trades", "bulk"], dueDate: daysAhead(5), description: "Select multiple tickets and dispatch them to one trade in a single action." },
    { type: "BUG", title: "Invoice PDF cuts off the last line item", status: "TRIAGED", priority: "MEDIUM", reporterName: "Sofia Martinez", reporterEmail: "sofia@cedarlane.com", company: "Cedar Lane Homes", area: "Billing", assignee: "Michael Hayes", labels: ["pdf"], dueDate: daysAhead(6), description: "When an invoice has more than 12 items, the last row is hidden by the footer." },
  ];
  return raw.map((t, i) => {
    const created = daysAgo(12 - i, i * 2);
    return {
      id: `t${i + 1}`,
      number: 1001 + i,
      description: "",
      reporterName: "Internal",
      reporterEmail: "team@bitzsol.com",
      labels: [],
      createdAt: created,
      updatedAt: created,
      comments:
        i % 3 === 0
          ? [{ id: `c${i}`, author: t.assignee ?? "Super Admin", body: "Reproduced on staging, looking into it.", at: daysAgo(1, i) }]
          : [],
      activity: [{ at: created, text: `Ticket created by ${t.reporterName ?? "Internal"}` }],
      ...t,
    } as DemoTicket;
  });
}

function read<T>(key: string, fallback: () => T): T {
  try {
    const v = localStorage.getItem(key);
    if (v) return JSON.parse(v) as T;
  } catch {}
  const f = fallback();
  write(key, f);
  return f;
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export const loadTickets = () => read<DemoTicket[]>(TICKETS_KEY, seed);
export const saveTickets = (t: DemoTicket[]) => write(TICKETS_KEY, t);
export const loadNotifications = () => read<DemoNotification[]>(NOTIF_KEY, () => []);
export const saveNotifications = (n: DemoNotification[]) => write(NOTIF_KEY, n);

export function resetDemo() {
  saveTickets(seed());
  saveNotifications([]);
}

/** Fires on changes in this tab and in other tabs (storage event). */
export function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === TICKETS_KEY || e.key === NOTIF_KEY) cb();
  };
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function createTicket(input: {
  type: TicketType;
  title: string;
  description: string;
  priority: TicketPriority;
  reporterName: string;
  reporterEmail: string;
  company?: string;
  area?: string;
}, notify = true): DemoTicket {
  const tickets = loadTickets();
  const now = new Date().toISOString();
  const ticket: DemoTicket = {
    ...input,
    id: crypto.randomUUID(),
    number: Math.max(1000, ...tickets.map((t) => t.number)) + 1,
    status: "NEW",
    labels: [],
    createdAt: now,
    updatedAt: now,
    comments: [],
    activity: [{ at: now, text: `Ticket submitted by ${input.reporterName} via public portal` }],
  };
  saveTickets([ticket, ...tickets]);
  if (notify) saveNotifications([
    {
      id: crypto.randomUUID(),
      ticketNumber: ticket.number,
      text: `New ${input.type.toLowerCase()} #${ticket.number}: ${input.title}`,
      at: now,
      read: false,
    },
    ...loadNotifications(),
  ]);
  return ticket;
}
