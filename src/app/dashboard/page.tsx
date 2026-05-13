"use client";

import { useState } from "react";
import Link from "next/link";
import CountUp from "react-countup";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
} from "lucide-react";
import { motion } from "framer-motion";

// Mock data
const mockKPIs = {
  totalTickets: 147,
  openTickets: 23,
  escalatedTickets: 5,
  resolvedThisWeek: 42,
  autoResolutionRate: 68,
  avgResolutionTime: "2.4 days",
  tokenConsumption: 12450,
};

const mockRecentTickets = [
  { id: "TKT-001", homeowner: "Sarah Johnson", address: "123 Maple St", issueType: "HVAC not cooling", status: "open", priority: "high", createdAt: "2026-05-10" },
  { id: "TKT-002", homeowner: "Michael Chen", address: "456 Oak Ave", issueType: "Leaking faucet", status: "in_progress", priority: "medium", createdAt: "2026-05-09" },
  { id: "TKT-003", homeowner: "Emily Davis", address: "789 Pine Rd", issueType: "Cabinet door loose", status: "resolved", priority: "low", createdAt: "2026-05-08" },
  { id: "TKT-004", homeowner: "Robert Wilson", address: "321 Elm St", issueType: "Water intrusion", status: "escalated", priority: "urgent", createdAt: "2026-05-07" },
  { id: "TKT-005", homeowner: "Jennifer Martinez", address: "654 Cedar Ln", issueType: "Electrical outlet not working", status: "open", priority: "high", createdAt: "2026-05-06" },
];

const statusColors: Record<string, string> = {
  open: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  in_progress: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  resolved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  escalated: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
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

// Animation variants (fixed type issue by using simple object)
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
  const [kpis] = useState(mockKPIs);
  const [tickets] = useState(mockRecentTickets);
  const [loading] = useState(false);

  return (
    <ProtectedRoute allowedRoles={["admin", "staff", "homeowner"]}>
      <PortalLayout>
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="space-y-6"
        >
          {/* Header */}
          <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-primary dark:text-[#b48c3c]">
                Dashboard
              </h1>
              <p className="text-muted-foreground mt-1">Welcome back! Here's your warranty performance.</p>
            </div>
            <Button className="bg-primary hover:bg-primary/90 w-full sm:w-auto">
              <CalendarDays className="mr-2 h-4 w-4" /> Last 7 days
            </Button>
          </motion.div>

          {/* KPI Cards Grid */}
          <motion.div variants={fadeInUp} className="grid gap-4 grid-cols-1 xs:grid-cols-2 lg:grid-cols-4">
            {loading ? (
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
                      <div className="text-2xl font-bold"><CountUp end={kpis.totalTickets} duration={1.5} separator="," /></div>
                      <p className="text-xs text-muted-foreground mt-1">+{kpis.resolvedThisWeek} this week</p>
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
                      <div className="text-2xl font-bold"><CountUp end={kpis.openTickets} duration={1.5} /></div>
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
                      <div className="text-2xl font-bold"><CountUp end={kpis.autoResolutionRate} duration={1.5} suffix="%" /></div>
                      <CircularProgress value={kpis.autoResolutionRate} />
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
                      <div className="text-2xl font-bold">{kpis.avgResolutionTime}</div>
                      <div className="mt-2 h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-secondary rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(100, (kpis.tokenConsumption / 20000) * 100)}%` }}
                          transition={{ duration: 1 }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Tokens: {kpis.tokenConsumption.toLocaleString()} / 20k</p>
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
                <p className="text-sm text-muted-foreground">Latest warranty claims</p>
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
                        <TableCell><Badge variant="outline" className="capitalize">{ticket.priority}</Badge></TableCell>
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
                  <div><p className="text-sm text-muted-foreground">Knowledge Base Docs</p><p className="font-medium">7 documents indexed</p></div>
                  <div><p className="text-sm text-muted-foreground">Last Escalation</p><p className="font-medium">2 hours ago · resolved by staff</p></div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      </PortalLayout>
    </ProtectedRoute>
  );
}