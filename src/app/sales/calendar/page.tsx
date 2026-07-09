"use client";

import { useState, useEffect } from "react";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CalendarDays,
  CalendarRange,
  List,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Mail,
  MessageSquare,
  Megaphone,
  CheckCircle2
} from "lucide-react";
import { toast } from "sonner";

type CalendarEvent = {
  id: string;
  title?: string;
  topic?: string;
  channel?: string;
  scheduledAt?: string;
  date?: string;
  status?: string;
  content?: string;
  outline?: string;
  reason?: string;
  isCompleted?: boolean;
  // Discriminator: manual ContentCalendar items have no `type`; campaign
  // aggregations use "campaign_aggregation"; announcements use "announcement".
  type?: string;
};

type ViewMode = "month" | "week" | "list";

const NON_EDITABLE = new Set(["Sent", "Published", "Dismissed"]);
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Only manual content-calendar items in an editable state can be dragged; campaign
// sends and announcements are managed elsewhere and are read-only here.
const isDraggable = (evt: CalendarEvent) =>
  !evt.type && !!evt.id && !NON_EDITABLE.has(evt.status || "");

// Monday-based start of the week containing `d`.
const startOfWeek = (d: Date) => {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = date.getDay();
  const offset = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - offset);
  return date;
};

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export default function ContentCalendarPage() {
  const [suggestions, setSuggestions] = useState<CalendarEvent[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [view, setView] = useState<ViewMode>("month");
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const fetchEvents = async () => {
    try {
      const res = await fetch("/api/sales/calendar");
      if (res.ok) {
        const data = await res.json();
        setEvents(data);
        setSuggestions(data.filter((e: CalendarEvent) => e.status === "Suggested"));
      }
    } catch (err) {
      console.error("Failed to fetch calendar events", err);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  const handleGenerateSuggestions = async () => {
    setIsGenerating(true);
    try {
      const res = await fetch("/api/sales/calendar/suggestions", { method: "POST" });
      if (res.ok) {
        await fetchEvents();
      } else {
        toast.error("Failed to generate suggestions.");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApproveSuggestion = async (id: string) => {
    try {
      const res = await fetch(`/api/sales/calendar/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Draft" })
      });
      if (res.ok) {
        toast.success("Suggestion approved and converted to draft calendar slot!");
        fetchEvents();
      } else {
        toast.error("Failed to approve suggestion.");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDismissSuggestion = async (id: string) => {
    try {
      const res = await fetch(`/api/sales/calendar/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Dismissed" })
      });
      if (res.ok) {
        fetchEvents();
      } else {
        toast.error("Failed to dismiss suggestion.");
      }
    } catch (err) {
      console.error(err);
    }
  };

  // SW-CAL-004: drag an item onto another day to reschedule it. Preserves the
  // original time-of-day and only moves the date; the backend re-validates the
  // future-date + SMS quiet-hours rules and rejects invalid drops.
  const handleDropOnDay = async (targetDay: Date) => {
    const id = draggedId;
    setDraggedId(null);
    if (!id) return;

    const evt = events.find((e) => e.id === id);
    if (!evt || !evt.scheduledAt) return;

    const old = new Date(evt.scheduledAt);
    if (sameDay(old, targetDay)) return;

    const target = new Date(targetDay);
    target.setHours(old.getHours(), old.getMinutes(), 0, 0);

    // Optimistic move.
    const iso = target.toISOString();
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, scheduledAt: iso } : e)));

    try {
      const res = await fetch(`/api/sales/calendar/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt: iso })
      });
      if (res.ok) {
        toast.success(`Rescheduled to ${target.toLocaleDateString()}`);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.message || "Could not reschedule that item.");
      }
    } catch {
      toast.error("Could not reschedule that item.");
    } finally {
      fetchEvents();
    }
  };

  // ── Navigation adapts to the active view ──────────────────────────────────
  const shift = (dir: 1 | -1) => {
    if (view === "week") {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + dir * 7));
    } else {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + dir, 1));
    }
  };

  const eventsForDay = (day: Date) =>
    events.filter((e) => e.scheduledAt && sameDay(new Date(e.scheduledAt), day));

  const rangeTitle = () => {
    if (view === "week") {
      const ws = startOfWeek(currentDate);
      const we = new Date(ws);
      we.setDate(we.getDate() + 6);
      return `${ws.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${we.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
    }
    return `${currentDate.toLocaleString("default", { month: "long" })} ${currentDate.getFullYear()}`;
  };

  const EventPill = ({ evt }: { evt: CalendarEvent }) => {
    const isDone = evt.isCompleted || evt.status === "Sent" || evt.status === "Published";
    const draggable = isDraggable(evt);
    const isAnnouncement = evt.type === "announcement";
    return (
      <div
        draggable={draggable}
        onDragStart={(e) => {
          setDraggedId(evt.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => setDraggedId(null)}
        title={draggable ? "Drag to another day to reschedule" : evt.title}
        className={`text-[9px] p-1 rounded font-medium border flex items-center gap-0.5 truncate ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${isDone
          ? "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800/50 dark:text-slate-400 dark:border-slate-800"
          : isAnnouncement
            ? "bg-purple-50 text-purple-800 border-purple-100 dark:bg-purple-950/20 dark:text-purple-300 dark:border-purple-900/20"
            : evt.channel?.includes("Email")
              ? "bg-blue-50 text-blue-800 border-blue-100 dark:bg-blue-950/20 dark:text-blue-300 dark:border-blue-900/20"
              : "bg-amber-50 text-amber-800 border-amber-100 dark:bg-amber-950/20 dark:text-amber-300 dark:border-amber-900/20"
          }`}
      >
        {isDone ? (
          <CheckCircle2 className="h-2.5 w-2.5 shrink-0 text-emerald-500 dark:text-emerald-400" />
        ) : isAnnouncement ? (
          <Megaphone className="h-2.5 w-2.5 shrink-0" />
        ) : evt.channel?.includes("Email") ? (
          <Mail className="h-2.5 w-2.5 shrink-0" />
        ) : (
          <MessageSquare className="h-2.5 w-2.5 shrink-0" />
        )}
        <span className={`truncate ${isDone ? "line-through opacity-80" : ""}`}>{evt.title}</span>
      </div>
    );
  };

  const DayCell = ({ day, tall }: { day: Date; tall?: boolean }) => {
    const today = new Date();
    const isToday = sameDay(day, today);
    const dayEvents = eventsForDay(day);
    return (
      <div
        onDragOver={(e) => {
          if (draggedId) e.preventDefault();
        }}
        onDrop={() => handleDropOnDay(day)}
        className={`border-r border-b dark:border-slate-800 p-2 text-left space-y-1.5 flex flex-col ${tall ? "min-h-[120px]" : ""} transition ${draggedId ? "hover:bg-indigo-50/40 dark:hover:bg-indigo-950/10" : ""} ${isToday ? "bg-[#b48c3c]/5 dark:bg-[#b48c3c]/10 ring-1 ring-inset ring-[#b48c3c]/40" : "hover:bg-slate-50/20 dark:hover:bg-slate-900/10"}`}
      >
        {isToday ? (
          <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-[#b48c3c] text-white text-[10px] font-bold">{day.getDate()}</span>
        ) : (
          <span className="text-[10px] font-bold text-slate-400">{day.getDate()}</span>
        )}
        <div className="space-y-1 flex-1">
          {dayEvents.map((evt, idx) => (
            <EventPill key={evt.id || idx} evt={evt} />
          ))}
        </div>
      </div>
    );
  };

  // ── Month grid ────────────────────────────────────────────────────────────
  const renderMonth = () => {
    const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
    const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay();
    const startOffset = firstDay === 0 ? 6 : firstDay - 1;
    return (
      <>
        <div className="grid grid-cols-7 text-center border-b dark:border-slate-800 text-xs font-semibold text-slate-400 py-2">
          {WEEKDAYS.map((d) => <span key={d}>{d}</span>)}
        </div>
        <div className="grid grid-cols-7 min-h-[650px]">
          {Array.from({ length: startOffset }).map((_, i) => (
            <div key={`empty-${i}`} className="border-r border-b dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/5" />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => (
            <DayCell key={i} day={new Date(currentDate.getFullYear(), currentDate.getMonth(), i + 1)} />
          ))}
        </div>
      </>
    );
  };

  // ── Week grid ─────────────────────────────────────────────────────────────
  const renderWeek = () => {
    const ws = startOfWeek(currentDate);
    const days = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(ws);
      d.setDate(d.getDate() + i);
      return d;
    });
    return (
      <>
        <div className="grid grid-cols-7 text-center border-b dark:border-slate-800 text-xs font-semibold text-slate-400 py-2">
          {days.map((d, i) => (
            <span key={i}>{WEEKDAYS[i]} <span className="text-slate-300 dark:text-slate-600">{d.getDate()}</span></span>
          ))}
        </div>
        <div className="grid grid-cols-7 min-h-[500px]">
          {days.map((d, i) => <DayCell key={i} day={d} tall />)}
        </div>
      </>
    );
  };

  // ── List view ─────────────────────────────────────────────────────────────
  const renderList = () => {
    const monthEvents = events
      .filter((e) => {
        if (!e.scheduledAt) return false;
        const d = new Date(e.scheduledAt);
        return d.getFullYear() === currentDate.getFullYear() && d.getMonth() === currentDate.getMonth();
      })
      .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());

    if (monthEvents.length === 0) {
      return <div className="py-16 text-center text-sm text-muted-foreground">No scheduled items this month.</div>;
    }

    return (
      <div className="divide-y dark:divide-slate-800">
        {monthEvents.map((evt) => {
          const d = new Date(evt.scheduledAt!);
          const isDone = evt.isCompleted || evt.status === "Sent" || evt.status === "Published";
          const isAnnouncement = evt.type === "announcement";
          const isCampaign = evt.type === "campaign_aggregation";
          return (
            <div key={evt.id} className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50/40 dark:hover:bg-slate-900/10">
              <div className="w-16 shrink-0 text-center">
                <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{d.toLocaleString("default", { month: "short" })}</div>
                <div className="text-lg font-bold text-slate-700 dark:text-slate-200">{d.getDate()}</div>
              </div>
              <div className="shrink-0">
                {isAnnouncement ? <Megaphone className="h-4 w-4 text-purple-500" /> : evt.channel?.includes("Email") ? <Mail className="h-4 w-4 text-blue-500" /> : <MessageSquare className="h-4 w-4 text-amber-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-medium truncate ${isDone ? "line-through text-slate-400" : "text-slate-800 dark:text-slate-200"}`}>{evt.title}</div>
                <div className="text-xs text-muted-foreground">{d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {evt.channel}</div>
              </div>
              <Badge variant="outline" className="text-[10px] shrink-0">
                {isCampaign ? "Campaign" : isAnnouncement ? "Announcement" : evt.status || "Content"}
              </Badge>
            </div>
          );
        })}
      </div>
    );
  };

  const viewButton = (mode: ViewMode, label: string, Icon: typeof CalendarDays) => (
    <Button
      variant={view === mode ? "secondary" : "ghost"}
      size="sm"
      onClick={() => setView(mode)}
      className="h-8 gap-1.5 text-xs"
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </Button>
  );

  return (
    <ProtectedRoute allowedRoles={["admin", "staff"]}>
      <PortalLayout workspace="sales">
        <div className="space-y-6 max-w-7xl mx-auto relative">
          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
                Content & Send Calendar
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                Monitor and reschedule upcoming campaigns, broadcasts, and blog publishes. Drag an item to another day to reschedule.
              </p>
            </div>
            <div className="flex gap-2 items-center">
              {/* Notification Bell Dropdown */}
              <div className="relative">
                <Button
                  onClick={() => setShowSuggestions(!showSuggestions)}
                  variant="outline"
                  className="relative h-9 w-9 border-indigo-200 text-indigo-600 bg-indigo-50/50 hover:bg-indigo-50 dark:border-indigo-900/50 dark:bg-indigo-900/20"
                >
                  <Sparkles className="h-4 w-4" />
                  {suggestions.length > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 border-2 border-white dark:border-slate-900"></span>
                    </span>
                  )}
                </Button>

                {showSuggestions && (
                  <div className="absolute right-0 top-11 z-50 w-[320px] sm:w-[380px] bg-white dark:bg-slate-950 border dark:border-slate-800 rounded-xl shadow-xl overflow-hidden animate-in slide-in-from-top-2 fade-in duration-200">
                    <div className="p-4 border-b dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20">
                      <h3 className="font-bold flex items-center gap-2 text-sm">
                        <Sparkles className="h-4 w-4 text-indigo-500" />
                        AI Suggested Slots
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1">Identified outreach gaps & local events</p>
                    </div>
                    <div className="p-4 max-h-[400px] overflow-y-auto space-y-3">
                      {suggestions.length > 0 ? (
                        suggestions.map((s) => (
                          <div key={s.id} className="p-3 border dark:border-slate-800 bg-white dark:bg-slate-950 rounded-xl space-y-2 shadow-sm">
                            <div className="flex justify-between items-center text-[10px]">
                              <Badge className="bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 font-semibold">{s.channel}</Badge>
                              <span className="text-slate-400 font-bold">
                                {s.scheduledAt ? new Date(s.scheduledAt).toLocaleDateString() : s.date}
                              </span>
                            </div>
                            <h4 className="font-bold text-sm text-slate-800 dark:text-slate-200">{s.title || s.topic}</h4>
                            <p className="text-xs text-muted-foreground">{s.content || s.outline}</p>
                            <p className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold italic">★ {s.reason}</p>
                            <div className="flex gap-2 mt-2">
                              <Button
                                onClick={() => handleApproveSuggestion(s.id)}
                                className="flex-1 h-8 text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg"
                              >
                                Approve
                              </Button>
                              <Button
                                onClick={() => handleDismissSuggestion(s.id)}
                                variant="outline"
                                className="h-8 text-xs font-semibold rounded-lg text-slate-600 hover:text-red-600"
                              >
                                Dismiss
                              </Button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-center text-slate-400 py-6">All suggestions processed.</p>
                      )}

                      <Button
                        onClick={handleGenerateSuggestions}
                        disabled={isGenerating}
                        className="w-full mt-2"
                        variant="secondary"
                      >
                        {isGenerating ? "Generating..." : "Generate New Suggestions"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="w-full">
            <div className="space-y-4">
              <Card>
                <CardHeader className="flex flex-row justify-between items-center p-4 border-b gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-5 w-5 text-[#b48c3c]" />
                    <span className="font-bold text-sm">{rangeTitle()}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* View switcher */}
                    <div className="flex items-center gap-1 rounded-lg border p-0.5 dark:border-slate-800">
                      {viewButton("month", "Month", CalendarDays)}
                      {viewButton("week", "Week", CalendarRange)}
                      {viewButton("list", "List", List)}
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {view === "month" && renderMonth()}
                  {view === "week" && renderWeek()}
                  {view === "list" && renderList()}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
