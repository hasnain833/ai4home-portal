"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import {
  Users,
  Calendar,
  Layers,
  ArrowUpRight,
  TrendingUp,
  Activity,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  RefreshCw,
  Plus,
  Mail,
  MessageSquare
} from "lucide-react";
import { motion } from "framer-motion";

// Mock Data representing CRM and CSV ingested leads
const initialLeads = [
  { id: "L-9021", name: "Sarah Jenkins", email: "sarah.j@example.com", phone: "+1 (555) 019-2834", status: "Engaged", source: "Salesforce Sync", owner: "Alex Chen", date: "2026-06-12" },
  { id: "L-9022", name: "David Miller", email: "david.m@example.com", phone: "+1 (555) 014-9988", status: "New", source: "CSV Upload", owner: "Alex Chen", date: "2026-06-12" },
  { id: "L-9023", name: "Emily Watson", email: "emily.w@example.com", phone: "+1 (555) 017-7722", status: "Appointment Set", source: "Salesforce Sync", owner: "Jessica Smith", date: "2026-06-11" },
  { id: "L-9024", name: "Michael Chang", email: "m.chang@example.com", phone: "+1 (555) 012-3344", status: "Nurturing", source: "Manual Input", owner: "Jessica Smith", date: "2026-06-10" },
  { id: "L-9025", name: "Amanda Ross", email: "amanda.ross@example.com", phone: "+1 (555) 015-5566", status: "Qualified", source: "Salesforce Sync", owner: "Alex Chen", date: "2026-06-09" }
];

const mockAppointments = [
  { id: "A-501", leadName: "Emily Watson", type: "Model Home Tour", time: "Tomorrow at 2:00 PM", status: "Confirmed", agent: "Jessica Smith" },
  { id: "A-502", leadName: "Sarah Jenkins", type: "Initial Consultation", time: "June 15 at 10:00 AM", status: "Confirmed", agent: "Alex Chen" },
  { id: "A-503", leadName: "James Carter", type: "Design Center Review", time: "June 18 at 4:30 PM", status: "Pending", agent: "Alex Chen" }
];

const mockSequences = [
  { name: "First-Time Homebuyer Campaign", channel: "Email & SMS", steps: 12, enrolled: 1420, active: 840, conversionRate: 8.4 },
  { name: "Model Home Tour Follow-up", channel: "Email Only", steps: 5, enrolled: 310, active: 45, conversionRate: 15.2 },
  { name: "Interest Rate Drop Alert", channel: "SMS Only", steps: 2, enrolled: 2450, active: 2450, conversionRate: 4.8 }
];

const statusColors: Record<string, string> = {
  New: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200/50",
  Nurturing: "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300 border-slate-200/50",
  Engaged: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200/50",
  "Appointment Set": "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 border-purple-200/50",
  Qualified: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-200/50"
};

const fadeInUp = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } }
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 }
  }
};

