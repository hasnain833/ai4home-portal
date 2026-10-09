// DEMO ONLY: Monday-style work management, mock data kept in localStorage. No database.
// ponytail: per-browser localStorage store, replace with Prisma models when this goes real.

import { useSyncExternalStore } from "react";
import { addDays, format } from "date-fns";

// ── Types ────────────────────────────────────────────────────

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type Tone = "neutral" | "navy" | "gold" | "green" | "red" | "slate";
export type ColumnType = "text" | "number" | "dropdown" | "checkbox" | "link" | "rating" | "date";
export type CellValue = string | number | boolean;

export interface StatusDef { key: string; label: string; tone: Tone }
export interface Column { id: string; name: string; type: ColumnType; options?: string[] }
export interface Group { id: string; name: string; color: string }
export interface Board {
  id: string;
  name: string;
  description: string;
  workspace: string;
  groups: Group[];
  statuses: StatusDef[];
  columns: Column[];
}

export interface Subtask { id: string; title: string; done: boolean; assignee?: string }
export interface Update { id: string; author: string; body: string; at: string }
export interface Activity { at: string; text: string }
export interface FileRef { name: string; url?: string }

export interface Item {
  id: string;
  boardId: string;
  groupId: string;
  name: string;
  status: string; // StatusDef.key, "DONE" means complete
  priority: Priority;
  assignees: string[];
  start?: string; // yyyy-MM-dd
  due?: string; // yyyy-MM-dd
  description: string;
  values: Record<string, CellValue>; // custom column values
  dependsOn: string[];
  subtasks: Subtask[];
  updates: Update[];
  files: FileRef[];
  activity: Activity[];
  createdAt: string;
}

export interface Notification { id: string; to: string; text: string; itemId?: string; at: string; read: boolean }

export type Trigger = { type: "created" } | { type: "status"; to: string } | { type: "assigned" } | { type: "priority"; to: Priority };
export type Action =
  | { type: "notify"; value: string } // person or "__assignees"
  | { type: "assign"; value: string }
  | { type: "set_priority"; value: Priority }
  | { type: "move_group"; value: string }
  | { type: "set_status"; value: string };
export interface Automation { id: string; boardId: string; trigger: Trigger; action: Action; enabled: boolean }

export interface WorkState {
  me: string;
  boards: Board[];
  items: Item[];
  notifications: Notification[];
  automations: Automation[];
}

// ── Reference data ───────────────────────────────────────────

export const SUPER_ADMIN = "Super Admin";
export const STAFF = ["Emily Carter", "Daniel Brooks", "Olivia Reed", "Michael Hayes"];
export const PEOPLE = [SUPER_ADMIN, ...STAFF];
export const DONE = "DONE";

// Tones follow the platform palette (navy / gold / cream); red only for blocked / critical.
export const TONES: Record<Tone, { pill: string; dot: string; label: string }> = {
  neutral: { pill: "bg-muted text-muted-foreground", dot: "bg-muted-foreground", label: "Grey" },
  navy: { pill: "bg-primary/10 text-foreground", dot: "bg-primary", label: "Navy" },
  gold: { pill: "bg-[#b48c3c]/15 text-[#8a6a2a] dark:text-[#d4a853]", dot: "bg-[#b48c3c]", label: "Gold" },
  green: { pill: "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-600", label: "Green" },
  red: { pill: "bg-red-500/10 text-red-700 dark:text-red-400", dot: "bg-red-500", label: "Red" },
  slate: { pill: "bg-slate-500/15 text-slate-700 dark:text-slate-300", dot: "bg-slate-500", label: "Slate" },
};

export const DEFAULT_STATUSES: StatusDef[] = [
  { key: "NOT_STARTED", label: "Not started", tone: "neutral" },
  { key: "WORKING", label: "Working on it", tone: "gold" },
  { key: "STUCK", label: "Stuck", tone: "red" },
  { key: "REVIEW", label: "In review", tone: "navy" },
  { key: DONE, label: "Done", tone: "green" },
];

export const PRIORITIES: { key: Priority; label: string; tone: Tone }[] = [
  { key: "LOW", label: "Low", tone: "neutral" },
  { key: "MEDIUM", label: "Medium", tone: "navy" },
  { key: "HIGH", label: "High", tone: "gold" },
  { key: "CRITICAL", label: "Critical", tone: "red" },
];

