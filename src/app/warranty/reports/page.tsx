"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Download,
  TrendingUp,
  Ticket,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";

// Types
type Period = "7d" | "30d" | "90d" | "custom";

interface Metrics {
  totalTickets: number;
  resolvedTickets: number;
  openTickets: number;
  escalatedTickets: number;
  resolutionRate: number;
  escalationRate: number;
  avgResponseTime: number;
  avgResolutionTime: number;
  issueBreakdown: { category: string; percentage: number }[];
  agentPerformance: { label: string; value: number }[];
  surveyReadiness: number;
  erpSyncSuccessRate: number;
  erpSyncedCount: number;
  erpFailedCount: number;
}

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.1 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: "spring" as const, damping: 20 } },
  hover: { y: -4, transition: { duration: 0.2 } },
};

const metricCardVariants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { type: "spring" as const, damping: 25 },
  },
};

const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

// Custom hook for counting animation
const useCountUp = (target: number, duration = 800, delay = 0) => {
  const [count, setCount] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const startAnimation = () => {
      startTimeRef.current = null;
      const animate = (timestamp: number) => {
        if (startTimeRef.current === null) startTimeRef.current = timestamp;
        const elapsed = timestamp - startTimeRef.current;
        const progress = Math.min(1, elapsed / duration);
        setCount(Math.floor(progress * target));
        if (progress < 1) {
          frameRef.current = requestAnimationFrame(animate);
        } else {
          setCount(target);
        }
      };
      frameRef.current = requestAnimationFrame(animate);
    };

    const timeout = setTimeout(startAnimation, delay);
    return () => {
      clearTimeout(timeout);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [target, duration, delay]);

  return count;
};

