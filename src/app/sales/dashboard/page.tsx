"use client";

import { useState, useEffect } from "react";
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
  TrendingUp,
  FileSpreadsheet,
  RefreshCw,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

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

type Appointment = { id: string; leadName: string; type: string; time: string; status: string };

function formatRelative(iso: string | null): string {
  if (!iso) return "Never synced";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

export default function SalesDashboardPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [stats, setStats] = useState({ totalLeads: 0, activeCampaigns: 0, totalEnrolled: 0, appointmentRate: 0 });
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  async function fetchData() {
    try {
      const [dashboardRes, leadsRes, campaignsRes] = await Promise.all([
        fetch("/api/sales/dashboard"),
        fetch("/api/sales/leads"),
        fetch("/api/sales/campaigns")
      ]);

      if (dashboardRes.ok) {
        const data = await dashboardRes.json();
        const total = data.leads?.total || 0;
        const appointmentSet = data.leads?.appointmentSet || 0;
        setStats(s => ({
          ...s,
          totalLeads: total,
          activeCampaigns: data.campaigns?.activeCount || 0,
          appointmentRate: total > 0 ? Math.round((appointmentSet / total) * 1000) / 10 : 0,
        }));
        setAppointments(
          (data.upcomingAppointments || []).map((a: any) => ({
            id: a.id,
            leadName: a.lead ? `${a.lead.firstName} ${a.lead.lastName}` : "Lead",
            type: a.title || "Appointment",
            time: a.time,
            status: a.status,
          }))
        );
        setLastSync(data.crmSyncHealth?.lastSyncAt || null);
      }

      if (leadsRes.ok) {
        const allLeadsData = await leadsRes.json();
        setLeads(allLeadsData.slice(0, 5).map((l: any) => ({
          id: `L-${l.id.slice(-4).toUpperCase()}`,
          name: `${l.firstName} ${l.lastName}`,
          email: l.email,
          phone: l.phone,
          status: l.status,
          source: l.source || "System",
          owner: l.owner?.name || "Unassigned",
          date: new Date(l.createdAt).toISOString().slice(0, 10)
        })));
      }

      if (campaignsRes.ok) {
        const campaignsData = await campaignsRes.json();
        let enrolledCamps = 0;
        const mappedCamps = campaignsData.map((c: any) => {
          const totalEnrollments = c.totalLeads ?? (c.enrollments?.length || 0);
          const activeEnrollments = c.enrollments?.filter((e: any) => e.status === "ACTIVE").length ?? 0;
          enrolledCamps += totalEnrollments;
          return {
            name: c.name,
            channel: c.channel || "Email & SMS",
            enrolled: totalEnrollments,
            active: activeEnrollments,
            conversionRate: typeof c.conversionRate === "string" ? parseFloat(c.conversionRate) : (c.conversionRate || 0)
          };
        });
        setCampaigns(mappedCamps);
        setStats(s => ({ ...s, totalEnrolled: enrolledCamps }));
      }
    } catch (err) {
      console.error("Error fetching dashboard data:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/sales/salesforce/sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(data.message || "Salesforce sync complete.");
        await fetchData();
      } else {
        toast.error(data.message || "Salesforce is not connected. Configure it in Settings.");
      }
    } catch {
      toast.error("Network error while syncing Salesforce.");
    } finally {
      setSyncing(false);
    }
  };

  const handleExportCSV = () => {
    window.open("/api/sales/dashboard/export?type=leads", "_blank");
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
            <div className="flex items-center gap-2.5">
              <span className="hidden sm:block text-[10px] text-muted-foreground">
                Last sync: {formatRelative(lastSync)}
              </span>
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
                    <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{stats.totalLeads}</div>
                    <p className="text-xs text-muted-foreground mt-1">Combined Salesforce + CSV rows</p>
                  </CardContent>
                </Card>

                <Card className="hover:shadow-md transition-all">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-gray-500 dark:text-slate-400">Active Campaigns</CardTitle>
                    <Layers className="h-4 w-4 text-[#0F3B3D]" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{stats.activeCampaigns}</div>
                    <p className="text-xs text-muted-foreground mt-1">{stats.totalEnrolled} enrolled recipients</p>
                  </CardContent>
                </Card>

                <Card className="hover:shadow-md transition-all">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-gray-500 dark:text-slate-400">Model Home Bookings</CardTitle>
                    <Calendar className="h-4 w-4 text-green-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{appointments.length}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {appointments.length > 0
                        ? `Next booking: ${new Date(appointments[0].time).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                        : "No upcoming bookings"}
                    </p>
                  </CardContent>
                </Card>

                <Card className="hover:shadow-md transition-all">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-gray-500 dark:text-slate-400">Avg Lead Conversion</CardTitle>
                    <TrendingUp className="h-4 w-4 text-emerald-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{stats.appointmentRate}%</div>
                    <p className="text-xs text-muted-foreground mt-1">Lead → Appointment rate</p>
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
                      leads.map((lead) => (
                        <tr key={lead.id} className="border-b border-border/40 hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition-colors">
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
                  {appointments.length === 0 && !loading ? (
                    <div className="text-xs text-muted-foreground py-4 text-center">No upcoming appointments.</div>
                  ) : (
                    appointments.map((appt) => (
                      <div key={appt.id} className="p-3 border dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/20 hover:bg-slate-50 dark:hover:bg-slate-900/30 transition rounded-lg">
                        <div className="flex justify-between items-start">
                          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{appt.leadName}</p>
                          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-400 border-emerald-200/50 text-[10px]">
                            {appt.status}
                          </Badge>
                        </div>
                        <p className="text-[11px] font-medium text-slate-500 mt-1">{appt.type}</p>
                        <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                          <Calendar className="h-3 w-3" /> {new Date(appt.time).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* Nurture Campaigns Overview */}
              <Card className="border border-border/80 shadow-xs">
                <CardHeader>
                  <CardTitle className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <Layers className="h-4.5 w-4.5 text-[#0F3B3D]" />
                    Nurture Campaigns
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3.5">
                  {campaigns.length === 0 && !loading ? (
                    <div className="text-xs text-muted-foreground py-4 text-center">No active campaigns found.</div>
                  ) : (
                    campaigns.slice(0, 2).map((seq, i) => (
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
                          <div className="bg-[#b48c3c] h-full rounded-full" style={{ width: `${seq.enrolled > 0 ? (seq.active / seq.enrolled) * 100 : 0}%` }} />
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </motion.div>
        </motion.div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
