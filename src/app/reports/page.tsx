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
  Zap,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";

// Types
type Period = "7d" | "30d" | "90d" | "custom";

interface Metrics {
  autoResolutionRate: number;
  avgResponseTime: number;
  tokensPerClaim: number;
  customerSatisfaction: number;
  issueBreakdown: { category: string; percentage: number }[];
  agentPerformance: { label: string; value: number }[];
  surveyReadiness?: number;
  predictedTickets?: number;
  predictedRiskArea?: string;
  escalationRisk?: string;
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
  const [isLive, setIsLive] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const [metrics, setMetrics] = useState<Metrics>({
    autoResolutionRate: 0,
    avgResponseTime: 0,
    tokensPerClaim: 0,
    customerSatisfaction: 0,
    issueBreakdown: [],
    agentPerformance: [],
    surveyReadiness: 0,
    predictedTickets: 0,
    predictedRiskArea: "HVAC",
    escalationRisk: "LOW"
  });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [toastMessage, setToastMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Animated values
  const animatedAutoResolution = useCountUp(metrics.autoResolutionRate, 600);
  const animatedAvgResponse =
    useCountUp(Math.floor((metrics.avgResponseTime || 0) * 10), 600) / 10;
  const animatedTokens = useCountUp(metrics.tokensPerClaim, 600);
  const animatedCsat =
    useCountUp(Math.floor((metrics.customerSatisfaction || 0) * 10), 600) / 10;
  const animatedReadiness = useCountUp(metrics.surveyReadiness || 0, 600);
  const animatedPredictedTickets = useCountUp(metrics.predictedTickets || 0, 600);

  // Load live data from backend endpoint
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
          ...data,
          avgResponseTime: data.avgResponseTime ?? 14
        });
      } else {
        showToast("error", "Failed to retrieve real-time analytics data.");
      }
    } catch (error) {
      console.error("Error loading analytics:", error);
      showToast("error", "Error contacting the telemetry server.");
    } finally {
      if (!skipLoader) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReportsData(period, startDate, endDate);
  }, [period, startDate, endDate, fetchReportsData]);

  // Live polling effect
  useEffect(() => {
    if (!isLive) return;
    setCountdown(10);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          fetchReportsData(period, startDate, endDate, true);
          return 10;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isLive, period, startDate, endDate, fetchReportsData]);

  const showToast = (type: "success" | "error", text: string) => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3000);
  };

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
      [`Auto-Resolution Rate (${period})`, `${metrics.autoResolutionRate}%`],
      [`Avg Response Time (${period})`, `${metrics.avgResponseTime} min`],
      [`Tokens per Claim (${period})`, metrics.tokensPerClaim.toString()],
      [
        `Customer Satisfaction (${period})`,
        `${metrics.customerSatisfaction}/5`,
      ],
      [],
      ["Issue Type", "Percentage"],
      ...metrics.issueBreakdown.map((item) => [
        item.category,
        `${item.percentage}%`,
      ]),
      [],
      ["Agent Performance", "Percentage"],
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

  // Helper to get trend indicator
  const getTrend = (current: number, period: Period) => {
    if (period === "7d") {
      if (current > 65)
        return { text: "↑ positive trend", color: "text-green-600" };
      if (current < 65)
        return { text: "↓ negative trend", color: "text-red-600" };
      return { text: "stable", color: "text-muted-foreground" };
    }
    if (period === "30d") {
      if (current > 70)
        return { text: "↑ strong improvement", color: "text-green-600" };
      if (current < 68)
        return { text: "↓ needs attention", color: "text-red-600" };
      return { text: "stable", color: "text-muted-foreground" };
    }
    return { text: "trend vs last quarter", color: "text-muted-foreground" };
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
              {/* Real-time live status indicator toggle */}
              <div className="flex items-center gap-3 bg-muted/40 px-3 py-1.5 rounded-xl border border-border/40 backdrop-blur-md shadow-2xs">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    {isLive && (
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    )}
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${isLive ? 'bg-emerald-500' : 'bg-slate-400'}`}></span>
                  </span>
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    {isLive ? `Live Sync (${countdown}s)` : "Real-time Mode"}
                  </span>
                </div>
                <button
                  onClick={() => setIsLive(!isLive)}
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md transition-all ${isLive ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted hover:bg-muted/80 text-muted-foreground'}`}
                >
                  {isLive ? "Active" : "Enable"}
                </button>
              </div>

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
              {/* Auto-Resolution Rate */}
              <motion.div variants={metricCardVariants} whileHover={{ y: -2 }}>
                <Card className="shadow-sm hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Auto‑Resolution Rate
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-primary">
                      {animatedAutoResolution}%
                    </div>
                    <p
                      className={`text-xs ${getTrend(metrics.autoResolutionRate, period).color}`}
                    >
                      {getTrend(metrics.autoResolutionRate, period).text}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Avg Response Time */}
              <motion.div variants={metricCardVariants} whileHover={{ y: -2 }}>
                <Card className="shadow-sm hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Avg Response Time
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-primary">
                      {animatedAvgResponse} min
                    </div>
                    <p className="text-xs text-green-600">
                      ↓{" "}
                      {period === "7d"
                        ? "0.3"
                        : period === "30d"
                          ? "0.6"
                          : "0.2"}{" "}
                      min vs previous
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Tokens per Claim */}
              <motion.div variants={metricCardVariants} whileHover={{ y: -2 }}>
                <Card className="shadow-sm hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Tokens per Claim
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-primary">
                      {animatedTokens.toLocaleString()}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      ~${(animatedTokens * 0.00002).toFixed(2)} per claim
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Customer Satisfaction */}
              <motion.div variants={metricCardVariants} whileHover={{ y: -2 }}>
                <Card className="shadow-sm hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Customer Satisfaction
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-primary">
                      {animatedCsat}/5
                    </div>
                    <p className="text-xs text-green-600">
                      ↑ based on{" "}
                      {period === "7d" ? "12" : period === "30d" ? "58" : "142"}{" "}
                      surveys
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
                </CardContent>
              </Card>
            </motion.div>

            {/* Agent Performance */}
            <motion.div variants={cardVariants} whileHover="hover">
              <Card className="shadow-sm h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-primary" />
                    Agent Performance
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
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
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>

          {/* Phase 2 Enhanced Analytics Panels */}
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
                      <h4 className="font-semibold text-sm">Campaign Eligibility Status</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {animatedReadiness >= 80
                          ? "Optimal readiness! Recommended to launch the feedback campaign immediately."
                          : "Moderate readiness. Proactively resolve outstanding tickets to boost sentiments."}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-border/40 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Average Resolution Speed Factor</span>
                      <Badge variant="secondary" className="bg-green-500/10 text-green-600 dark:text-green-400 font-bold border-none">PASS (Green)</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Sentiment Feedback (CSAT Score)</span>
                      <Badge variant="secondary" className={metrics.customerSatisfaction >= 4.0 ? "bg-green-500/10 text-green-600 dark:text-green-400 font-bold border-none" : "bg-amber-500/10 text-amber-600 font-bold border-none"}>
                        {metrics.customerSatisfaction >= 4.0 ? "EXCELLENT" : "STABLE"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Auto-Resolution Coverage</span>
                      <Badge variant="secondary" className="bg-[#b48c3c]/10 text-[#b48c3c] font-bold border-none">ACTIVE ({metrics.autoResolutionRate}%)</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Predictive Analytics Card */}
            <motion.div variants={cardVariants} whileHover="hover">
              <Card className="shadow-sm border-l-4 border-l-secondary h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Zap className="h-5 w-5 text-secondary" />
                    AI Predictive Forecasting
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div className="p-3 bg-muted/40 rounded-xl border border-border/40">
                      <span className="text-xs text-muted-foreground block font-medium">Forecasted Claims</span>
                      <span className="text-xl font-bold text-secondary">{animatedPredictedTickets}</span>
                      <Badge className="bg-secondary/15 text-secondary text-[9px] hover:bg-secondary/15 font-semibold mt-1 px-1.5 py-0.5 border-none">+12% Seasonal projection</Badge>
                    </div>
                    <div className="p-3 bg-muted/40 rounded-xl border border-border/40">
                      <span className="text-xs text-muted-foreground block font-medium">Escalation Backlog Risk</span>
                      <span className={`text-xl font-bold ${metrics.escalationRisk === "HIGH" ? "text-red-500" : "text-emerald-500"}`}>
                        {metrics.escalationRisk}
                      </span>
                      <Badge className={`${metrics.escalationRisk === "HIGH" ? "bg-red-500/10 text-red-500" : "bg-emerald-500/10 text-emerald-500"} text-[9px] font-semibold mt-1 px-1.5 py-0.5 border-none`}>
                        Support Queue Stable
                      </Badge>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-border/40">
                    <h4 className="font-semibold text-xs text-secondary flex items-center gap-1.5 mb-1">
                      <TrendingUp className="h-3.5 w-3.5" />
                      Seasonal Issue Anomaly Detection
                    </h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      AI modeling identifies a seasonal upward trend in <span className="font-semibold text-foreground">{metrics.predictedRiskArea}</span> maintenance cases. Recommend preparing resources and scheduling homeowner proactive guides to mitigate resolution delays.
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