export const COLUMN_TYPES: { type: ColumnType; label: string }[] = [
  { type: "text", label: "Text" },
  { type: "number", label: "Number" },
  { type: "dropdown", label: "Dropdown" },
  { type: "checkbox", label: "Checkbox" },
  { type: "link", label: "Link" },
  { type: "rating", label: "Rating" },
  { type: "date", label: "Date" },
];

// Group accent colors (left bar + title), kept to the platform palette.
export const GROUP_COLORS = ["#0e1623", "#b48c3c", "#059669", "#64748b", "#c2410c"];

export const statusOf = (board: Board | undefined, key: string): StatusDef =>
  board?.statuses.find((s) => s.key === key) ?? { key, label: key, tone: "neutral" };
export const prioMeta = (p: Priority) => PRIORITIES.find((x) => x.key === p)!;
export const isBlocked = (item: Item, items: Item[]) =>
  item.dependsOn.some((id) => items.find((i) => i.id === id && i.status !== DONE));

// ── Templates ────────────────────────────────────────────────

const uid = () => crypto.randomUUID();
const g = (name: string, color: number): Group => ({ id: uid(), name, color: GROUP_COLORS[color] });

export const TEMPLATES: { key: string; name: string; description: string; make: () => Pick<Board, "groups" | "statuses" | "columns"> }[] = [
  { key: "blank", name: "Blank board", description: "Start from scratch", make: () => ({ groups: [g("To do", 0), g("Done", 2)], statuses: DEFAULT_STATUSES, columns: [] }) },
  {
    key: "bugs",
    name: "Bug tracking",
    description: "Severity, environment and reproduction steps",
    make: () => ({
      groups: [g("Urgent", 4), g("This week", 1), g("Backlog", 3)],
      statuses: [
        { key: "NOT_STARTED", label: "New", tone: "neutral" },
        { key: "WORKING", label: "Fixing", tone: "gold" },
        { key: "STUCK", label: "Blocked", tone: "red" },
        { key: "REVIEW", label: "QA", tone: "navy" },
        { key: DONE, label: "Fixed", tone: "green" },
      ],
      columns: [
        { id: uid(), name: "Environment", type: "dropdown", options: ["Production", "Staging", "Mobile"] },
        { id: uid(), name: "Reported by", type: "text" },
      ],
    }),
  },
  {
    key: "sprint",
    name: "Sprint planning",
    description: "Story points and sprint backlog",
    make: () => ({ groups: [g("Sprint backlog", 0), g("Completed", 2)], statuses: DEFAULT_STATUSES, columns: [{ id: uid(), name: "Story points", type: "number" }] }),
  },
  {
    key: "onboarding",
    name: "Client onboarding",
    description: "One group per client, with checklists",
    make: () => ({ groups: [g("New client", 1)], statuses: DEFAULT_STATUSES, columns: [{ id: uid(), name: "Client signed off", type: "checkbox" }] }),
  },
  {
    key: "content",
    name: "Content calendar",
    description: "Plan posts, channels and publish dates",
    make: () => ({
      groups: [g("Ideas", 3), g("In production", 1), g("Published", 2)],
      statuses: [
        { key: "NOT_STARTED", label: "Idea", tone: "neutral" },
        { key: "WORKING", label: "Writing", tone: "gold" },
        { key: "REVIEW", label: "Editing", tone: "navy" },
        { key: DONE, label: "Published", tone: "green" },
      ],
      columns: [
        { id: uid(), name: "Channel", type: "dropdown", options: ["Blog", "LinkedIn", "Newsletter"] },
        { id: uid(), name: "Link", type: "link" },
      ],
    }),
  },
];

// ── Seed ─────────────────────────────────────────────────────

const day = (n: number) => format(addDays(new Date(), n), "yyyy-MM-dd");
const ago = (n: number) => addDays(new Date(), -n).toISOString();