export default function SalesDashboardPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState(initialLeads);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState("12 minutes ago");

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 800);
    return () => clearTimeout(timer);
  }, []);

  const handleSync = () => {
    setSyncing(true);
    setTimeout(() => {
      setSyncing(false);
      setLastSync("Just now");
      // Add a fresh lead to simulate incoming CRM data
      setLeads(prev => [
        { id: `L-${Math.floor(1000 + Math.random() * 9000)}`, name: "Robert Downey", email: "r.downey@example.com", phone: "+1 (555) 011-8833", status: "New", source: "Salesforce Sync", owner: "Alex Chen", date: "Just now" },
        ...prev
      ]);
    }, 1500);
  };

  const handleExportCSV = () => {
    const headers = ["Lead ID", "Name", "Email", "Phone", "Status", "Source", "Owner", "Ingested Date"];
    const rows = leads.map(l => [l.id, l.name, l.email, l.phone, l.status, l.source, l.owner, l.date]);
    const csvContent = "data:text/csv;charset=utf-8,"
      + [headers.join(","), ...rows.map(e => e.map(val => `"${val}"`).join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `sales_leads_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <ProtectedRoute allowedRoles={["admin", "staff"]}>
      <PortalLayout workspace="sales">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="space-y-6 max-w-7xl mx-auto"
        >
          {/* Welcome Header */}
          <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
                Sales Hub Dashboard
              </h1>
              <p className="text-muted-foreground mt-1">
                Manage, nurture, and automate outreach to your homebuilder prospects.
              </p>
            </div>
            <div className="flex gap-2.5">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSync}
                disabled={syncing}
                className="gap-2 h-9 font-medium"
              >
                <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing CRM..." : "Sync Salesforce"}
              </Button>
              <Button
                onClick={handleExportCSV}
                variant="outline"
                size="sm"
                className="gap-2 h-9 font-medium border-dashed border-[#b48c3c]/50 text-[#b48c3c] hover:bg-[#b48c3c]/10"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Export CSV
              </Button>
            </div>
          </motion.div>

          {/* Quick Metrics */}
          <motion.div variants={fadeInUp} className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {loading ? (
              Array(4).fill(0).map((_, i) => (
                <Card key={i}>
                  <CardHeader className="pb-2"><Skeleton className="h-4 w-24" /></CardHeader>
                  <CardContent><Skeleton className="h-8 w-16" /><Skeleton className="h-3 w-32 mt-2" /></CardContent>
                </Card>
              ))
            ) : (
              <>
                <Card className="hover:shadow-md transition-all">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-gray-500 dark:text-slate-400">Total Leads Ingested</CardTitle>
                    <Users className="h-4 w-4 text-[#b48c3c]" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{leads.length + 840}</div>
                    <p className="text-xs text-muted-foreground mt-1">Combined Salesforce + CSV rows</p>
                  </CardContent>
                </Card>

                <Card className="hover:shadow-md transition-all">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-gray-500 dark:text-slate-400">Active Campaigns</CardTitle>
                    <Layers className="h-4 w-4 text-[#0F3B3D]" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{mockSequences.length}</div>
                    <p className="text-xs text-muted-foreground mt-1">3,335 enrolled recipients</p>
                  </CardContent>
                </Card>

                <Card className="hover:shadow-md transition-all">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-gray-500 dark:text-slate-400">Model Home Bookings</CardTitle>
                    <Calendar className="h-4 w-4 text-green-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{mockAppointments.length}</div>
                    <p className="text-xs text-muted-foreground mt-1">Next booking: Tomorrow 2 PM</p>
                  </CardContent>
                </Card>

                <Card className="hover:shadow-md transition-all">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-gray-500 dark:text-slate-400">Avg Lead Conversion</CardTitle>
                    <TrendingUp className="h-4 w-4 text-emerald-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">9.4%</div>
                    <p className="text-xs text-muted-foreground mt-1">Lead $\rightarrow$ Appointment Rate</p>
                  </CardContent>
                </Card>
              </>
            )}
          </motion.div>

          {/* Main Dashboard Grid */}
          <motion.div variants={fadeInUp} className="grid gap-6 grid-cols-1 lg:grid-cols-3">
            {/* Ingested Leads Table */}
            <Card className="lg:col-span-2 overflow-hidden shadow-xs border border-border/80">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-md font-bold text-slate-800 dark:text-slate-100">Recently Ingested Leads</CardTitle>
                  <CardDescription>Live prospects synchronized from Salesforce or uploaded via CSV.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-900/40 border-b border-border/60">
                      <th className="py-3 px-4 font-semibold text-xs text-muted-foreground pl-6">ID</th>
                      <th className="py-3 px-4 font-semibold text-xs text-muted-foreground">Prospect Name</th>
                      <th className="py-3 px-4 font-semibold text-xs text-muted-foreground">Status</th>
                      <th className="py-3 px-4 font-semibold text-xs text-muted-foreground">Ingestion Source</th>
                      <th className="py-3 px-4 font-semibold text-xs text-muted-foreground pr-6">Date Ingested</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      Array(3).fill(0).map((_, i) => (
                        <tr key={i}>
                          <td colSpan={5} className="py-4 px-6"><Skeleton className="h-6 w-full" /></td>
                        </tr>
                      ))
                    ) : (
                      leads.slice(0, 5).map((lead) => (
                        <tr key={lead.id} className="border-b border-border/40 hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition-colors">
                          <td className="py-3.5 px-4 pl-6 font-mono text-xs font-semibold text-[#b48c3c]">{lead.id}</td>
                          <td className="py-3.5 px-4 font-medium text-slate-800 dark:text-slate-200">
                            <div>
                              <p className="text-sm font-semibold">{lead.name}</p>
                              <p className="text-xs text-muted-foreground">{lead.email}</p>
                            </div>
                          </td>
                          <td className="py-3.5 px-4">
                            <Badge variant="outline" className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold border ${statusColors[lead.status]}`}>
                              {lead.status}
                            </Badge>
                          </td>
                          <td className="py-3.5 px-4 text-xs text-slate-600 dark:text-slate-400 font-medium">{lead.source}</td>
                          <td className="py-3.5 px-4 pr-6 text-xs text-muted-foreground">{lead.date}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* Upcoming Appointments & Campaigns */}
            <div className="space-y-6">
              {/* Appointments Card */}
              <Card className="border border-border/80 shadow-xs">
                <CardHeader>
                  <CardTitle className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <Calendar className="h-4.5 w-4.5 text-[#b48c3c]" />
                    Upcoming Appointments
                  </CardTitle>
                  <CardDescription>Bookings scheduled by the AI Assistant and manual links.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {mockAppointments.map((appt) => (
                    <div key={appt.id} className="p-3 border dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/20 hover:bg-slate-50 dark:hover:bg-slate-900/30 transition rounded-lg">
                      <div className="flex justify-between items-start">
                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{appt.leadName}</p>
                        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-400 border-emerald-200/50 text-[10px]">
                          {appt.status}
                        </Badge>
                      </div>
                      <p className="text-[11px] font-medium text-slate-500 mt-1">{appt.type}</p>
                      <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                        <Calendar className="h-3 w-3" /> {appt.time}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Nurture Campaigns Overview */}
              <Card className="border border-border/80 shadow-xs">
                <CardHeader>
                  <CardTitle className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <Layers className="h-4.5 w-4.5 text-[#0F3B3D]" />
                    Nurture Sequences
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3.5">
                  {mockSequences.slice(0, 2).map((seq, i) => (
                    <div key={i} className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="font-semibold truncate max-w-[200px]" title={seq.name}>{seq.name}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">{seq.channel}</span>
                      </div>
                      <div className="flex justify-between items-center text-[10px] text-muted-foreground">
                        <span>Active: <strong className="text-foreground">{seq.active}</strong> / {seq.enrolled}</span>
                        <span className="text-green-600 font-semibold">{seq.conversionRate}% conv</span>
                      </div>
                      <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div className="bg-[#b48c3c] h-full rounded-full" style={{ width: `${(seq.active / seq.enrolled) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </motion.div>
        </motion.div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
