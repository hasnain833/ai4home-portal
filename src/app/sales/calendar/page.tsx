"use client";

import { useState, useEffect } from "react";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Mail,
  MessageSquare,
  Bell,
  CheckCircle2
} from "lucide-react";
import { toast } from "sonner";

export default function ContentCalendarPage() {
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const fetchEvents = async () => {
    try {
      const res = await fetch("/api/sales/calendar");
      if (res.ok) {
        const data = await res.json();
        setEvents(data);
        setSuggestions(data.filter((e: any) => e.status === "Suggested"));
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

  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));

  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay();
  // Adjust so Monday is 0 and Sunday is 6
  const startOffset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;

  const monthName = currentDate.toLocaleString('default', { month: 'long' });
  const year = currentDate.getFullYear();

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
                Monitor and reschedule upcoming campaigns, broadcasts, and blog publishes.
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
                <CardHeader className="flex flex-row justify-between items-center p-4 border-b">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-5 w-5 text-[#b48c3c]" />
                    <span className="font-bold text-sm">{monthName} {year}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="grid grid-cols-7 text-center border-b dark:border-slate-800 text-xs font-semibold text-slate-400 py-2">
                    <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
                  </div>
                  <div className="grid grid-cols-7 min-h-[650px]">
                    {Array.from({ length: startOffset }).map((_, i) => (
                      <div key={`empty-${i}`} className="border-r border-b dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/5" />
                    ))}
                    {Array.from({ length: daysInMonth }).map((_, i) => {
                      const day = i + 1;
                      const today = new Date();
                      const isToday =
                        today.getFullYear() === currentDate.getFullYear() &&
                        today.getMonth() === currentDate.getMonth() &&
                        today.getDate() === day;
                      const currentMonthEvents = events.filter(e => {
                        if (!e.scheduledAt) return false;
                        const evtDate = new Date(e.scheduledAt);
                        return evtDate.getFullYear() === currentDate.getFullYear() &&
                          evtDate.getMonth() === currentDate.getMonth() &&
                          evtDate.getDate() === day;
                      });

                      return (
                        <div key={day} className={`border-r border-b dark:border-slate-800 p-2 text-left space-y-1.5 flex flex-col justify-between transition ${isToday ? "bg-[#b48c3c]/5 dark:bg-[#b48c3c]/10 ring-1 ring-inset ring-[#b48c3c]/40" : "hover:bg-slate-50/20 dark:hover:bg-slate-900/10"}`}>
                          {isToday ? (
                            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-[#b48c3c] text-white text-[10px] font-bold">{day}</span>
                          ) : (
                            <span className="text-[10px] font-bold text-slate-400">{day}</span>
                          )}
                          <div className="space-y-1 flex-1">
                            {currentMonthEvents.map((evt, idx) => {
                              const isDone = evt.isCompleted || evt.status === "Sent" || evt.status === "Published";
                              return (
                                <div
                                  key={evt.id || idx}
                                  className={`text-[9px] p-1 rounded font-medium border flex items-center gap-0.5 truncate ${isDone
                                    ? "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800/50 dark:text-slate-400 dark:border-slate-800"
                                    : evt.channel?.includes("Email")
                                      ? "bg-blue-50 text-blue-800 border-blue-100 dark:bg-blue-950/20 dark:text-blue-300 dark:border-blue-900/20"
                                      : "bg-amber-50 text-amber-800 border-amber-100 dark:bg-amber-950/20 dark:text-amber-300 dark:border-amber-900/20"
                                    }`}
                                >
                                  {isDone ? (
                                    <CheckCircle2 className="h-2.5 w-2.5 shrink-0 text-emerald-500 dark:text-emerald-400" />
                                  ) : evt.channel?.includes("Email") ? (
                                    <Mail className="h-2.5 w-2.5 shrink-0" />
                                  ) : (
                                    <MessageSquare className="h-2.5 w-2.5 shrink-0" />
                                  )}
                                  <span className={`truncate ${isDone ? "line-through opacity-80" : ""}`}>{evt.title}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