function seed(): WorkState {
  const bugs = TEMPLATES[1].make();
  const sprint = TEMPLATES[2].make();
  const onboarding = TEMPLATES[3].make();
  const [envCol, reporterCol] = bugs.columns;
  const pointsCol = sprint.columns[0];
  const signedCol = onboarding.columns[0];

  const features = {
    groups: [g("Under review", 3), g("Planned", 0), g("Shipped", 2)],
    statuses: DEFAULT_STATUSES,
    columns: [
      { id: uid(), name: "Requested by", type: "text" as const },
      { id: uid(), name: "Votes", type: "number" as const },
      { id: uid(), name: "Impact", type: "rating" as const },
    ],
  };
  const [reqCol, votesCol, impactCol] = features.columns;
  onboarding.groups = [g("Summit Builders", 1), g("Oakridge Homes", 0)];

  const boards: Board[] = [
    { id: "bugs", name: "Bugs", workspace: "Product", description: "Bugs reported by builders, homeowners and the team.", ...bugs },
    { id: "features", name: "Feature Requests", workspace: "Product", description: "Ideas and requests from clients, prioritised for the roadmap.", ...features },
    { id: "sprint", name: "Sprint 14", workspace: "Product", description: `Current development sprint (${format(addDays(new Date(), -4), "MMM d")} – ${format(addDays(new Date(), 10), "MMM d")}).`, ...sprint },
    { id: "onboarding", name: "Client Onboarding", workspace: "Operations", description: "Setting up new builder companies on AI4Home.", ...onboarding },
  ];
  const G = (b: number, gi: number) => boards[b].groups[gi].id;

  type S = Partial<Item> & Pick<Item, "boardId" | "groupId" | "name" | "status" | "priority">;
  const raw: S[] = [
    // Bugs
    { boardId: "bugs", groupId: G(0, 0), name: "Homeowner chat freezes after uploading 3+ photos", status: "WORKING", priority: "CRITICAL", assignees: ["Daniel Brooks"], start: day(-2), due: day(1), values: { [envCol.id]: "Mobile", [reporterCol.id]: "Mark Davies (Summit Builders)" }, description: "On iPhone, attaching more than 3 photos in the warranty chat makes the send button stop responding.", subtasks: [{ id: uid(), title: "Reproduce on iOS Safari", done: true, assignee: "Daniel Brooks" }, { id: uid(), title: "Compress images before upload", done: false, assignee: "Daniel Brooks" }, { id: uid(), title: "Add upload progress indicator", done: false, assignee: "Emily Carter" }] },
    { boardId: "bugs", groupId: G(0, 0), name: "Salesforce sync shows 'Pending' for closed leads", status: "STUCK", priority: "HIGH", assignees: ["Michael Hayes"], start: day(-3), due: day(-1), values: { [envCol.id]: "Production", [reporterCol.id]: "James Wright (Legacy Homes)" }, description: "Leads marked Closed Won in Salesforce still show Pending after 24h. Waiting on API access from the client." },
    { boardId: "bugs", groupId: G(0, 1), name: "Wrong timezone on booking confirmation email", status: "REVIEW", priority: "HIGH", assignees: ["Olivia Reed"], start: day(-4), due: day(2), values: { [envCol.id]: "Production", [reporterCol.id]: "Tom Baker (Crestview Homes)" }, description: "Confirmation email shows UTC instead of the homeowner's local time." },
    { boardId: "bugs", groupId: G(0, 1), name: "Sales agent repeats the same answer twice", status: "WORKING", priority: "MEDIUM", assignees: ["Emily Carter"], start: day(-1), due: day(4), values: { [envCol.id]: "Production", [reporterCol.id]: "Internal" }, description: "On some lead conversations the AI sends the same message twice in a row." },
    { boardId: "bugs", groupId: G(0, 1), name: "Invoice PDF cuts off the last line item", status: "NOT_STARTED", priority: "MEDIUM", assignees: ["Michael Hayes"], start: day(2), due: day(6), values: { [envCol.id]: "Production", [reporterCol.id]: "Sofia Martinez (Cedar Lane)" }, description: "With more than 12 items the last row is hidden by the footer." },
    { boardId: "bugs", groupId: G(0, 2), name: "Dark mode: low contrast on community cards", status: "NOT_STARTED", priority: "LOW", assignees: [], due: day(14), values: { [envCol.id]: "Staging" }, description: "" },
    { boardId: "bugs", groupId: G(0, 2), name: "CSV export ignores the date filter", status: "NOT_STARTED", priority: "LOW", assignees: ["Olivia Reed"], due: day(18), values: { [envCol.id]: "Production" }, description: "" },
    // Features
    { boardId: "features", groupId: G(1, 0), name: "SMS reminder to trades 24h before appointment", status: "NOT_STARTED", priority: "MEDIUM", assignees: [], due: day(20), values: { [reqCol.id]: "Brightview Builders", [votesCol.id]: 14, [impactCol.id]: 4 }, description: "Trades are missing appointments." },
    { boardId: "features", groupId: G(1, 0), name: "Export warranty tickets to Excel with photos", status: "REVIEW", priority: "MEDIUM", assignees: ["Olivia Reed"], due: day(12), values: { [reqCol.id]: "Oakridge Homes", [votesCol.id]: 9, [impactCol.id]: 3 }, description: "For their monthly trade review." },
    { boardId: "features", groupId: G(1, 1), name: "Bulk assign tickets to a trade", status: "WORKING", priority: "HIGH", assignees: ["Daniel Brooks", "Emily Carter"], start: day(-5), due: day(5), values: { [reqCol.id]: "Summit Builders", [votesCol.id]: 22, [impactCol.id]: 5 }, description: "Select multiple tickets and dispatch them to one trade in a single action.", subtasks: [{ id: uid(), title: "Multi-select in ticket table", done: true, assignee: "Daniel Brooks" }, { id: uid(), title: "Bulk dispatch API", done: true, assignee: "Daniel Brooks" }, { id: uid(), title: "Confirmation dialog + toast", done: false, assignee: "Emily Carter" }] },
    { boardId: "features", groupId: G(1, 1), name: "Warranty expiry countdown on homeowner profile", status: "NOT_STARTED", priority: "LOW", assignees: ["Emily Carter"], start: day(6), due: day(15), values: { [reqCol.id]: "Meadowbrook Homes", [votesCol.id]: 5, [impactCol.id]: 2 }, description: "" },
    { boardId: "features", groupId: G(1, 2), name: "Salesforce OAuth connection", status: DONE, priority: "HIGH", assignees: ["Michael Hayes"], start: day(-20), due: day(-6), values: { [reqCol.id]: "Legacy Homes", [votesCol.id]: 18, [impactCol.id]: 5 }, description: "" },
    { boardId: "features", groupId: G(1, 2), name: "AI help agent for builders", status: DONE, priority: "MEDIUM", assignees: ["Daniel Brooks"], start: day(-18), due: day(-8), values: { [reqCol.id]: "Internal", [votesCol.id]: 11, [impactCol.id]: 4 }, description: "" },
    // Sprint
    { boardId: "sprint", groupId: G(2, 0), name: "Faster loading of the communities dashboard", status: "REVIEW", priority: "MEDIUM", assignees: ["Emily Carter"], start: day(-4), due: day(1), values: { [pointsCol.id]: 5 }, description: "Dashboard takes ~6s with 40+ communities. Add pagination and caching." },
    { boardId: "sprint", groupId: G(2, 0), name: "Trade portal: upload completion photos", status: "WORKING", priority: "HIGH", assignees: ["Daniel Brooks"], start: day(-2), due: day(5), values: { [pointsCol.id]: 8 }, description: "" },
    { boardId: "sprint", groupId: G(2, 0), name: "Weekly report email to builders", status: "NOT_STARTED", priority: "MEDIUM", assignees: ["Olivia Reed"], start: day(3), due: day(9), values: { [pointsCol.id]: 3 }, description: "" },
    { boardId: "sprint", groupId: G(2, 0), name: "Audit log for admin actions", status: "STUCK", priority: "MEDIUM", assignees: ["Michael Hayes"], start: day(-1), due: day(7), values: { [pointsCol.id]: 5 }, description: "Blocked: waiting on decision about retention period." },
    { boardId: "sprint", groupId: G(2, 1), name: "Fix login redirect loop", status: DONE, priority: "CRITICAL", assignees: ["Emily Carter"], start: day(-4), due: day(-3), values: { [pointsCol.id]: 2 }, description: "" },
    { boardId: "sprint", groupId: G(2, 1), name: "Community news defaults", status: DONE, priority: "LOW", assignees: ["Olivia Reed"], start: day(-4), due: day(-2), values: { [pointsCol.id]: 3 }, description: "" },
    // Onboarding
    { boardId: "onboarding", groupId: G(3, 0), name: "Kick-off call with Summit Builders", status: DONE, priority: "MEDIUM", assignees: [SUPER_ADMIN], due: day(-5), values: { [signedCol.id]: true }, description: "" },
    { boardId: "onboarding", groupId: G(3, 0), name: "Import 3 communities and 120 homeowners", status: "WORKING", priority: "HIGH", assignees: ["Olivia Reed"], start: day(-2), due: day(2), values: {}, description: "" },
    { boardId: "onboarding", groupId: G(3, 0), name: "Connect Salesforce", status: "NOT_STARTED", priority: "MEDIUM", assignees: ["Michael Hayes"], start: day(2), due: day(4), values: {}, description: "" },
    { boardId: "onboarding", groupId: G(3, 1), name: "Kick-off call with Oakridge Homes", status: "NOT_STARTED", priority: "MEDIUM", assignees: [SUPER_ADMIN], due: day(3), values: {}, description: "" },
    { boardId: "onboarding", groupId: G(3, 1), name: "Train warranty team on the portal", status: "NOT_STARTED", priority: "MEDIUM", assignees: ["Emily Carter"], start: day(5), due: day(8), values: {}, description: "" },
  ];

  const items: Item[] = raw.map((r, i) => ({
    id: `i${i + 1}`,
    assignees: [],
    description: "",
    values: {},
    dependsOn: [],
    subtasks: [],
    files: i % 4 === 0 ? [{ name: "screenshot.png" }] : [],
    updates:
      i % 3 === 0 && r.assignees?.[0]
        ? [{ id: uid(), author: r.assignees[0], body: "Started on this, will update by end of day.", at: ago(1) }]
        : [],
    activity: [{ at: ago(10 - (i % 8)), text: `${SUPER_ADMIN} created this item` }],
    createdAt: ago(10 - (i % 8)),
    ...r,
  }));
  // Dependencies: connect Salesforce waits on the sync bug; weekly report waits on dashboard perf
  items[21].dependsOn = ["i2"];
  items[15].dependsOn = ["i14"];

  return {
    me: SUPER_ADMIN,
    boards,
    items,
    notifications: [
      { id: uid(), to: SUPER_ADMIN, text: "Michael Hayes marked “Salesforce sync shows 'Pending'” as Blocked", itemId: "i2", at: ago(0.1), read: false },
      { id: uid(), to: SUPER_ADMIN, text: "Emily Carter moved “Faster loading of the communities dashboard” to In review", itemId: "i14", at: ago(0.3), read: false },
      { id: uid(), to: "Emily Carter", text: "Super Admin assigned you “Bulk assign tickets to a trade”", itemId: "i10", at: ago(1), read: false },
    ],
    automations: [
      { id: uid(), boardId: "bugs", trigger: { type: "created" }, action: { type: "assign", value: "Emily Carter" }, enabled: true },
      { id: uid(), boardId: "bugs", trigger: { type: "priority", to: "CRITICAL" }, action: { type: "notify", value: SUPER_ADMIN }, enabled: true },
      { id: uid(), boardId: "*", trigger: { type: "status", to: DONE }, action: { type: "notify", value: SUPER_ADMIN }, enabled: true },
      { id: uid(), boardId: "*", trigger: { type: "status", to: "STUCK" }, action: { type: "notify", value: SUPER_ADMIN }, enabled: true },
      { id: uid(), boardId: "*", trigger: { type: "assigned" }, action: { type: "notify", value: "__assignees" }, enabled: true },
      { id: uid(), boardId: "sprint", trigger: { type: "status", to: DONE }, action: { type: "move_group", value: boards[2].groups[1].id }, enabled: true },
    ],
  };
}

