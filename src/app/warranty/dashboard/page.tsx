"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import CountUp from "react-countup";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
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

type TicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "ESCALATED";
type TicketPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

interface Ticket {
  id: string;
  homeowner?: {
    name: string;
    email: string;
  };
  property?: {
    address: string;
  };
  issueType: string;
  ticketType?: string;
  status: TicketStatus;
  priority: TicketPriority;
  createdAt: string;
  warrantyYear: number;
}

const statusColors: Record<string, string> = {
  OPEN: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  IN_PROGRESS: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  RESOLVED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  ESCALATED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const statusStyles: Record<TicketStatus, { bg: string, text: string, border: string, dot: string }> = {
  OPEN: {
    bg: "bg-sky-50 dark:bg-sky-950/20",
    text: "text-sky-700 dark:text-sky-400",
    border: "border-sky-200 dark:border-sky-900/50",
    dot: "bg-sky-500",
  },
  IN_PROGRESS: {
    bg: "bg-amber-50 dark:bg-amber-950/20",
    text: "text-amber-700 dark:text-amber-400",
    border: "border-amber-200 dark:border-amber-900/50",
    dot: "bg-amber-500",
  },
  RESOLVED: {
    bg: "bg-emerald-50 dark:bg-emerald-950/20",
    text: "text-emerald-700 dark:text-emerald-400",
    border: "border-emerald-200 dark:border-emerald-900/50",
    dot: "bg-emerald-500",
  },
  ESCALATED: {
    bg: "bg-rose-50 dark:bg-rose-950/20",
    text: "text-rose-700 dark:text-rose-400",
    border: "border-rose-200 dark:border-rose-900/50",
    dot: "bg-rose-500",
  },
};

const priorityStyles: Record<TicketPriority, { bg: string, text: string, border: string }> = {
  LOW: {
    bg: "bg-slate-50 dark:bg-slate-900/20",
    text: "text-slate-600 dark:text-slate-400",
    border: "border-slate-200 dark:border-slate-800/50",
  },
  MEDIUM: {
    bg: "bg-indigo-50 dark:bg-indigo-950/20",
    text: "text-indigo-600 dark:text-indigo-400",
    border: "border-indigo-200 dark:border-indigo-900/50",
  },
  HIGH: {
    bg: "bg-orange-50 dark:bg-orange-950/20",
    text: "text-orange-700 dark:text-orange-400",
    border: "border-orange-200 dark:border-orange-900/50",
  },
  URGENT: {
    bg: "bg-rose-50 dark:bg-rose-950/20",
    text: "text-rose-700 dark:text-rose-400",
    border: "border-rose-200 dark:border-rose-900/50",
  },
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
  const router = useRouter();
  const isHomeowner = user?.role === "homeowner";

  const [period, setPeriod] = useState<Period>("7d");
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [systemHealth, setSystemHealth] = useState({
    agentStatus: "Operational",
    erpSync: "Connected to Builtopia",
    kbDocs: "Active Documents Scoped",
    lastEscalation: "2 hours ago · resolved by staff"
  });

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
        setTickets(data.recentTickets);
        if (data.systemHealth) {
          setSystemHealth(data.systemHealth);
        }
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
          homeowner: { name: t.homeowner?.name || user?.name || "Me", email: t.homeowner?.email || "" },
          property: t.property ? { address: t.property.address } : null,
          issueType: t.issueType,
          ticketType: t.ticketType || null,
          warrantyYear: t.warrantyYear || 1,
          priority: t.priority || "MEDIUM",
          status: t.status,
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
            {/* Header */}
            <div className="pb-2">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-[#0F3B3D] dark:text-slate-100">
                Welcome, {user?.name}!
              </h1>
              <p className="text-muted-foreground mt-1 text-sm">
                Manage your registered properties and track warranty claims.
              </p>
            </div>

            {/* KPI Cards Grid */}
            <motion.div variants={fadeInUp} className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="hover:shadow-md transition-all">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-gray-500 dark:text-slate-400">Registered Properties</CardTitle>
                  <Building2 className="h-4 w-4 text-[#0F3B3D] dark:text-[#a0c5c7]" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-[#0F3B3D] dark:text-slate-100">
                    <CountUp end={homeownerStats.totalProperties} duration={1.5} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Properties registered to your account</p>
                </CardContent>
              </Card>

              <Card className="hover:shadow-md transition-all">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-gray-500 dark:text-slate-400">Total Claims</CardTitle>
                  <TicketCheck className="h-4 w-4 text-blue-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-[#0F3B3D] dark:text-slate-100">
                    <CountUp end={tickets.length} duration={1.5} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Claims submitted to builders</p>
                </CardContent>
              </Card>

              <Card className="hover:shadow-md transition-all">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-gray-500 dark:text-slate-400">Active Claims</CardTitle>
                  <AlertCircle className="h-4 w-4 text-yellow-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-[#0F3B3D] dark:text-slate-100">
                    <CountUp end={homeownerStats.activeClaims} duration={1.5} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Pending maintenance issues</p>
                </CardContent>
              </Card>

              <Card className="hover:shadow-md transition-all">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-gray-500 dark:text-slate-400">Resolved Claims</CardTitle>
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-[#0F3B3D] dark:text-slate-100">
                    <CountUp end={homeownerStats.resolvedClaims} duration={1.5} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Fully resolved issues</p>
                </CardContent>
              </Card>
            </motion.div>

            {/* Recent Claims (Homeowner specific) */}
            <motion.div variants={fadeInUp}>
              <Card className="overflow-hidden">
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-lg font-bold text-[#0F3B3D] dark:text-slate-100">My Recent Claims</CardTitle>
                    <p className="text-sm text-muted-foreground">Detailed status of your submitted warranty requests</p>
                  </div>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  {loading ? (
                    <div className="p-8 text-center"><Skeleton className="h-20 w-full" /></div>
                  ) : tickets.length > 0 ? (
                    <Table className="min-w-[600px] md:min-w-full">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-4">Property Address</TableHead>
                          <TableHead>Issue Type</TableHead>
                          <TableHead>Priority</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right pr-4">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tickets.slice(0, 5).map((ticket) => (
                          <TableRow key={ticket.id}>
                            <TableCell className="text-gray-500 dark:text-slate-400 pl-4">{ticket.property?.address}</TableCell>
                            <TableCell className="font-medium text-gray-700 dark:text-slate-200">{ticket.issueType}</TableCell>
                            <TableCell><Badge variant="outline" className="capitalize text-xs">{ticket.priority.toLowerCase()}</Badge></TableCell>
                            <TableCell><Badge className={statusColors[ticket.status]}>{ticket.status.replace("_", " ")}</Badge></TableCell>
                            <TableCell className="text-right pr-4">
                              <Link href={`/warranty/tickets/${ticket.id}`}>
                                <Button variant="ghost" size="sm" className="text-[#0F3B3D] dark:text-[#a0c5c7] hover:bg-[#0F3B3D]/10 dark:hover:bg-[#0F3B3D]/20">
                                  View
                                </Button>
                              </Link>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="text-center py-12 text-gray-400 dark:text-slate-500">
                      <TicketCheck className="h-12 w-12 mx-auto opacity-20 text-[#0F3B3D] dark:text-[#a0c5c7] mb-2" />
                      <p className="text-sm font-medium">You haven't filed any warranty claims yet.</p>
                      <Link href="/warranty/chat" className="text-xs text-[#0F3B3D] dark:text-[#a0c5c7] underline mt-1 block">
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
                  <motion.div whileHover={{ y: -4 }} transition={{ duration: 0.2 }} className="h-full">
                    <Card className="hover:shadow-lg transition-all h-full">
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
                  <motion.div whileHover={{ y: -4 }} transition={{ duration: 0.2 }} className="h-full">
                    <Card className="hover:shadow-lg transition-all h-full">
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
                  <motion.div whileHover={{ y: -4 }} transition={{ duration: 0.2 }} className="h-full">
                    <Card className="hover:shadow-lg transition-all h-full">
                      <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Auto-Resolution Rate</CardTitle>
                        <TrendingUp className="h-4 w-4 text-green-500" />
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          <CountUp key={`rate-${period}`} end={kpis.autoResolutionRate} duration={1.5} suffix="%" />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Target: 60%</p>
                      </CardContent>
                    </Card>
                  </motion.div>
                  <motion.div whileHover={{ y: -4 }} transition={{ duration: 0.2 }} className="h-full">
                    <Card className="hover:shadow-lg transition-all h-full">
                      <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Avg Resolution Time</CardTitle>
                        <Activity className="h-4 w-4 text-muted-foreground" />
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          {kpis.avgResolutionTime}
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
                  <Table className="min-w-[900px] border-collapse">
                    <TableHeader className="bg-muted/15 border-b border-border/50">
                      <TableRow>
                        <TableHead className="font-semibold text-xs text-muted-foreground py-3 pl-6">Homeowner</TableHead>
                        <TableHead className="font-semibold text-xs text-muted-foreground py-3">Address</TableHead>
                        <TableHead className="font-semibold text-xs text-muted-foreground py-3">Issue</TableHead>
                        <TableHead className="font-semibold text-xs text-muted-foreground py-3">Year</TableHead>
                        <TableHead className="font-semibold text-xs text-muted-foreground py-3">Priority</TableHead>
                        <TableHead className="font-semibold text-xs text-muted-foreground py-3">Status</TableHead>
                        <TableHead className="font-semibold text-xs text-muted-foreground py-3 pr-6">Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tickets.map((ticket) => (
                        <TableRow
                          key={ticket.id}
                          onClick={() => router.push(`/warranty/tickets/${ticket.id}`)}
                          className="border-b border-border/30 hover:bg-muted/15 transition-colors group cursor-pointer"
                        >
                          <TableCell className="py-3.5 pl-6 font-medium text-foreground text-sm">
                            {ticket.homeowner?.name || "Unknown"}
                          </TableCell>
                          <TableCell className="py-3.5 text-muted-foreground text-xs max-w-[200px] truncate" title={ticket.property?.address}>
                            {ticket.property?.address || <span className="text-muted-foreground/50 italic">No address linked</span>}
                          </TableCell>
                          <TableCell className="py-3.5 text-foreground/90 font-medium text-xs max-w-[220px] truncate" title={ticket.issueType}>
                            {ticket.issueType}
                          </TableCell>
                          <TableCell className="py-3.5 text-muted-foreground text-xs">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-muted text-[10px] font-semibold text-muted-foreground border border-border/50">
                              Year {ticket.warrantyYear}
                            </span>
                          </TableCell>
                          <TableCell className="py-3.5">
                            <Badge variant="outline" className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-semibold border shadow-2xs", priorityStyles[ticket.priority as TicketPriority].bg, priorityStyles[ticket.priority as TicketPriority].text, priorityStyles[ticket.priority as TicketPriority].border)}>
                              {ticket.priority}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-3.5">
                            <Badge variant="outline" className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-semibold border flex items-center gap-1.5 shadow-2xs w-fit", statusStyles[ticket.status as TicketStatus].bg, statusStyles[ticket.status as TicketStatus].text, statusStyles[ticket.status as TicketStatus].border)}>
                              <span className={cn("h-1.5 w-1.5 rounded-full", statusStyles[ticket.status as TicketStatus].dot)} />
                              {ticket.status.replace("_", " ")}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-3.5 text-muted-foreground text-xs pr-6">
                            {new Date(ticket.createdAt).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="p-4 text-center">
                    <Link href="/warranty/tickets"><Button variant="outline">View All Tickets <ArrowRight className="ml-2 h-4 w-4" /></Button></Link>
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
                    <div>
                      <p className="text-sm text-muted-foreground">Agent Status</p>
                      <p className="font-medium text-green-600">✓ {systemHealth.agentStatus}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">ERP Sync</p>
                      <p className={`font-medium ${systemHealth.erpSync !== "Not Connected" ? "text-green-600" : "text-red-500"}`}>
                        {systemHealth.erpSync !== "Not Connected" ? "✓ " : "✗ "}{systemHealth.erpSync}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Knowledge Base Docs</p>
                      <p className="font-medium">{systemHealth.kbDocs}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Last Escalation</p>
                      <p className="font-medium">{systemHealth.lastEscalation}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        )}
      </PortalLayout>
    </ProtectedRoute >
  );
}
