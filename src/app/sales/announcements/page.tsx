"use client";

import { useState, useEffect, useCallback } from "react";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Users,
  Send,
  TrendingUp,
  Mail,
  X,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Announcement = {
  id: string;
  title: string;
  subject: string;
  channel: string;
  status: string;
  audienceType: string;
  segmentId: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
  audienceCount: number;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
  openedCount: number;
  clickedCount: number;
  unsubscribedCount: number;
  createdAt: string;
};

type Segment = { id: string; name: string };

const statusStyles: Record<string, string> = {
  Sent: "bg-green-50 text-green-700 border-green-200/50 dark:bg-green-950/20 dark:text-green-400",
  Queued: "bg-amber-50 text-amber-700 border-amber-200/50 dark:bg-amber-950/20 dark:text-amber-400",
  Sending: "bg-amber-50 text-amber-700 border-amber-200/50 dark:bg-amber-950/20 dark:text-amber-400",
  Scheduled: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  Draft: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  Cancelled: "bg-slate-100 text-slate-500 line-through dark:bg-slate-800",
  Failed: "bg-red-50 text-red-700 border-red-200/50 dark:bg-red-950/20 dark:text-red-400",
};

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<"past" | "create">("past");

  const [form, setForm] = useState({
    title: "",
    subject: "",
    channel: "EMAIL",
    segment: "all",
    body: "",
    ctaLink: "",
    scheduleDate: "",
  });

  const loadAnnouncements = useCallback(async () => {
    try {
      const res = await fetch("/api/sales/announcements");
      if (res.ok) setAnnouncements(await res.json());
    } catch {
      // silent — surfaced via toast on actions
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAnnouncements();
    fetch("/api/sales/segments")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setSegments(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [loadAnnouncements]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    const scheduling = !!form.scheduleDate;
    const payload = {
      title: form.title,
      subject: form.subject,
      channel: form.channel,
      body: form.body,
      ctaLink: form.ctaLink || null,
      audienceType: form.segment === "all" ? "ALL" : "SEGMENT",
      segmentId: form.segment === "all" ? null : form.segment,
      action: scheduling ? "schedule" : "send",
      scheduledAt: scheduling ? new Date(form.scheduleDate).toISOString() : null,
    };

    try {
      const res = await fetch("/api/sales/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message || "Failed to queue announcement");
        return;
      }
      toast.success(
        scheduling
          ? "Announcement scheduled — it will be sent to your leads at the set time."
          : "Announcement queued — fanning out to your leads now."
      );
      setForm({ title: "", subject: "", channel: "EMAIL", segment: "all", body: "", ctaLink: "", scheduleDate: "" });
      setActiveTab("past");
      loadAnnouncements();
    } catch {
      toast.error("Network error while sending announcement");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      const res = await fetch(`/api/sales/announcements/${id}/cancel`, { method: "POST" });
      if (res.ok) {
        toast.success("Scheduled announcement cancelled");
        loadAnnouncements();
      } else {
        const d = await res.json();
        toast.error(d.message || "Could not cancel");
      }
    } catch {
      toast.error("Network error");
    }
  };

  const totalReached = announcements.reduce((s, a) => s + a.sentCount, 0);
  const totalDelivered = announcements.reduce((s, a) => s + a.deliveredCount, 0);
  const totalClicks = announcements.reduce((s, a) => s + a.clickedCount, 0);
  const deliveryRate = totalReached > 0 ? ((totalDelivered / totalReached) * 100).toFixed(1) : "0.0";

  return (
    <ProtectedRoute allowedRoles={["admin", "staff"]}>
      <PortalLayout workspace="sales">
        <div className="space-y-6 max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
                Broadcast Announcements
              </h1>
              <p className="text-muted-foreground text-sm mt-1 flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" />
                Email &amp; SMS broadcasts sent to your leads through the compliance layer.
              </p>
            </div>
            <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-xl">
              <Button
                variant={activeTab === "past" ? "default" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("past")}
                className="h-8 text-xs font-semibold rounded-lg"
              >
                Past Sends
              </Button>
              <Button
                variant={activeTab === "create" ? "default" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("create")}
                className="h-8 text-xs font-semibold rounded-lg"
              >
                Create Broadcast
              </Button>
            </div>
          </div>

          {activeTab === "past" ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Broadcast statistics cards */}
              <div className="lg:col-span-3 grid gap-4 grid-cols-1 sm:grid-cols-3">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-xs font-semibold text-gray-500 uppercase">Recipients Reached</CardTitle>
                    <Users className="h-4 w-4 text-[#b48c3c]" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{totalReached.toLocaleString()}</div>
                    <p className="text-[10px] text-muted-foreground mt-1">Emails successfully sent across all broadcasts</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-xs font-semibold text-gray-500 uppercase">Delivery Rate</CardTitle>
                    <Send className="h-4 w-4 text-[#0F3B3D]" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{deliveryRate}%</div>
                    <p className="text-[10px] text-muted-foreground mt-1">{totalDelivered.toLocaleString()} confirmed delivered</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-xs font-semibold text-gray-500 uppercase">CTA Engagement</CardTitle>
                    <TrendingUp className="h-4 w-4 text-green-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{totalClicks.toLocaleString()} clicks</div>
                    <p className="text-[10px] text-muted-foreground mt-1">Link clicks tracked via webhooks</p>
                  </CardContent>
                </Card>
              </div>

              {/* History list */}
              <div className="lg:col-span-3">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-bold">Send History</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 overflow-x-auto">
                    {loading ? (
                      <div className="py-16 flex justify-center text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin" />
                      </div>
                    ) : announcements.length === 0 ? (
                      <div className="py-16 text-center text-sm text-muted-foreground">
                        No announcements yet. Click <span className="font-semibold">Create Broadcast</span> to send your first one.
                      </div>
                    ) : (
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="bg-slate-50 dark:bg-slate-900 border-b text-xs font-semibold text-slate-400">
                            <th className="py-3 px-6">Subject / Topic</th>
                            <th className="py-3 px-4">Status</th>
                            <th className="py-3 px-4">Audience</th>
                            <th className="py-3 px-4">Sent</th>
                            <th className="py-3 px-4">Failed</th>
                            <th className="py-3 px-4">Clicks</th>
                            <th className="py-3 px-6">Date</th>
                            <th className="py-3 px-4"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {announcements.map((a) => (
                            <tr key={a.id} className="border-b dark:border-slate-800 hover:bg-slate-50/20 dark:hover:bg-slate-900/10 transition">
                              <td className="py-3.5 px-6 font-semibold">
                                {a.title}
                                <div className="text-[11px] font-normal text-slate-400">{a.subject}</div>
                              </td>
                              <td className="py-3.5 px-4">
                                <Badge className={statusStyles[a.status] || statusStyles.Draft}>{a.status}</Badge>
                              </td>
                              <td className="py-3.5 px-4 text-xs font-medium">{a.audienceCount || "—"}</td>
                              <td className="py-3.5 px-4 text-xs font-semibold">{a.sentCount}</td>
                              <td className="py-3.5 px-4 text-xs text-red-500 font-medium">{a.failedCount || "—"}</td>
                              <td className="py-3.5 px-4 text-xs text-green-600 font-bold">{a.clickedCount || "—"}</td>
                              <td className="py-3.5 px-6 text-xs text-slate-400">
                                {a.sentAt
                                  ? new Date(a.sentAt).toLocaleDateString()
                                  : a.scheduledAt
                                  ? `⏱ ${new Date(a.scheduledAt).toLocaleString()}`
                                  : new Date(a.createdAt).toLocaleDateString()}
                              </td>
                              <td className="py-3.5 px-4">
                                {a.status === "Scheduled" && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-[11px] text-red-500 hover:text-red-600"
                                    onClick={() => handleCancel(a.id)}
                                  >
                                    <X className="h-3 w-3 mr-1" /> Cancel
                                  </Button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : (
            <Card className="max-w-2xl border border-border/80 shadow-xs">
              <CardHeader className="border-b">
                <CardTitle className="text-sm font-bold">Author New Broadcast Announcement</CardTitle>
                <CardDescription className="text-xs">
                  Broadcast to every targeted lead by email and/or SMS. Opted-out, suppressed, and (for SMS) quiet-hours contacts are skipped automatically by the compliance layer.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <form onSubmit={handleSend} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="title" className="font-semibold">Title / Internal Name</Label>
                    <Input
                      id="title"
                      placeholder="e.g. Rate Drop Alert or Community update"
                      value={form.title}
                      onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="font-semibold">Channel</Label>
                      <Select value={form.channel} onValueChange={(val) => setForm((f) => ({ ...f, channel: val }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="EMAIL">Email only</SelectItem>
                          <SelectItem value="SMS">SMS only</SelectItem>
                          <SelectItem value="BOTH">Email &amp; SMS</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="font-semibold">Target Audience</Label>
                      <Select value={form.segment} onValueChange={(val) => setForm((f) => ({ ...f, segment: val }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Leads (opt-in only)</SelectItem>
                          {segments.map((s) => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {form.channel !== "SMS" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="subject" className="font-semibold">Email Subject Line</Label>
                      <Input
                        id="subject"
                        placeholder="What recipients see in their inbox"
                        value={form.subject}
                        onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                        required={form.channel !== "SMS"}
                      />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="body" className="font-semibold">Message Body</Label>
                    <textarea
                      id="body"
                      rows={6}
                      placeholder="Input message content here. Merge tags like {firstName} or {companyName} are supported."
                      value={form.body}
                      onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                      required
                      className="w-full bg-background border p-4 text-xs rounded-xl focus:ring-1 focus:ring-[#b48c3c]"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="cta" className="font-semibold">CTA Link (Optional)</Label>
                    <Input
                      id="cta"
                      placeholder="https://yourbuilder.com/new-homes"
                      value={form.ctaLink}
                      onChange={(e) => setForm((f) => ({ ...f, ctaLink: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="schedule" className="font-semibold">Schedule Date & Time (Optional)</Label>
                    <Input
                      id="schedule"
                      type="datetime-local"
                      value={form.scheduleDate}
                      onChange={(e) => setForm((f) => ({ ...f, scheduleDate: e.target.value }))}
                    />
                    <p className="text-[10px] text-muted-foreground">Leave blank to send immediately.</p>
                  </div>

                  <Button
                    type="submit"
                    disabled={submitting}
                    className="w-full bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90"
                  >
                    {submitting ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Queuing…</>
                    ) : form.scheduleDate ? (
                      "Schedule Broadcast"
                    ) : (
                      "Send Broadcast Now"
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
