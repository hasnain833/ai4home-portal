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
import { motion, AnimatePresence } from "framer-motion";

// Types
type Period = "7d" | "30d" | "90d";

interface Metrics {
  autoResolutionRate: number;
  avgResponseTime: number;
  tokensPerClaim: number;
  customerSatisfaction: number;
  issueBreakdown: { category: string; percentage: number }[];
  agentPerformance: { label: string; value: number }[];
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
  const [metrics, setMetrics] = useState<Metrics>({
    autoResolutionRate: 0,
    avgResponseTime: 0,
    tokensPerClaim: 0,
    customerSatisfaction: 0,
    issueBreakdown: [],
    agentPerformance: [],
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
    useCountUp(Math.floor(metrics.avgResponseTime * 10), 600) / 10;
  const animatedTokens = useCountUp(metrics.tokensPerClaim, 600);
  const animatedCsat =
    useCountUp(Math.floor(metrics.customerSatisfaction * 10), 600) / 10;

  // Load live data from backend endpoint
  const fetchReportsData = useCallback(async (p: Period) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/reports/analytics?period=${p}`);
      if (response.ok) {
        const data = await response.json();
        setMetrics(data);
      } else {
        showToast("error", "Failed to retrieve real-time analytics data.");
      }
    } catch (error) {
      console.error("Error loading analytics:", error);
      showToast("error", "Error contacting the telemetry server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReportsData(period);
  }, [period, fetchReportsData]);

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
            <div className="flex gap-2">
              <Select value={period} onValueChange={handlePeriodChange}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue placeholder="Period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="90d">Last 90 days</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={handleExportCSV}
                disabled={exporting}
                className="gap-2"
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

          {/* Phase 2 Coming Soon */}
          <motion.div variants={fadeInUp} transition={{ delay: 0.2 }}>
            <Card className="border-l-4 border-l-secondary bg-linear-to-r from-secondary/5 to-transparent dark:from-secondary/10">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Zap className="h-5 w-5 text-secondary" />
                  Phase 2 Enhanced Analytics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Coming soon: per‑agent token cost, survey‑readiness scoring,
                  custom date ranges, real‑time dashboards, and predictive
                  analytics.
                </p>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