// ── Store ────────────────────────────────────────────────────

const KEY = "ai4h-work-demo-v2";
let state: WorkState | null = null;
let undoStack: WorkState[] = [];
const listeners = new Set<() => void>();

function get(): WorkState {
  if (!state) {
    try {
      const raw = localStorage.getItem(KEY);
      state = raw ? (JSON.parse(raw) as WorkState) : seed();
    } catch {
      state = seed();
    }
  }
  return state;
}

function set(next: WorkState, undoable = false) {
  if (undoable && state) undoStack = [...undoStack.slice(-19), state];
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // quota exceeded (large image previews): keep in memory only
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  // other tabs: live sync like a shared workspace
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      state = null;
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** null during SSR, so the page renders client-only (seed dates depend on "now"). */
export function useWork(): WorkState | null {
  return useSyncExternalStore(subscribe, get, () => null);
}

export const getState = get;

export function undo(): boolean {
  const prev = undoStack.pop();
  if (!prev) return false;
  set(prev);
  return true;
}

// ── Automations engine ───────────────────────────────────────

const now = () => new Date().toISOString();
const notify = (to: string, text: string, itemId?: string): Notification => ({ id: uid(), to, text, itemId, at: now(), read: false });

type Event = { type: "created" } | { type: "status"; to: string } | { type: "assigned"; added: string[] } | { type: "priority"; to: Priority };

function matches(t: Trigger, e: Event) {
  if (t.type !== e.type) return false;
  if (t.type === "status" && e.type === "status") return t.to === e.to;
  if (t.type === "priority" && e.type === "priority") return t.to === e.to;
  return true;
}

/** Applies matching automations to an item, returns the patched item + notifications. */
function runAutomations(s: WorkState, item: Item, events: Event[]): { item: Item; notes: Notification[] } {
  let it = item;
  const notes: Notification[] = [];
  const board = s.boards.find((b) => b.id === item.boardId);
  for (const a of s.automations) {
    if (!a.enabled || (a.boardId !== "*" && a.boardId !== item.boardId)) continue;
    const e = events.find((ev) => matches(a.trigger, ev));
    if (!e) continue;
    const log = (text: string) => (it = { ...it, activity: [...it.activity, { at: now(), text: `⚡ Automation: ${text}` }] });
    switch (a.action.type) {
      case "notify": {
        const to = a.action.value === "__assignees" ? (e.type === "assigned" ? e.added : it.assignees) : [a.action.value];
        const what = e.type === "created" ? "created" : e.type === "assigned" ? "assigned you" : e.type === "status" ? `set to ${statusOf(board, e.to).label}` : `set to ${prioMeta(e.to).label} priority`;
        to.filter((p) => p !== s.me).forEach((p) =>
          notes.push(notify(p, e.type === "assigned" ? `${s.me} assigned you “${it.name}”` : `“${it.name}” was ${what} by ${s.me}`, it.id)),
        );
        break;
      }
      case "assign":
        if (!it.assignees.includes(a.action.value)) {
          it = { ...it, assignees: [...it.assignees, a.action.value] };
          log(`assigned ${a.action.value}`);
          if (a.action.value !== s.me) notes.push(notify(a.action.value, `You were auto-assigned “${it.name}”`, it.id));
        }
        break;
      case "set_priority":
        it = { ...it, priority: a.action.value };
        log(`set priority to ${prioMeta(a.action.value).label}`);
        break;
      case "set_status":
        it = { ...it, status: a.action.value };
        log(`set status to ${statusOf(board, a.action.value).label}`);
        break;
      case "move_group": {
        const target = board?.groups.find((gr) => gr.id === (a.action as { value: string }).value);
        if (target && it.groupId !== target.id) {
          it = { ...it, groupId: target.id };
          log(`moved to group ${target.name}`);
        }
        break;
      }
    }
  }
  return { item: it, notes };
}

// ── Actions ──────────────────────────────────────────────────

export function setMe(me: string) {
  set({ ...get(), me });
}

export function createItem(boardId: string, groupId: string, name: string, extra: Partial<Item> = {}, source?: string): Item {
  const s = get();
  const base: Item = {
    id: uid(),
    boardId,
    groupId,
    name,
    status: "NOT_STARTED",
    priority: "MEDIUM",
    assignees: [],
    description: "",
    values: {},
    dependsOn: [],
    subtasks: [],
    updates: [],
    files: [],
    createdAt: now(),
    ...extra,
    activity: [{ at: now(), text: source ?? `${s.me} created this item` }],
  };
  const events: Event[] = [{ type: "created" }];
  if (base.assignees.length) events.push({ type: "assigned", added: base.assignees });
  const { item, notes } = runAutomations(s, base, events);
  set({ ...s, items: [...s.items, item], notifications: [...notes, ...s.notifications] });
  return item;
}

export function updateItem(id: string, patch: Partial<Item>, activityText?: string) {
  updateItems([id], patch, activityText);
}

export function updateItems(ids: string[], patch: Partial<Item>, activityText?: string) {
  const s = get();
  let notes: Notification[] = [];
  const items = s.items.map((prev) => {
    if (!ids.includes(prev.id)) return prev;
    let it: Item = { ...prev, ...patch };
    if (activityText) it.activity = [...prev.activity, { at: now(), text: `${s.me} ${activityText}` }];
    const events: Event[] = [];
    if (patch.status && patch.status !== prev.status) events.push({ type: "status", to: patch.status });
    if (patch.priority && patch.priority !== prev.priority) events.push({ type: "priority", to: patch.priority });
    if (patch.assignees) {
      const added = patch.assignees.filter((p) => !prev.assignees.includes(p));
      if (added.length) events.push({ type: "assigned", added });
    }
    if (events.length) {
      const r = runAutomations(s, it, events);
      it = r.item;
      notes = [...notes, ...r.notes];
    }
    return it;
  });
  set({ ...s, items, notifications: [...notes, ...s.notifications] }, ids.length > 1);
}

export function deleteItems(ids: string[]) {
  const s = get();
  set(
    { ...s, items: s.items.filter((i) => !ids.includes(i.id)).map((i) => ({ ...i, dependsOn: i.dependsOn.filter((d) => !ids.includes(d)) })) },
    true,
  );
}

export function duplicateItem(id: string) {
  const s = get();
  const src = s.items.find((i) => i.id === id);
  if (!src) return;
  const copy: Item = { ...structuredClone(src), id: uid(), name: `${src.name} (copy)`, updates: [], createdAt: now(), activity: [{ at: now(), text: `${s.me} duplicated this item` }] };
  const idx = s.items.findIndex((i) => i.id === id);
  set({ ...s, items: [...s.items.slice(0, idx + 1), copy, ...s.items.slice(idx + 1)] });
}

/** Drag & drop: move item into a group, before another item (or to the end). */
export function moveItem(id: string, groupId: string, beforeId?: string) {
  const s = get();
  const item = s.items.find((i) => i.id === id);
  if (!item || id === beforeId) return;
  const board = s.boards.find((b) => b.id === item.boardId);
  const rest = s.items.filter((i) => i.id !== id);
  const moved: Item =
    item.groupId === groupId
      ? item
      : { ...item, groupId, activity: [...item.activity, { at: now(), text: `${s.me} moved to ${board?.groups.find((x) => x.id === groupId)?.name}` }] };
  let idx = beforeId ? rest.findIndex((i) => i.id === beforeId) : -1;
  if (idx < 0) {
    // after the last item of the target group
    const lastInGroup = rest.map((i) => i.groupId === groupId && i.boardId === item.boardId).lastIndexOf(true);
    idx = lastInGroup + 1 || rest.length;
  }
  set({ ...s, items: [...rest.slice(0, idx), moved, ...rest.slice(idx)] });
}

export function addUpdate(id: string, body: string) {
  const s = get();
  const item = s.items.find((i) => i.id === id);
  if (!item) return;
  const mentioned = PEOPLE.filter((p) => body.includes(`@${p}`) && p !== s.me);
  const notes = mentioned.map((p) => notify(p, `${s.me} mentioned you on “${item.name}”`, id));
  set({
    ...s,
    items: s.items.map((i) =>
      i.id === id
        ? { ...i, updates: [...i.updates, { id: uid(), author: s.me, body, at: now() }], activity: [...i.activity, { at: now(), text: `${s.me} posted an update` }] }
        : i,
    ),
    notifications: [...notes, ...s.notifications],
  });
}

// Boards

export function createBoard(name: string, workspace: string, templateKey: string): Board {
  const s = get();
  const tpl = TEMPLATES.find((t) => t.key === templateKey) ?? TEMPLATES[0];
  const board: Board = { id: uid(), name, description: tpl.key === "blank" ? "" : `Created from the ${tpl.name} template.`, workspace, ...tpl.make() };
  set({ ...s, boards: [...s.boards, board] });
  return board;
}

export function updateBoard(id: string, patch: Partial<Board>) {
  const s = get();
  set({ ...s, boards: s.boards.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
}

export function deleteBoard(id: string) {
  const s = get();
  set({ ...s, boards: s.boards.filter((b) => b.id !== id), items: s.items.filter((i) => i.boardId !== id), automations: s.automations.filter((a) => a.boardId !== id) }, true);
}

export function addGroup(boardId: string, name: string) {
  const s = get();
  const b = s.boards.find((x) => x.id === boardId);
  if (!b) return;
  updateBoard(boardId, { groups: [...b.groups, { id: uid(), name, color: GROUP_COLORS[b.groups.length % GROUP_COLORS.length] }] });
}

export function updateGroup(boardId: string, groupId: string, patch: Partial<Group>) {
  const b = get().boards.find((x) => x.id === boardId);
  if (b) updateBoard(boardId, { groups: b.groups.map((gr) => (gr.id === groupId ? { ...gr, ...patch } : gr)) });
}

export function deleteGroup(boardId: string, groupId: string) {
  const s = get();
  set(
    {
      ...s,
      boards: s.boards.map((b) => (b.id === boardId ? { ...b, groups: b.groups.filter((gr) => gr.id !== groupId) } : b)),
      items: s.items.filter((i) => i.groupId !== groupId),
    },
    true,
  );
}

export function addColumn(boardId: string, type: ColumnType) {
  const b = get().boards.find((x) => x.id === boardId);
  if (!b) return;
  const label = COLUMN_TYPES.find((c) => c.type === type)!.label;
  updateBoard(boardId, { columns: [...b.columns, { id: uid(), name: label, type, options: type === "dropdown" ? ["Option 1", "Option 2", "Option 3"] : undefined }] });
}

export function updateColumn(boardId: string, colId: string, patch: Partial<Column>) {
  const b = get().boards.find((x) => x.id === boardId);
  if (b) updateBoard(boardId, { columns: b.columns.map((c) => (c.id === colId ? { ...c, ...patch } : c)) });
}

export function deleteColumn(boardId: string, colId: string) {
  const s = get();
  set({ ...s, boards: s.boards.map((b) => (b.id === boardId ? { ...b, columns: b.columns.filter((c) => c.id !== colId) } : b)) }, true);
}

export function setCell(itemId: string, colId: string, value: CellValue | undefined) {
  const s = get();
  set({
    ...s,
    items: s.items.map((i) => {
      if (i.id !== itemId) return i;
      const values = { ...i.values };
      if (value === undefined || value === "") delete values[colId];
      else values[colId] = value;
      return { ...i, values };
    }),
  });
}

// Notifications & automations

export function pushNotification(to: string, text: string, itemId?: string) {
  const s = get();
  set({ ...s, notifications: [notify(to, text, itemId), ...s.notifications] });
}

export function markRead() {
  const s = get();
  set({ ...s, notifications: s.notifications.map((n) => (n.to === s.me ? { ...n, read: true } : n)) });
}

export function addAutomation(a: Omit<Automation, "id" | "enabled">) {
  const s = get();
  set({ ...s, automations: [...s.automations, { ...a, id: uid(), enabled: true }] });
}

export function toggleAutomation(id: string) {
  const s = get();
  set({ ...s, automations: s.automations.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a)) });
}

export function deleteAutomation(id: string) {
  const s = get();
  set({ ...s, automations: s.automations.filter((a) => a.id !== id) }, true);
}

export function describeAutomation(a: Automation, boards: Board[]): { when: string; then: string; scope: string } {
  const board = boards.find((b) => b.id === a.boardId);
  const t = a.trigger;
  const when =
    t.type === "created" ? "When an item is created"
      : t.type === "assigned" ? "When someone is assigned"
        : t.type === "status" ? `When status changes to ${board ? statusOf(board, t.to).label : (DEFAULT_STATUSES.find((x) => x.key === t.to)?.label ?? t.to)}`
          : `When priority changes to ${prioMeta(t.to).label}`;
  const x = a.action;
  const then =
    x.type === "notify" ? `notify ${x.value === "__assignees" ? "the assignees" : x.value}`
      : x.type === "assign" ? `assign ${x.value}`
        : x.type === "set_priority" ? `set priority to ${prioMeta(x.value).label}`
          : x.type === "set_status" ? `set status to ${statusOf(board, x.value).label}`
            : `move item to group “${board?.groups.find((gr) => gr.id === x.value)?.name ?? "?"}”`;
  return { when, then, scope: board ? board.name : "All boards" };
}

export function resetDemo() {
  undoStack = [];
  set({ ...seed(), me: get().me });
}
