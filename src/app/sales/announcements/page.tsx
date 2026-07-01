"use client";

import { useState } from "react";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Megaphone,
  Plus,
  Mail,
  MessageSquare,
  Users,
  Send,
  Calendar,
  Layers,
  ChevronRight,
  TrendingUp,
  CheckCircle,
  FileText
} from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { motion } from "framer-motion";

const mockBroadcasts = [
  { id: "B-01", subject: "New Community Launch: Pinecrest Springs", status: "Sent", recipients: 2450, channel: "Email & SMS", date: "2026-06-08", clicks: 312 },
  { id: "B-02", subject: "Mortgage rates are trending down!", status: "Sent", recipients: 1840, channel: "Email Only", date: "2026-06-05", clicks: 198 },
  { id: "B-03", subject: "Join our open house event this Saturday", status: "Scheduled", recipients: 920, channel: "SMS Only", date: "2026-06-14", clicks: 0 }
];

export default function AnnouncementsPage() {
  const [broadcasts] = useState(mockBroadcasts);
  const [activeTab, setActiveTab] = useState<"past" | "create">("past");

  const [form, setForm] = useState({
    subject: "",
    channel: "email",
    segment: "all",
    body: "",
    scheduleDate: "",
  });

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success("Broadcast announcement queued in Inngest batch pipeline successfully!");
    setActiveTab("past");
  };

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
              <p className="text-muted-foreground text-sm mt-1">
                Author and send immediate or scheduled newsletters to target segments.
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
                    <div className="text-2xl font-bold">5,210</div>
                    <p className="text-[10px] text-muted-foreground mt-1">Across email and SMS networks</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-xs font-semibold text-gray-500 uppercase">Average Open Rate</CardTitle>
                    <Send className="h-4 w-4 text-[#0F3B3D]" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">42.8%</div>
                    <p className="text-[10px] text-muted-foreground mt-1">Industry builder avg: 22%</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-xs font-semibold text-gray-500 uppercase">CTA Engagement</CardTitle>
                    <TrendingUp className="h-4 w-4 text-green-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">510 clicks</div>
                    <p className="text-[10px] text-muted-foreground mt-1">9.7% click-to-open rate</p>
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
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-900 border-b text-xs font-semibold text-slate-400">
                          <th className="py-3 px-6">Subject / Topic</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4">Target Channel</th>
                          <th className="py-3 px-4">Recipients</th>
                          <th className="py-3 px-4">Clicks</th>
                          <th className="py-3 px-6">Sent Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {broadcasts.map((b) => (
                          <tr key={b.id} className="border-b dark:border-slate-800 hover:bg-slate-50/20 dark:hover:bg-slate-900/10 transition">
                            <td className="py-3.5 px-6 font-semibold">{b.subject}</td>
                            <td className="py-3.5 px-4">
                              <Badge className={b.status === "Sent" ? "bg-green-50 text-green-700 border-green-200/50 dark:bg-green-950/20 dark:text-green-400" : "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"}>
                                {b.status}
                              </Badge>
                            </td>
                            <td className="py-3.5 px-4 text-xs font-medium">{b.channel}</td>
                            <td className="py-3.5 px-4 text-xs font-semibold">{b.recipients}</td>
                            <td className="py-3.5 px-4 text-xs text-green-600 font-bold">{b.clicks || "—"}</td>
                            <td className="py-3.5 px-6 text-xs text-slate-400">{b.date}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : (
            <Card className="max-w-2xl border border-border/80 shadow-xs">
              <CardHeader className="border-b">
                <CardTitle className="text-sm font-bold">Author New Broadcast Announcement</CardTitle>
                <CardDescription className="text-xs">Subject to compliance layer rules (STOP/HELP opt-out flags).</CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <form onSubmit={handleSend} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="subject" className="font-semibold">Subject / Campaign Title</Label>
                    <Input
                      id="subject"
                      placeholder="e.g. Rate Drop Alert or Community update"
                      value={form.subject}
                      onChange={(e) => setForm(f => ({ ...f, subject: e.target.value }))}
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="font-semibold">Target Channel</Label>
                      <Select value={form.channel} onValueChange={(val) => setForm(f => ({ ...f, channel: val }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="email">Email Only</SelectItem>
                          <SelectItem value="sms">SMS Only (E.164 verification)</SelectItem>
                          <SelectItem value="both">Both Channels (Email & SMS)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="font-semibold">Target Segment</Label>
                      <Select value={form.segment} onValueChange={(val) => setForm(f => ({ ...f, segment: val }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Leads (Opt-in only)</SelectItem>
                          <SelectItem value="hot">Hot Prospects segment</SelectItem>
                          <SelectItem value="texas">Texas Region leads</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="body" className="font-semibold">Message Body</Label>
                    <textarea
                      id="body"
                      rows={6}
                      placeholder="Input message content here. Merge tags like {firstName} or {companyName} are supported."
                      value={form.body}
                      onChange={(e) => setForm(f => ({ ...f, body: e.target.value }))}
                      required
                      className="w-full bg-background border p-4 text-xs rounded-xl focus:ring-1 focus:ring-[#b48c3c]"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="schedule" className="font-semibold">Schedule Date & Time (Optional)</Label>
                    <Input
                      id="schedule"
                      type="datetime-local"
                      value={form.scheduleDate}
                      onChange={(e) => setForm(f => ({ ...f, scheduleDate: e.target.value }))}
                    />
                  </div>

                  <Button type="submit" className="w-full bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90">
                    Queue Broadcast Send
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
