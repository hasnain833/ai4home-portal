"use client";

// DEMO ONLY: Monday/Trello-style ticket board backed by mock localStorage data.

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import {
  Bell,
  Calendar,
  ExternalLink,
  KanbanSquare,
  MessageSquare,
  Plus,
  RotateCcw,
  Search,
  Table2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AREAS,
  PRIORITIES,
  STATUSES,
  TEAM,
  TYPES,
  createTicket,
  loadNotifications,
  loadTickets,
  resetDemo,
  saveNotifications,
  saveTickets,
  subscribe,
  type DemoNotification,
  type DemoTicket,
  type TicketPriority,
  type TicketStatus,
  type TicketType,
} from "@/lib/demo-tickets";

const ME = "Super Admin";
const selectCls =
  "h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

// Pill-style selects for the table view, tinted with the platform palette
const cellSelect =
  "h-7 w-full cursor-pointer appearance-none rounded-full px-3 text-center text-xs font-medium outline-none transition hover:opacity-80";

const typeMeta =(k: TicketType) => TYPES.find((t) => t.key === k)!;
const prioMeta = (k: TicketPriority) => PRIORITIES.find((p) => p.key === k)!;
const statusMeta = (k: TicketStatus) => STATUSES.find((s) => s.key === k)!;
const initials = (n: string) => n.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${className}`}>{children}</span>;
}

function Avatar({ name }: { name?: string }) {
  if (!name) return <span className="flex size-6 items-center justify-center rounded-full border border-dashed text-[10px] text-muted-foreground">?</span>;
  return (
    <span title={name} className="flex size-6 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
      {initials(name)}
    </span>
  );
}

export default function TicketsBoardPage() {
  const [tickets, setTickets] = useState<DemoTicket[]>([]);
  const [notifs, setNotifs] = useState<DemoNotification[]>([]);
  const [view, setView] = useState<"board" | "table">("board");
  const [q, setQ] = useState("");
  const [fType, setFType] = useState<"" | TicketType>("");
  const [fAssignee, setFAssignee] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [dragOver, setDragOver] = useState<TicketStatus | null>(null);
  const seenNotifs = useRef<Set<string> | null>(null);

  useEffect(() => {
    const sync = () => {
      setTickets(loadTickets());
      const n = loadNotifications();
      setNotifs(n);
      // toast for notifications that arrived while the board is open (e.g. from the public page)
      if (seenNotifs.current) {
        n.filter((x) => !seenNotifs.current!.has(x.id)).forEach((x) =>
          toast.info("New ticket received", { description: x.text }),
        );
      }
      seenNotifs.current = new Set(n.map((x) => x.id));
    };
    sync();
    return subscribe(sync);
  }, []);

  const update = (id: string, patch: Partial<DemoTicket>, activity?: string) => {
    const now = new Date().toISOString();
    saveTickets(
      loadTickets().map((t) =>
        t.id === id
          ? { ...t, ...patch, updatedAt: now, activity: activity ? [...t.activity, { at: now, text: `${ME} ${activity}` }] : t.activity }
          : t,
      ),
    );
  };

  const moveTo = (id: string, status: TicketStatus) => {
    const t = tickets.find((x) => x.id === id);
    if (!t || t.status === status) return;
    update(id, { status }, `moved to ${statusMeta(status).label}`);
    if (status === "DONE") toast.success(`#${t.number} marked as Done`);
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return tickets.filter(
      (t) =>
        (!fType || t.type === fType) &&
        (!fAssignee || (fAssignee === "__none" ? !t.assignee : t.assignee === fAssignee)) &&
        (!s ||
          t.title.toLowerCase().includes(s) ||
          String(t.number).includes(s) ||
          (t.company ?? "").toLowerCase().includes(s) ||
          t.reporterName.toLowerCase().includes(s)),
    );
  }, [tickets, q, fType, fAssignee]);

  const unread = notifs.filter((n) => !n.read).length;
  const open = tickets.find((t) => t.id === openId) ?? null;

  const stats = [
    { label: "Open tickets", value: tickets.filter((t) => t.status !== "DONE").length },
    { label: "Open bugs", value: tickets.filter((t) => t.type === "BUG" && t.status !== "DONE").length },
    { label: "Feature requests", value: tickets.filter((t) => t.type === "FEATURE").length },
    { label: "Unassigned", value: tickets.filter((t) => !t.assignee && t.status !== "DONE").length },
    { label: "Resolved", value: tickets.filter((t) => t.status === "DONE").length },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Tickets &amp; Requests</h1>
          </div>
          <p className="text-sm text-muted-foreground">Bugs, feature requests and tasks reported across the platform.</p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu
            onOpenChange={(o) => {
              if (!o && unread) saveNotifications(notifs.map((n) => ({ ...n, read: true })));
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="relative">
                <Bell />
                {unread > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                    {unread}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 p-0">
              <div className="border-b px-3 py-2 text-sm font-medium">Notifications</div>
              <div className="max-h-80 overflow-y-auto">
                {notifs.length === 0 ? (
                  <p className="p-4 text-center text-sm text-muted-foreground">No notifications yet</p>
                ) : (
                  notifs.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => setOpenId(tickets.find((t) => t.number === n.ticketNumber)?.id ?? null)}
                      className={`block w-full border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted ${n.read ? "" : "bg-primary/5"}`}
                    >
                      <div className="line-clamp-2">{n.text}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(n.at), { addSuffix: true })} · emailed to admins
                      </div>
                    </button>
                  ))
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" asChild>
            <a href="/report" target="_blank" rel="noreferrer">
              <ExternalLink /> Public form
            </a>
          </Button>
          <Button variant="ghost" size="icon" title="Reset data" onClick={() => { resetDemo(); toast("data reset"); }}>
            <RotateCcw />
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus /> New ticket
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border bg-card p-3">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="text-2xl font-semibold">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search tickets, #, company…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className={selectCls} value={fType} onChange={(e) => setFType(e.target.value as TicketType | "")}>
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
        <select className={selectCls} value={fAssignee} onChange={(e) => setFAssignee(e.target.value)}>
          <option value="">Everyone</option>
          <option value="__none">Unassigned</option>
          {TEAM.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <div className="ml-auto flex rounded-lg border p-0.5">
          <Button size="sm" variant={view === "board" ? "secondary" : "ghost"} onClick={() => setView("board")}>
            <KanbanSquare /> Board
          </Button>
          <Button size="sm" variant={view === "table" ? "secondary" : "ghost"} onClick={() => setView("table")}>
            <Table2 /> Table
          </Button>
        </div>
      </div>

      {/* Board */}
      {view === "board" ? (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {STATUSES.map((col) => {
            const items = filtered.filter((t) => t.status === col.key);
            return (
              <div
                key={col.key}
                onDragOver={(e) => { e.preventDefault(); setDragOver(col.key); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => { e.preventDefault(); setDragOver(null); moveTo(e.dataTransfer.getData("text/plain"), col.key); }}
                className={`flex w-72 shrink-0 flex-col rounded-xl bg-muted/50 p-2 transition ${dragOver === col.key ? "ring-2 ring-primary/50" : ""}`}
              >
                <div className="mb-2 flex items-center gap-2 px-1">
                  <span className={`size-2.5 rounded-full ${col.color}`} />
                  <span className="text-sm font-semibold">{col.label}</span>
                  <span className="ml-auto rounded-full bg-background px-2 text-xs text-muted-foreground">{items.length}</span>
                </div>
                <div className="flex min-h-24 flex-col gap-2">
                  {items.map((t) => (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
                      onClick={() => setOpenId(t.id)}
                      className="cursor-grab rounded-lg border bg-card p-3 shadow-sm transition hover:shadow-md active:cursor-grabbing"
                    >
                      <div className="flex items-center gap-1.5">
                        <Pill className={typeMeta(t.type).className}>{typeMeta(t.type).label}</Pill>
                        <Pill className={prioMeta(t.priority).className}>{prioMeta(t.priority).label}</Pill>
                        <span className="ml-auto font-mono text-[11px] text-muted-foreground">#{t.number}</span>
                      </div>
                      <div className="mt-2 text-sm font-medium leading-snug">{t.title}</div>
                      {t.company && <div className="mt-1 text-xs text-muted-foreground">{t.company}</div>}
                      <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                        {t.dueDate && (
                          <span className="flex items-center gap-1"><Calendar className="size-3" />{format(new Date(t.dueDate), "MMM d")}</span>
                        )}
                        {t.comments.length > 0 && (
                          <span className="flex items-center gap-1"><MessageSquare className="size-3" />{t.comments.length}</span>
                        )}
                        <span className="ml-auto"><Avatar name={t.assignee} /></span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
          <table className="w-full min-w-240 text-sm">
            <thead className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-16 px-4 py-2.5 font-medium">#</th>
                <th className="px-3 py-2.5 font-medium">Ticket</th>
                <th className="w-32 px-1 py-2.5 text-center font-medium">Status</th>
                <th className="w-28 px-1 py-2.5 text-center font-medium">Priority</th>
                <th className="w-44 px-3 py-2.5 font-medium">Assigned to</th>
                <th className="w-44 px-3 py-2.5 font-medium">Reporter</th>
                <th className="w-24 px-3 py-2.5 font-medium">Due</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const overdue = t.dueDate && t.status !== "DONE" && t.dueDate < new Date().toISOString().slice(0, 10);
                return (
                  <tr key={t.id} className="group border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{t.number}</td>
                    <td className="px-3 py-2.5">
                      <button className="block max-w-105 truncate text-left font-medium group-hover:text-primary" onClick={() => setOpenId(t.id)} title={t.title}>
                        {t.title}
                      </button>
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Pill className={typeMeta(t.type).className}>{typeMeta(t.type).label}</Pill>
                        {t.area && <span>{t.area}</span>}
                        {t.comments.length > 0 && (
                          <span className="flex items-center gap-0.5"><MessageSquare className="size-3" />{t.comments.length}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-1 py-1.5">
                      <select
                        className={`${cellSelect} ${statusMeta(t.status).tone}`}
                        value={t.status}
                        onChange={(e) => moveTo(t.id, e.target.value as TicketStatus)}
                      >
                        {STATUSES.map((s) => <option key={s.key} value={s.key} className="bg-background text-foreground">{s.label}</option>)}
                      </select>
                    </td>
                    <td className="px-1 py-1.5">
                      <select
                        className={`${cellSelect} ${prioMeta(t.priority).className}`}
                        value={t.priority}
                        onChange={(e) => update(t.id, { priority: e.target.value as TicketPriority }, `set priority to ${prioMeta(e.target.value as TicketPriority).label}`)}
                      >
                        {PRIORITIES.map((p) => <option key={p.key} value={p.key} className="bg-background text-foreground">{p.label}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <select
                          className="w-full cursor-pointer appearance-none bg-transparent text-sm outline-none hover:underline"
                          value={t.assignee ?? ""}
                          onChange={(e) => update(t.id, { assignee: e.target.value || undefined }, e.target.value ? `assigned to ${e.target.value}` : "unassigned the ticket")}
                        >
                          <option value="">Unassigned</option>
                          {TEAM.map((m) => <option key={m}>{m}</option>)}
                        </select>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="truncate">{t.reporterName}</div>
                      <div className="truncate text-xs text-muted-foreground">{t.company ?? t.reporterEmail}</div>
                    </td>
                    <td className={`whitespace-nowrap px-3 py-2.5 text-xs ${overdue ? "font-semibold text-red-600" : "text-muted-foreground"}`}>
                      {t.dueDate ? format(new Date(t.dueDate), "MMM d") : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No tickets match your filters.</p>}
        </div>
      )}

      <TicketDetail ticket={open} onClose={() => setOpenId(null)} update={update} moveTo={moveTo} />
      <NewTicketDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function TicketDetail({
  ticket: t,
  onClose,
  update,
  moveTo,
}: {
  ticket: DemoTicket | null;
  onClose: () => void;
  update: (id: string, patch: Partial<DemoTicket>, activity?: string) => void;
  moveTo: (id: string, s: TicketStatus) => void;
}) {
  const [comment, setComment] = useState("");
  if (!t) return null;

  const addComment = () => {
    if (!comment.trim()) return;
    update(t.id, { comments: [...t.comments, { id: crypto.randomUUID(), author: ME, body: comment.trim(), at: new Date().toISOString() }] }, "added a comment");
    setComment("");
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <div className="flex items-center gap-1.5">
            <Pill className={typeMeta(t.type).className}>{typeMeta(t.type).label}</Pill>
            <span className="font-mono text-xs text-muted-foreground">#{t.number}</span>
          </div>
          <DialogTitle className="text-xl">{t.title}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[1fr_220px]">
          <div className="space-y-5">
            <div>
              <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Description</div>
              <p className="whitespace-pre-wrap text-sm">{t.description || "No description."}</p>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">Comments ({t.comments.length})</div>
              <div className="space-y-3">
                {t.comments.map((c) => (
                  <div key={c.id} className="flex gap-2">
                    <Avatar name={c.author} />
                    <div className="flex-1 rounded-lg bg-muted/60 p-2">
                      <div className="text-xs"><span className="font-medium">{c.author}</span> <span className="text-muted-foreground">· {formatDistanceToNow(new Date(c.at), { addSuffix: true })}</span></div>
                      <div className="text-sm">{c.body}</div>
                    </div>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Textarea rows={2} placeholder="Write a comment…" value={comment} onChange={(e) => setComment(e.target.value)} />
                  <Button onClick={addComment} className="self-end">Post</Button>
                </div>
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">Activity</div>
              <ul className="space-y-1.5 border-l pl-3 text-xs text-muted-foreground">
                {[...t.activity].reverse().map((a, i) => (
                  <li key={i}>{a.text} · {formatDistanceToNow(new Date(a.at), { addSuffix: true })}</li>
                ))}
              </ul>
            </div>
          </div>

          <aside className="space-y-3 text-sm">
            <Field label="Status">
              <select className={`${selectCls} w-full`} value={t.status} onChange={(e) => moveTo(t.id, e.target.value as TicketStatus)}>
                {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select className={`${selectCls} w-full`} value={t.priority} onChange={(e) => update(t.id, { priority: e.target.value as TicketPriority }, `set priority to ${prioMeta(e.target.value as TicketPriority).label}`)}>
                {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="Assignee">
              <select className={`${selectCls} w-full`} value={t.assignee ?? ""} onChange={(e) => update(t.id, { assignee: e.target.value || undefined }, e.target.value ? `assigned to ${e.target.value}` : "unassigned the ticket")}>
                <option value="">Unassigned</option>
                {TEAM.map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Due date">
              <Input type="date" value={t.dueDate ?? ""} onChange={(e) => update(t.id, { dueDate: e.target.value || undefined }, "changed the due date")} />
            </Field>
            <Field label="Area">{t.area ?? "—"}</Field>
            <Field label="Reported by">
              <div>{t.reporterName}</div>
              <div className="text-xs text-muted-foreground">{t.reporterEmail}</div>
              {t.company && <div className="text-xs text-muted-foreground">{t.company}</div>}
            </Field>
            {t.labels.length > 0 && (
              <Field label="Labels">
                <div className="flex flex-wrap gap-1">{t.labels.map((l) => <Pill key={l} className="bg-muted text-foreground">{l}</Pill>)}</div>
              </Field>
            )}
            <Field label="Created">{format(new Date(t.createdAt), "MMM d, yyyy h:mm a")}</Field>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function NewTicketDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ type: "BUG" as TicketType, title: "", description: "", priority: "MEDIUM" as TicketPriority, area: AREAS[0] });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New ticket</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const t = createTicket({ ...f, reporterName: ME, reporterEmail: "team@bitzsol.com" }, false);
            toast.success(`Ticket #${t.number} created`);
            setF((x) => ({ ...x, title: "", description: "" }));
            onClose();
          }}
        >
          <Input required placeholder="Title" value={f.title} onChange={set("title")} />
          <Textarea rows={4} placeholder="Description" value={f.description} onChange={set("description")} />
          <div className="grid grid-cols-3 gap-2">
            <select className={selectCls} value={f.type} onChange={set("type")}>
              {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            <select className={selectCls} value={f.priority} onChange={set("priority")}>
              {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            <select className={selectCls} value={f.area} onChange={set("area")}>
              {AREAS.map((a) => <option key={a}>{a}</option>)}
            </select>
          </div>
          <Button type="submit" className="w-full">Create ticket</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
