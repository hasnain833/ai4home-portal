"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  RefreshCw,
  Eye,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Types
type TicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "ESCALATED";
type TicketPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

interface Ticket {
  id: string;
  homeowner?: {
    name: string;
    email: string;
  };
  homeownerId: string;
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

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.1 },
  },
};

const rowVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 20, transition: { duration: 0.2 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
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

export default function TicketsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [priority, setPriority] = useState<string>("all");
  const [year, setYear] = useState<string>("all");
  const [dateRange, setDateRange] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [toastMessage, setToastMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const itemsPerPage = 10;

  // Role-based filtering
  const isHomeowner = user?.role === "homeowner";

  const fetchTickets = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      let url = "/api/tickets";
      if (isHomeowner && user?.id) {
        url += `?homeownerId=${user.id}`;
      }
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setTickets(data);
      } else {
        showToast("error", "Failed to fetch tickets");
      }
    } catch (error) {
      console.error("Error fetching tickets:", error);
      showToast("error", "Error connecting to server");
    } finally {
      setLoading(false);
    }
  }, [isHomeowner, user?.id]);

  // Load tickets
  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  // Filter tickets based on search and filters
  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      const homeownerName = t.homeowner?.name || "Unknown";
      const matchSearch =
        search === "" ||
        t.id.toLowerCase().includes(search.toLowerCase()) ||
        homeownerName.toLowerCase().includes(search.toLowerCase()) ||
        t.issueType.toLowerCase().includes(search.toLowerCase());
      const matchStatus = status === "all" || t.status === status;
      const matchPriority = priority === "all" || t.priority === priority;
      const matchYear = year === "all" || t.warrantyYear.toString() === year || (year === "2" && t.warrantyYear >= 2);

      let matchDate = true;
      if (dateRange !== "all") {
        const ticketDate = new Date(t.createdAt);
        const now = new Date();
        const diffDays = (now.getTime() - ticketDate.getTime()) / (1000 * 3600 * 24);

        if (dateRange === "7d") matchDate = diffDays <= 7;
        else if (dateRange === "30d") matchDate = diffDays <= 30;
        else if (dateRange === "90d") matchDate = diffDays <= 90;
      }

      return matchSearch && matchStatus && matchPriority && matchYear && matchDate;
    });
  }, [tickets, search, status, priority, year, dateRange]);

  const totalPages = Math.ceil(filteredTickets.length / itemsPerPage);
  const paginatedTickets = filteredTickets.slice(
    (page - 1) * itemsPerPage,
    page * itemsPerPage
  );

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, status, priority, year, dateRange]);

  const showToast = (type: "success" | "error", text: string) => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleResetFilters = () => {
    setSearch("");
    setStatus("all");
    setPriority("all");
    setYear("all");
    setDateRange("all");
    showToast("success", "Filters reset");
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchTickets(true);
    setIsRefreshing(false);
    showToast("success", "Tickets refreshed");
  };

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  if (loading) {
    return (
      <ProtectedRoute allowedRoles={["admin", "staff", "homeowner"]}>
        <PortalLayout>
          <div className="space-y-6 p-4 md:p-6">
            <div className="animate-pulse">
              <div className="h-8 w-48 bg-muted rounded mb-2"></div>
              <div className="h-4 w-64 bg-muted rounded"></div>
            </div>
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-wrap gap-4 mb-6">
                  <div className="h-10 flex-1 bg-muted rounded"></div>
                  <div className="h-10 w-[140px] bg-muted rounded"></div>
                  <div className="h-10 w-[140px] bg-muted rounded"></div>
                  <div className="h-10 w-[140px] bg-muted rounded"></div>
                </div>
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-16 bg-muted rounded"></div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </PortalLayout>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute allowedRoles={["admin", "staff", "homeowner"]}>
      <PortalLayout>
        {/* Toast Notification */}
        <AnimatePresence>
          {toastMessage && (
            <motion.div
              initial={{ opacity: 0, y: -50, x: "-50%" }}
              animate={{ opacity: 1, y: 0, x: "-50%" }}
              exit={{ opacity: 0, y: -50, x: "-50%" }}
              className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 bg-green-50 dark:bg-green-900/80 text-green-800 dark:text-green-200 border border-green-200"
            >
              <CheckCircle2 className="h-5 w-5" />
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
          <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
                Warranty Tickets
              </h1>
              <p className="text-muted-foreground text-sm md:text-base mt-1">
                {isHomeowner
                  ? "View your warranty claims"
                  : "Manage and track all claims"}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleRefresh} disabled={isRefreshing} className="gap-2">
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </motion.div>

          {/* Filters Card */}
          <motion.div variants={cardVariants}>
            <Card className="border border-border/80 bg-linear-to-b from-card/85 to-card/50 backdrop-blur-md shadow-xs">
              <CardContent className="p-5 md:p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 items-end">
                  <div className="sm:col-span-2 md:col-span-1 lg:col-span-1">
                    <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Search</Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground/80" />
                      <Input
                        placeholder="ID, homeowner, issue..."
                        className="pl-9 h-9 border-border/80 focus-visible:ring-1 focus-visible:ring-primary/45 rounded-lg text-sm bg-background/50"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Status</Label>
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger className="h-9 border-border/80 focus:ring-1 focus:ring-primary/45 rounded-lg text-sm bg-background/50">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="OPEN">Open</SelectItem>
                        <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                        <SelectItem value="RESOLVED">Resolved</SelectItem>
                        <SelectItem value="ESCALATED">Escalated</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Priority</Label>
                    <Select value={priority} onValueChange={setPriority}>
                      <SelectTrigger className="h-9 border-border/80 focus:ring-1 focus:ring-primary/45 rounded-lg text-sm bg-background/50">
                        <SelectValue placeholder="Priority" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Priorities</SelectItem>
                        <SelectItem value="LOW">Low</SelectItem>
                        <SelectItem value="MEDIUM">Medium</SelectItem>
                        <SelectItem value="HIGH">High</SelectItem>
                        <SelectItem value="URGENT">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Warranty Year</Label>
                    <Select value={year} onValueChange={setYear}>
                      <SelectTrigger className="h-9 border-border/80 focus:ring-1 focus:ring-primary/45 rounded-lg text-sm bg-background/50">
                        <SelectValue placeholder="Year" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Years</SelectItem>
                        <SelectItem value="1">Year 1</SelectItem>
                        <SelectItem value="2">Year 2+</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Date</Label>
                    <Select value={dateRange} onValueChange={setDateRange}>
                      <SelectTrigger className="h-9 border-border/80 focus:ring-1 focus:ring-primary/45 rounded-lg text-sm bg-background/50">
                        <SelectValue placeholder="All Time" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Time</SelectItem>
                        <SelectItem value="7d">Last 7 Days</SelectItem>
                        <SelectItem value="30d">Last 30 Days</SelectItem>
                        <SelectItem value="90d">Last 90 Days</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="sm:col-span-2 md:col-span-1 lg:col-span-1">
                    <Button
                      variant="outline"
                      onClick={handleResetFilters}
                      className="w-full h-9 gap-2 text-xs font-medium text-muted-foreground hover:text-foreground border-border/80 hover:bg-muted/40 transition-all rounded-lg"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reset Filters
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Tickets List */}
          <motion.div variants={cardVariants}>
            <Card className="border border-border/70 bg-card shadow-xs rounded-xl overflow-hidden">
              <CardHeader className="border-b border-border/50 bg-muted/15 px-6 py-4">
                <CardTitle className="flex justify-between items-center text-lg font-semibold tracking-tight">
                  <span className="bg-linear-to-r from-foreground to-foreground/80 bg-clip-text text-transparent">
                    Active Claims
                  </span>
                  <span className="text-xs font-semibold px-2.5 py-1 bg-muted rounded-full text-muted-foreground">
                    {filteredTickets.length} ticket{filteredTickets.length !== 1 ? "s" : ""}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {filteredTickets.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground px-6">
                    <AlertCircle className="h-10 w-10 mx-auto mb-3 text-muted-foreground/60" />
                    <h3 className="font-semibold text-foreground text-sm">No tickets found</h3>
                    <p className="text-xs mt-1 text-muted-foreground/80 max-w-xs mx-auto">Try adjusting your search keywords or clearing the active filters.</p>
                    {(search || status !== "all" || priority !== "all" || year !== "all" || dateRange !== "all") && (
                      <Button variant="outline" size="sm" onClick={handleResetFilters} className="mt-4 text-xs h-8 border-border/80">
                        Clear All Filters
                      </Button>
                    )}
                  </div>
                ) : isMobile ? (
                  // Mobile card view
                  <AnimatePresence mode="popLayout">
                    <div className="space-y-3 p-4">
                      {paginatedTickets.map((ticket) => (
                        <motion.div
                          key={ticket.id}
                          variants={rowVariants}
                          initial="hidden"
                          animate="visible"
                          exit="exit"
                          layout
                          onClick={() => router.push(`/warranty/tickets/${ticket.id}`)}
                          className="border border-border/80 rounded-xl p-4 space-y-3 bg-background/35 backdrop-blur-xs hover:border-border transition-all cursor-pointer"
                        >
                          <div className="flex justify-between items-start gap-2">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded border border-border/50" title={ticket.id}>
                                  {ticket.id.startsWith("T-") ? ticket.id : `#${ticket.id.substring(0, 8)}`}
                                </span>
                              </div>
                              <div className="text-sm font-semibold mt-1.5 text-foreground">{ticket.homeowner?.name || "Unknown"}</div>
                            </div>
                            <Badge variant="outline" className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-semibold border flex items-center gap-1.5 shadow-2xs", statusStyles[ticket.status].bg, statusStyles[ticket.status].text, statusStyles[ticket.status].border)}>
                              <span className={cn("h-1 w-1 rounded-full", statusStyles[ticket.status].dot)} />
                              {ticket.status.replace("_", " ")}
                            </Badge>
                          </div>

                          <div className="space-y-1 text-xs">
                            <div className="font-medium text-foreground">{ticket.issueType}</div>
                            {ticket.ticketType && <div className="text-[10px] text-muted-foreground uppercase">{ticket.ticketType}</div>}
                            <div className="text-muted-foreground flex items-center gap-1.5 mt-1">
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-border" />
                              {ticket.property?.address || "No property address linked"}
                            </div>
                          </div>

                          <div className="flex justify-between items-center text-[11px] text-muted-foreground pt-1 border-t border-border/40">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold border shadow-2xs", priorityStyles[ticket.priority].bg, priorityStyles[ticket.priority].text, priorityStyles[ticket.priority].border)}>
                                {ticket.priority}
                              </Badge>
                              <span>Year {ticket.warrantyYear}</span>
                            </div>
                            <span>{new Date(ticket.createdAt).toLocaleDateString()}</span>
                          </div>

                          <div className="flex justify-end gap-2 pt-2 border-t border-border/30" onClick={(e) => e.stopPropagation()}>
                            <Link href={`/warranty/tickets/${ticket.id}`} className="w-fit">
                              <Button variant="ghost" size="sm" className="h-7 text-xs">
                                <Eye className="h-3.5 w-3.5 mr-1" />
                                View
                              </Button>
                            </Link>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </AnimatePresence>
                ) : (
                  // Desktop table view
                  <div className="overflow-x-auto">
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
                        <AnimatePresence mode="popLayout">
                          {paginatedTickets.map((ticket) => (
                            <motion.tr
                              key={ticket.id}
                              variants={rowVariants}
                              initial="hidden"
                              animate="visible"
                              exit="exit"
                              layout
                              onClick={() => router.push(`/warranty/tickets/${ticket.id}`)}
                              className="border-b border-border/30 hover:bg-muted/15 transition-colors group cursor-pointer"
                            >
                              <TableCell className="pl-6 py-3.5 font-medium text-foreground text-sm">
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
                                <Badge variant="outline" className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-semibold border shadow-2xs", priorityStyles[ticket.priority].bg, priorityStyles[ticket.priority].text, priorityStyles[ticket.priority].border)}>
                                  {ticket.priority}
                                </Badge>
                              </TableCell>
                              <TableCell className="py-3.5">
                                <Badge variant="outline" className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-semibold border flex items-center gap-1.5 shadow-2xs w-fit", statusStyles[ticket.status].bg, statusStyles[ticket.status].text, statusStyles[ticket.status].border)}>
                                  <span className={cn("h-1.5 w-1.5 rounded-full", statusStyles[ticket.status].dot)} />
                                  {ticket.status.replace("_", " ")}
                                </Badge>
                              </TableCell>
                              <TableCell className="py-3.5 text-muted-foreground text-xs pr-6">
                                {new Date(ticket.createdAt).toLocaleDateString()}
                              </TableCell>
                            </motion.tr>
                          ))}
                        </AnimatePresence>
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex justify-between items-center p-4 md:px-6 md:py-4 border-t border-border/40 bg-muted/5">
                    <p className="text-xs text-muted-foreground">
                      Showing page <span className="font-semibold text-foreground">{page}</span> of <span className="font-semibold text-foreground">{totalPages}</span>
                    </p>
                    <div className="flex gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-2.5 border-border/80 rounded-lg text-xs"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                      >
                        <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-2.5 border-border/80 rounded-lg text-xs"
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                      >
                        Next
                        <ChevronRight className="h-3.5 w-3.5 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      </PortalLayout>
    </ProtectedRoute>
  );
}