export default function ReportsPage() {
  const [period, setPeriod] = useState<Period>("7d");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [metrics, setMetrics] = useState<Metrics>({
    totalTickets: 0,
    resolvedTickets: 0,
    openTickets: 0,
    escalatedTickets: 0,
    resolutionRate: 0,
    escalationRate: 0,
    avgResponseTime: 0,
    avgResolutionTime: 0,
    issueBreakdown: [],
    agentPerformance: [],
    surveyReadiness: 0,
    erpSyncSuccessRate: 100,
    erpSyncedCount: 0,
    erpFailedCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [toastMessage, setToastMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Animated values
  const animatedTotalTickets = useCountUp(metrics.totalTickets, 600);
  const animatedResolutionRate = useCountUp(metrics.resolutionRate, 600);
  const animatedEscalationRate = useCountUp(metrics.escalationRate, 600);
  const animatedAvgResponse =
    useCountUp(Math.floor((metrics.avgResponseTime || 0) * 10), 600) / 10;
  const animatedReadiness = useCountUp(metrics.surveyReadiness || 0, 600);

  const formatMinutes = (minutes: number) => {
    if (!minutes) return "0 min";
    if (minutes < 60) return `${minutes} min`;
    if (minutes < 1440) return `${Math.round(minutes / 60)} hr`;
    const days = Math.round(minutes / 1440);
    return `${days} day${days === 1 ? "" : "s"}`;
  };

  const showToast = useCallback((type: "success" | "error", text: string) => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3000);
  }, []);

  // Load reports data from backend endpoint
  const fetchReportsData = useCallback(async (p: Period, start?: string, end?: string, skipLoader = false) => {
    if (!skipLoader) setLoading(true);
    try {
      let url = `/api/reports/analytics?period=${p}`;
      if (p === "custom" && start) {
        url += `&startDate=${start}`;
        if (end) url += `&endDate=${end}`;
      }
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setMetrics({
          totalTickets: data.totalTickets ?? 0,
          resolvedTickets: data.resolvedTickets ?? 0,
          openTickets: data.openTickets ?? 0,
          escalatedTickets: data.escalatedTickets ?? 0,
          resolutionRate: data.resolutionRate ?? 0,
          escalationRate: data.escalationRate ?? 0,
          avgResponseTime: data.avgResponseTime ?? 0,
          avgResolutionTime: data.avgResolutionTime ?? 0,
          issueBreakdown: data.issueBreakdown ?? [],
          agentPerformance: data.agentPerformance ?? [],
          surveyReadiness: data.surveyReadiness ?? 0,
          erpSyncSuccessRate: data.erpSyncSuccessRate ?? 100,
          erpSyncedCount: data.erpSyncedCount ?? 0,
          erpFailedCount: data.erpFailedCount ?? 0,
        });
      } else {
        showToast("error", "Failed to retrieve reports data.");
      }
    } catch (error) {
      console.error("Error loading analytics:", error);
      showToast("error", "Error contacting the reports server.");
    } finally {
      if (!skipLoader) setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      fetchReportsData(period, startDate, endDate);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [period, startDate, endDate, fetchReportsData]);

  const handlePeriodChange = (value: string) => {
    setPeriod(value as Period);
  };

  const handleExportCSV = async () => {
    setExporting(true);
    // Simulate generation delay
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Create CSV content
    const rows = [
      ["Metric", "Value"],
      [`Total Tickets (${period})`, metrics.totalTickets.toString()],
      [`Resolved Tickets (${period})`, metrics.resolvedTickets.toString()],
      [`Open Tickets (${period})`, metrics.openTickets.toString()],
      [`Escalated / Emergency Tickets (${period})`, metrics.escalatedTickets.toString()],
      [`Resolution Rate (${period})`, `${metrics.resolutionRate}%`],
      [`Escalation Rate (${period})`, `${metrics.escalationRate}%`],
      [`Avg Resolution Time (${period})`, `${metrics.avgResponseTime} min`],
      [`Homeowner Survey Readiness (${period})`, `${metrics.surveyReadiness}%`],
      [`ERP Sync Success Rate (${period})`, `${metrics.erpSyncSuccessRate}%`],
      [],
      ["Issue Type", "Percentage"],
      ...metrics.issueBreakdown.map((item) => [
        item.category,
        `${item.percentage}%`,
      ]),
      [],
      ["Ticket Outcomes", "Percentage"],
      ...metrics.agentPerformance.map((item) => [item.label, `${item.value}%`]),
    ];

    const csvContent = rows.map((row) => row.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.setAttribute(
      "download",
      `reports_${period}_${new Date().toISOString().split("T")[0]}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setExporting(false);
    showToast("success", "Report exported successfully");
  };


  return (
    <ProtectedRoute allowedRoles={["admin", "staff"]}>
      <PortalLayout>
        {/* Toast Notifications */}
        <AnimatePresence>
          {toastMessage && (
            <motion.div
              initial={{ opacity: 0, y: -50, x: "-50%" }}
              animate={{ opacity: 1, y: 0, x: "-50%" }}
              exit={{ opacity: 0, y: -50, x: "-50%" }}
              className={`fixed top-20 left-1/2 transform -translate-x-1/2 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 ${toastMessage.type === "success"
                ? "bg-green-50 dark:bg-green-900/80 text-green-800 dark:text-green-200 border border-green-200"
                : "bg-red-50 dark:bg-red-900/80 text-red-800 dark:text-red-200 border border-red-200"
                }`}
            >
              {toastMessage.type === "success" ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <AlertCircle className="h-5 w-5" />
              )}
              <span className="text-sm font-medium">{toastMessage.text}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-6 p-4 sm:p-6 md:p-8 max-w-7xl mx-auto"
        >
          {/* Header */}
          <motion.div
            variants={fadeInUp}
            className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
          >
            <div>
              <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
                Reports & Analytics
              </h1>
              <p className="text-muted-foreground text-sm md:text-base mt-1">
                Performance metrics and exportable insights
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Select value={period} onValueChange={handlePeriodChange}>
                <SelectTrigger className="w-[140px] h-9 border-border/80 focus-visible:ring-1 focus-visible:ring-primary/45 rounded-lg bg-background/50">
                  <SelectValue placeholder="Period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="90d">Last 90 days</SelectItem>
                  <SelectItem value="custom">Custom Range</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={handleExportCSV}
                disabled={exporting}
                className="gap-2 h-9 border-border/80 hover:bg-muted/40 rounded-lg"
              >
                {exporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {exporting ? "Exporting..." : "Export CSV"}
              </Button>
            </div>
          </motion.div>

          {/* Custom Date Range Picker panel */}
          <AnimatePresence>
            {period === "custom" && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: "auto", marginBottom: 24 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                className="overflow-hidden"
              >
                <Card className="border border-border/80 bg-linear-to-b from-card/85 to-card/50 backdrop-blur-md">
                  <CardContent className="p-4 flex flex-wrap gap-4 items-end">
                    <div className="flex-1 min-w-[200px]">
                      <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Start Date</label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full h-9 px-3 rounded-lg border border-border/80 bg-background/50 text-sm focus:outline-hidden focus:ring-1 focus:ring-primary/45 text-foreground"
                      />
                    </div>
                    <div className="flex-1 min-w-[200px]">
                      <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">End Date</label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full h-9 px-3 rounded-lg border border-border/80 bg-background/50 text-sm focus:outline-hidden focus:ring-1 focus:ring-primary/45 text-foreground"
                      />
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => fetchReportsData(period, startDate, endDate)}
                      className="h-9 font-semibold text-xs rounded-lg border-border/80 bg-background/50 hover:bg-muted/40"
                    >
                      Apply Filter
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/* KPI Cards */}
          {loading ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader className="pb-2">
                    <div className="h-4 bg-muted rounded w-24"></div>
                  </CardHeader>
                  <CardContent>
                    <div className="h-8 bg-muted rounded w-16 mb-2"></div>
                    <div className="h-3 bg-muted rounded w-32"></div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="grid md:grid-cols-2 lg:grid-cols-4 gap-4"
            >
              {/* Total Tickets */}
              <motion.div variants={metricCardVariants} whileHover={{ y: -2 }}>
                <Card className="shadow-sm hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Total Tickets
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-primary">
                      {animatedTotalTickets}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {metrics.openTickets} open, {metrics.resolvedTickets} resolved
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Resolution Rate */}
              <motion.div variants={metricCardVariants} whileHover={{ y: -2 }}>
                <Card className="shadow-sm hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Resolution Rate
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-primary">
                      {animatedResolutionRate}%
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Based on resolved tickets
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Escalation Rate */}
              <motion.div variants={metricCardVariants} whileHover={{ y: -2 }}>
                <Card className="shadow-sm hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Escalation Rate
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-primary">
                      {animatedEscalationRate}%
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {metrics.escalatedTickets} escalated or emergency
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Avg Resolution Time */}
              <motion.div variants={metricCardVariants} whileHover={{ y: -2 }}>
                <Card className="shadow-sm hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Avg Resolution Time
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-primary">
                      {formatMinutes(animatedAvgResponse)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      From ticket created to resolved
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            </motion.div>
          )}

          {/* Detailed Charts Row */}
          <motion.div
            variants={containerVariants}
            className="grid md:grid-cols-2 gap-6"
          >
            {/* Tickets by Issue Type */}
            <motion.div variants={cardVariants} whileHover="hover">
              <Card className="shadow-sm h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Ticket className="h-5 w-5 text-primary" />
                    Tickets by Issue Type
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {metrics.issueBreakdown.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No tickets in this period.</p>
                  ) : (
                    <AnimatePresence mode="popLayout">
                      {metrics.issueBreakdown.map((item, idx) => (
                      <motion.div
                        key={item.category}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className="space-y-1"
                      >
                        <div className="flex justify-between text-sm">
                          <span>{item.category}</span>
                          <span className="font-mono">{item.percentage}%</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${item.percentage}%` }}
                            transition={{ duration: 0.6, delay: idx * 0.05 }}
                            className="bg-primary h-full rounded-full"
                          />
                        </div>
                      </motion.div>
                      ))}
                    </AnimatePresence>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Ticket Outcomes */}
            <motion.div variants={cardVariants} whileHover="hover">
              <Card className="shadow-sm h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-primary" />
                    Ticket Outcomes
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {metrics.totalTickets === 0 ? (
                    <p className="text-sm text-muted-foreground">No ticket outcomes in this period.</p>
                  ) : (
                    <AnimatePresence mode="popLayout">
                      {metrics.agentPerformance.map((item, idx) => (
                      <motion.div
                        key={item.label}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.1 }}
                        className="space-y-1"
                      >
                        <div className="flex justify-between text-sm">
                          <span>{item.label}</span>
                          <span className="font-mono font-bold">
                            {item.value}%
                          </span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${item.value}%` }}
                            transition={{ duration: 0.5, delay: idx * 0.1 }}
                            className="bg-secondary h-full rounded-full"
                          />
                        </div>
                      </motion.div>
                      ))}
                    </AnimatePresence>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>

          {/* Operational Readiness Panels */}
          <motion.div
            variants={containerVariants}
            className="grid md:grid-cols-2 gap-6"
          >
            {/* Survey-Readiness Scoring Card */}
            <motion.div variants={cardVariants} whileHover="hover">
              <Card className="shadow-sm border-l-4 border-l-primary h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                    Homeowner Survey Readiness
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="relative inline-flex items-center justify-center h-20 w-20 rounded-full bg-primary/10 border border-primary/20 shrink-0">
                      <span className="text-2xl font-bold text-primary">{animatedReadiness}%</span>
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm">Follow-up Eligibility</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {metrics.totalTickets === 0
                          ? "No tickets in this period yet."
                          : animatedReadiness >= 80
                            ? "Ready for homeowner follow-up based on resolved tickets and low escalation."
                            : "Resolve open or escalated tickets before sending homeowner follow-ups."}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-border/40 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Resolution Rate</span>
                      <Badge variant="secondary" className="bg-green-500/10 text-green-600 dark:text-green-400 font-bold border-none">{metrics.resolutionRate}%</Badge>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Escalation / Emergency Rate</span>
                      <Badge variant="secondary" className={metrics.escalationRate > 25 ? "bg-red-500/10 text-red-600 font-bold border-none" : "bg-emerald-500/10 text-emerald-600 font-bold border-none"}>
                        {metrics.escalationRate}%
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Avg Resolution Time</span>
                      <Badge variant="secondary" className="bg-[#b48c3c]/10 text-[#b48c3c] font-bold border-none">{formatMinutes(metrics.avgResponseTime)}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* ERP Sync Health */}
            <motion.div variants={cardVariants} whileHover="hover">
              <Card className="shadow-sm border-l-4 border-l-secondary h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-secondary" />
                    ERP Sync Health
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="p-3 bg-muted/40 rounded-xl border border-border/40">
                      <span className="text-xs text-muted-foreground block font-medium">Success Rate</span>
                      <span className="text-xl font-bold text-secondary">{metrics.erpSyncSuccessRate}%</span>
                    </div>
                    <div className="p-3 bg-muted/40 rounded-xl border border-border/40">
                      <span className="text-xs text-muted-foreground block font-medium">Synced</span>
                      <span className="text-xl font-bold text-emerald-600">{metrics.erpSyncedCount}</span>
                    </div>
                    <div className="p-3 bg-muted/40 rounded-xl border border-border/40">
                      <span className="text-xs text-muted-foreground block font-medium">Failed</span>
                      <span className="text-xl font-bold text-red-500">{metrics.erpFailedCount}</span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-border/40">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      This uses ticket ERP sync statuses collected during the selected period.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        </motion.div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
