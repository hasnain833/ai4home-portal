"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import CountUp from "react-countup";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TicketCheck,
  AlertCircle,
  TrendingUp,
  Activity,
  CalendarDays,
  ArrowRight,
  CheckCircle2,
  Building2,
  Sparkles,
  Bot,
  Plus
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Types
type Period = "7d" | "30d" | "90d";

interface KPIs {
  totalTickets: number;
  openTickets: number;
  escalatedTickets: number;
  resolvedThisWeek: number;
  autoResolutionRate: number;
  avgResolutionTime: string;
  tokenConsumption: number;
  tokenLimit: number;
}

interface Ticket {
  id: string;
  homeowner: string;
  address: string;
  issueType: string;
  status: string;
  priority: string;
  createdAt: string;
}

const statusColors: Record<string, string> = {
  OPEN: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  IN_PROGRESS: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  RESOLVED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  ESCALATED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const CircularProgress = ({ value = 0, max = 100, size = 50, strokeWidth = 5, color = "#b48c3c" }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (value / max) * circumference;
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <span className="absolute text-sm font-bold">{value}%</span>
    </div>
  );
};

// Animation variants
const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4 } },
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.2 },
  },
};

export default function DashboardPage() {
  const { user } = useAuth();
  const isHomeowner = user?.role === "homeowner";

  const [period, setPeriod] = useState<Period>("7d");
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  // Fetch Stats (Admin/Staff only)
  const fetchAdminStats = async (p: Period) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/dashboard/stats?period=${p}`);
      if (response.ok) {
        const data = await response.json();
        setKpis({
          totalTickets: data.totalTickets,
          openTickets: data.openTickets,
          escalatedTickets: data.escalatedTickets,
          resolvedThisWeek: data.resolvedThisWeek,
          autoResolutionRate: data.resolutionRate,
          avgResolutionTime: data.avgResolutionTime,
          tokenConsumption: data.tokenConsumption,
          tokenLimit: 20000,
        });
        setTickets(data.recentTickets.map((t: any) => ({
          id: t.id,
          homeowner: t.homeowner,
          address: t.address || "N/A",
          issueType: t.issue,
          status: t.status,
          priority: t.priority || "MEDIUM",
          createdAt: t.date,
        })));
      }
    } catch (error) {
      console.error("Error fetching stats:", error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch Homeowner Tickets & Stats
  const fetchHomeownerData = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/tickets");
      if (response.ok) {
        const data = await response.json();
        setTickets(data.map((t: any) => ({
          id: t.id,
          homeowner: t.homeowner?.name || user?.name || "Me",
          address: t.property?.address || "N/A",
          issueType: t.issueType,
          status: t.status,
          priority: t.priority || "MEDIUM",
          createdAt: t.createdAt,
        })));
      }
    } catch (error) {
      console.error("Error fetching homeowner tickets:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isHomeowner) {
      fetchHomeownerData();
    } else {
      fetchAdminStats(period);
    }
  }, [period, isHomeowner]);

  const handlePeriodChange = (newPeriod: Period) => {
    if (newPeriod === period) return;
    setPeriod(newPeriod);
    setToast(`Showing data for ${newPeriod === "7d" ? "last 7 days" : newPeriod === "30d" ? "last 30 days" : "last 90 days"}`);
    setTimeout(() => setToast(null), 3000);
  };

  const getPeriodLabel = (p: Period) => {
    switch (p) {
      case "7d": return "Last 7 days";
      case "30d": return "Last 30 days";
      case "90d": return "Last 90 days";
    }
  };

  // Calculate client-side stats for homeowner
  const homeownerStats = {
    totalProperties: user?.properties?.length || 0,
    activeClaims: tickets.filter(t => t.status !== "RESOLVED").length,
    resolvedClaims: tickets.filter(t => t.status === "RESOLVED").length,
  };

  const getWarrantyYear = (coeDate: string | undefined) => {
    if (!coeDate) return 1;
    const coe = new Date(coeDate);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - coe.getTime());
    const diffYears = diffTime / (1000 * 60 * 60 * 24 * 365.25);
    if (diffYears <= 1) return 1;
    if (diffYears <= 2) return 2;
    return 10;
  };

  return (
    <ProtectedRoute allowedRoles={["admin", "staff", "homeowner"]}>
      <PortalLayout>
        {isHomeowner ? (
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="space-y-6 p-4 sm:p-6 md:p-8 max-w-7xl mx-auto"
          >
            {/* Welcome banner */}
            <motion.div
              variants={fadeInUp}
              className="relative overflow-hidden bg-linear-to-br from-[#0F3B3D] to-[#1d5b5e] text-white rounded-3xl p-6 md:p-8 shadow-xl"
            >
              <div className="absolute right-0 bottom-0 translate-x-12 translate-y-12 opacity-10 blur-sm pointer-events-none">
                <Sparkles className="h-64 w-64 text-white" />
              </div>
              <div className="relative z-10 max-w-2xl">
                <Badge className="bg-[#b48c3c] text-white mb-3 hover:bg-[#b48c3c]">Active Warranty Portal</Badge>
                <h1 className="text-2xl md:text-4xl font-bold tracking-tight">Welcome home, {user?.name}!</h1>
                <p className="text-white/80 mt-2 text-sm md:text-base leading-relaxed">
                  Easily view your warranty properties, check outstanding service claims, or instantly chat with our AI Support Assistant for professional help.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Link href="/chat">
                    <Button className="bg-[#b48c3c] hover:bg-[#b48c3c]/90 text-white gap-2 font-semibold">
                      <Bot className="h-4 w-4" /> Speak with AI
                    </Button>
                  </Link>
                  <Link href="/tickets">
                    <Button variant="outline" className="border-white/30 text-white hover:bg-white/10 gap-2">
                      <Plus className="h-4 w-4" /> File a Claim
                    </Button>
                  </Link>
                </div>
              </div>
            </motion.div>

            {/* Quick Metrics */}
            <motion.div variants={fadeInUp} className="grid gap-4 grid-cols-1 sm:grid-cols-3">
              <Card className="hover:shadow-md transition-all">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-gray-500">My Properties</CardTitle>
                  <Building2 className="h-4 w-4 text-[#0F3B3D]" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-[#0F3B3D]">{homeownerStats.totalProperties}</div>
                  <p className="text-xs text-muted-foreground mt-1">Properties registered to you</p>
                </CardContent>
              </Card>
              <Card className="hover:shadow-md transition-all">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-gray-500">Active Claims</CardTitle>
                  <AlertCircle className="h-4 w-4 text-yellow-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-[#0F3B3D]">{homeownerStats.activeClaims}</div>
                  <p className="text-xs text-muted-foreground mt-1">Pending maintenance issues</p>
                </CardContent>
              </Card>
              <Card className="hover:shadow-md transition-all">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-gray-500">Resolved Claims</CardTitle>
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-[#0F3B3D]">{homeownerStats.resolvedClaims}</div>
                  <p className="text-xs text-muted-foreground mt-1">Fully resolved issues</p>
                </CardContent>
              </Card>
            </motion.div>

            {/* Main Content Grid */}
            <motion.div variants={fadeInUp} className="grid gap-6 grid-cols-1 lg:grid-cols-3">
              {/* Properties Section (2/3 width) */}
              <div className="lg:col-span-2 space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg font-bold text-[#0F3B3D]">My Registered Properties</CardTitle>
                    <CardDescription>Your registered properties under builder warranty coverage.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {user?.properties && user.properties.length > 0 ? (
                      user.properties.map((prop) => {
                        const year = getWarrantyYear(prop.coeDate);
                        return (
                          <div key={prop.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 border rounded-2xl bg-gray-50/50 hover:bg-gray-50 transition gap-4">
                            <div className="flex items-start gap-3.5">
                              <div className="bg-[#0F3B3D]/10 p-2.5 rounded-xl text-[#0F3B3D] mt-0.5">
                                <Building2 className="h-5 w-5" />
                              </div>
                              <div>
                                <p className="font-semibold text-gray-800">{prop.address}</p>
                                <p className="text-sm text-gray-500">{prop.city || ""}, {prop.state || ""} {prop.zipCode || ""}</p>
                                {prop.coeDate && (
                                  <p className="text-xs text-gray-400 mt-1">
                                    Closing Date: {new Date(prop.coeDate).toLocaleDateString()}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 self-start sm:self-center">
                              <Badge className="bg-[#0F3B3D] text-white">Year {year} Coverage</Badge>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <Building2 className="h-12 w-12 mx-auto mb-2 opacity-30 text-[#0F3B3D]" />
                        <p className="text-sm">No properties registered under your account yet.</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Quick Actions (1/3 width) */}
              <div className="space-y-6">
                <Card className="bg-[#0F3B3D]/5 border-t-4 border-t-[#0F3B3D]">
                  <CardHeader>
                    <CardTitle className="text-md font-bold text-[#0F3B3D]">Instant AI Handoff</CardTitle>
                    <CardDescription>Get diagnostic self-fixes or escalate instantly to our builders.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="text-sm text-gray-600 bg-white p-4 rounded-xl border border-gray-100 shadow-xs leading-relaxed">
                      "I can help you troubleshoot plumbing, electrical, or structural issues. If an issue is covered, I will automatically file a ticket for you!"
                    </div>
                    <Link href="/chat" className="block w-full">
                      <Button className="w-full bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 text-white font-semibold">
                        Launch AI Assistant
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              </div>
            </motion.div>

            {/* Recent Claims (Homeowner specific) */}
            <motion.div variants={fadeInUp}>
              <Card className="overflow-hidden">
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-lg font-bold text-[#0F3B3D]">My Recent Claims</CardTitle>
                    <p className="text-sm text-muted-foreground">Detailed status of your submitted warranty requests</p>
                  </div>
                  <Link href="/tickets">
                    <Button variant="ghost" size="sm" className="text-[#0F3B3D] hover:bg-[#0F3B3D]/10">
                      View All
                    </Button>
                  </Link>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  {loading ? (
                    <div className="p-8 text-center"><Skeleton className="h-20 w-full" /></div>
                  ) : tickets.length > 0 ? (
                    <Table className="min-w-[600px] md:min-w-full">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Claim ID</TableHead>
                          <TableHead>Issue Type</TableHead>
                          <TableHead>Property Address</TableHead>
                          <TableHead>Priority</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tickets.slice(0, 5).map((ticket) => (
                          <TableRow key={ticket.id}>
                            <TableCell className="font-semibold text-xs text-gray-500">{ticket.id}</TableCell>
                            <TableCell className="font-medium text-gray-700">{ticket.issueType}</TableCell>
                            <TableCell className="text-gray-500">{ticket.address}</TableCell>
                            <TableCell><Badge variant="outline" className="capitalize text-xs">{ticket.priority.toLowerCase()}</Badge></TableCell>
                            <TableCell><Badge className={statusColors[ticket.status]}>{ticket.status.replace("_", " ")}</Badge></TableCell>
                            <TableCell className="text-right">
                              <Link href={`/tickets/${ticket.id}`}>
                                <Button variant="ghost" size="sm" className="text-[#0F3B3D] hover:bg-[#0F3B3D]/10">
                                  View
                                </Button>
                              </Link>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="text-center py-12 text-gray-400">
                      <TicketCheck className="h-12 w-12 mx-auto opacity-20 text-[#0F3B3D] mb-2" />
                      <p className="text-sm font-medium">You haven't filed any warranty claims yet.</p>
                      <Link href="/chat" className="text-xs text-[#0F3B3D] underline mt-1 block">
                        Ask the AI assistant to file a claim for you!
                      </Link>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        ) : (
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="space-y-6 p-4 sm:p-6 md:p-8 max-w-7xl mx-auto"
          >
            {/* Toast notification */}
            <AnimatePresence>
              {toast && (
                <motion.div
                  initial={{ opacity: 0, y: -50, x: "-50%" }}
                  animate={{ opacity: 1, y: 0, x: "-50%" }}
                  exit={{ opacity: 0, y: -50, x: "-50%" }}
                  className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 bg-green-50 dark:bg-green-900/80 text-green-800 dark:text-green-200 border border-green-200"
                >
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="text-sm font-medium">{toast}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Header */}
            <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-2xl md:text-3xl font-bold bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
                  Dashboard
                </h1>
                <p className="text-muted-foreground mt-1">Welcome back! Here's your warranty performance.</p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="bg-primary hover:bg-primary/90 w-full sm:w-auto gap-2">
                    <CalendarDays className="h-4 w-4" />
                    {getPeriodLabel(period)}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handlePeriodChange("7d")}>
                    Last 7 days
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handlePeriodChange("30d")}>
                    Last 30 days
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handlePeriodChange("90d")}>
                    Last 90 days
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </motion.div>

            {/* KPI Cards Grid */}
            <motion.div variants={fadeInUp} className="grid gap-4 grid-cols-1 xs:grid-cols-2 lg:grid-cols-4">
              {loading || !kpis ? (
                Array(4).fill(0).map((_, i) => (
                  <Card key={i}>
                    <CardHeader className="pb-2"><Skeleton className="h-4 w-24" /></CardHeader>
                    <CardContent><Skeleton className="h-8 w-16" /><Skeleton className="h-3 w-32 mt-2" /></CardContent>
                  </Card>
                ))
              ) : (
                <>
                  <motion.div whileHover={{ y: -4 }} transition={{ duration: 0.2 }}>
                    <Card className="hover:shadow-lg transition-all">
                      <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Total Tickets</CardTitle>
                        <TicketCheck className="h-4 w-4 text-muted-foreground" />
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          <CountUp key={`total-${period}`} end={kpis.totalTickets} duration={1.5} separator="," />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">+{kpis.resolvedThisWeek} resolved this period</p>
                      </CardContent>
                    </Card>
                  </motion.div>
                  <motion.div whileHover={{ y: -4 }} transition={{ duration: 0.2 }}>
                    <Card className="hover:shadow-lg transition-all">
                      <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Open Tickets</CardTitle>
                        <AlertCircle className="h-4 w-4 text-yellow-500" />
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          <CountUp key={`open-${period}`} end={kpis.openTickets} duration={1.5} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{kpis.escalatedTickets} escalated</p>
                      </CardContent>
                    </Card>
                  </motion.div>
                  <motion.div whileHover={{ y: -4 }} transition={{ duration: 0.2 }}>
                    <Card className="hover:shadow-lg transition-all">
                      <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Auto-Resolution Rate</CardTitle>
                        <TrendingUp className="h-4 w-4 text-green-500" />
                      </CardHeader>
                      <CardContent className="flex items-center justify-between">
                        <div className="text-2xl font-bold">
                          <CountUp key={`rate-${period}`} end={kpis.autoResolutionRate} duration={1.5} suffix="%" />
                        </div>
                        <CircularProgress key={`progress-${period}`} value={kpis.autoResolutionRate} />
                      </CardContent>
                      <p className="text-xs text-muted-foreground px-6 pb-4">Target: 60% (Phase 1)</p>
                    </Card>
                  </motion.div>
                  <motion.div whileHover={{ y: -4 }} transition={{ duration: 0.2 }}>
                    <Card className="hover:shadow-lg transition-all">
                      <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Avg Resolution Time</CardTitle>
                        <Activity className="h-4 w-4 text-muted-foreground" />
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          <CountUp key={`time-${period}`} end={parseFloat(kpis.avgResolutionTime)} duration={1.5} decimals={1} suffix=" days" />
                        </div>
                        <div className="mt-2 h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                          <motion.div
                            key={`token-bar-${period}`}
                            className="h-full bg-secondary rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(100, (kpis.tokenConsumption / kpis.tokenLimit) * 100)}%` }}
                            transition={{ duration: 1 }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Tokens: {kpis.tokenConsumption.toLocaleString()} / {kpis.tokenLimit.toLocaleString()}
                        </p>
                      </CardContent>
                    </Card>
                  </motion.div>
                </>
              )}
            </motion.div>

            {/* Recent Tickets Table */}
            <motion.div variants={fadeInUp}>
              <Card className="overflow-hidden">
                <CardHeader>
                  <CardTitle>Recent Tickets</CardTitle>
                  <p className="text-sm text-muted-foreground">Latest warranty claims for {getPeriodLabel(period)}</p>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <Table className="min-w-[800px] md:min-w-full">
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>Homeowner</TableHead>
                        <TableHead className="hidden sm:table-cell">Address</TableHead>
                        <TableHead>Issue</TableHead>
                        <TableHead>Priority</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="hidden md:table-cell">Created</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tickets.map((ticket) => (
                        <TableRow key={ticket.id}>
                          <TableCell className="font-medium">{ticket.id}</TableCell>
                          <TableCell>{ticket.homeowner}</TableCell>
                          <TableCell className="hidden sm:table-cell">{ticket.address}</TableCell>
                          <TableCell>{ticket.issueType}</TableCell>
                          <TableCell><Badge variant="outline" className="capitalize">{ticket.priority.toLowerCase()}</Badge></TableCell>
                          <TableCell><Badge className={statusColors[ticket.status]}>{ticket.status.replace("_", " ")}</Badge></TableCell>
                          <TableCell className="hidden md:table-cell">{new Date(ticket.createdAt).toLocaleDateString()}</TableCell>
                          <TableCell className="text-right">
                            <Link href={`/tickets/${ticket.id}`}><Button variant="ghost" size="sm">View</Button></Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="p-4 text-center">
                    <Link href="/tickets"><Button variant="outline">View All Tickets <ArrowRight className="ml-2 h-4 w-4" /></Button></Link>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* System Health */}
            <motion.div variants={fadeInUp}>
              <Card className="border-l-4 border-l-secondary">
                <CardHeader><CardTitle className="flex gap-2"><Activity className="h-5 w-5" /> System Health</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <div><p className="text-sm text-muted-foreground">Agent Status</p><p className="font-medium text-green-600">✓ Operational (Phase 1)</p></div>
                    <div><p className="text-sm text-muted-foreground">ERP Sync</p><p className="font-medium text-green-600">✓ Connected to Builtopia</p></div>
                    <div><p className="text-sm text-muted-foreground">Knowledge Base Docs</p><p className="font-medium">Active Documents Scoped</p></div>
                    <div><p className="text-sm text-muted-foreground">Last Escalation</p><p className="font-medium">2 hours ago · resolved by staff</p></div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        )}
      </PortalLayout>
    </ProtectedRoute>
  );
}
