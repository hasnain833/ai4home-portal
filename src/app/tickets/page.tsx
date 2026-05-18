"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Loader2,
  CheckCircle2,
  AlertCircle,
  Plus,
  MoreVertical,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  address: string;
  issueType: string;
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

const statusColors: Record<string, string> = {
  OPEN: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  IN_PROGRESS:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  RESOLVED:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  ESCALATED:
    "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const priorityColors: Record<string, string> = {
  LOW: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400",
  MEDIUM: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  HIGH: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  URGENT: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

export default function TicketsPage() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [priority, setPriority] = useState<string>("all");
  const [year, setYear] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [toastMessage, setToastMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const itemsPerPage = 10;

  // Role-based filtering
  const isHomeowner = user?.role === "homeowner";

  const fetchTickets = useCallback(async () => {
    setLoading(true);
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
      const matchYear = year === "all" || t.warrantyYear.toString() === year;
      return matchSearch && matchStatus && matchPriority && matchYear;
    });
  }, [tickets, search, status, priority, year]);

  const totalPages = Math.ceil(filteredTickets.length / itemsPerPage);
  const paginatedTickets = filteredTickets.slice(
    (page - 1) * itemsPerPage,
    page * itemsPerPage
  );

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, status, priority, year]);

  const showToast = (type: "success" | "error", text: string) => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleResetFilters = () => {
    setSearch("");
    setStatus("all");
    setPriority("all");
    setYear("all");
    showToast("success", "Filters reset");
  };

  const handleRefresh = async () => {
    await fetchTickets();
    showToast("success", "Tickets refreshed");
  };

  const handleStatusChange = async (ticketId: string, newStatus: TicketStatus) => {
    // In a real app, you'd call API here
    try {
      // For now, update locally to show it works, but in a real app call the PATCH/PUT API
      setTickets((prev) =>
        prev.map((t) => (t.id === ticketId ? { ...t, status: newStatus } : t))
      );
      showToast("success", `Ticket status updated to ${newStatus.replace("_", " ")}`);
    } catch (error) {
      showToast("error", "Failed to update status");
    }
  };

  // Helper for responsive: show card view on mobile
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
              {isHomeowner && (
                <Button asChild>
                  <Link href="/tickets/new">
                    <Plus className="mr-2 h-4 w-4" />
                    New Ticket
                  </Link>
                </Button>
              )}
              <Button variant="outline" onClick={handleRefresh} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
            </div>
          </motion.div>

          {/* Filters Card */}
          <motion.div variants={cardVariants}>
            <Card className="shadow-sm">
              <CardContent className="pt-6">
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="flex-1 min-w-[180px]">
                    <Label className="text-xs font-medium text-muted-foreground mb-1 block">Search</Label>
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="ID, homeowner, issue..."
                        className="pl-8"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="w-[140px]">
                    <Label className="text-xs font-medium text-muted-foreground mb-1 block">Status</Label>
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger>
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="OPEN">Open</SelectItem>
                        <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                        <SelectItem value="RESOLVED">Resolved</SelectItem>
                        <SelectItem value="ESCALATED">Escalated</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-[140px]">
                    <Label className="text-xs font-medium text-muted-foreground mb-1 block">Priority</Label>
                    <Select value={priority} onValueChange={setPriority}>
                      <SelectTrigger>
                        <SelectValue placeholder="Priority" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="LOW">Low</SelectItem>
                        <SelectItem value="MEDIUM">Medium</SelectItem>
                        <SelectItem value="HIGH">High</SelectItem>
                        <SelectItem value="URGENT">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-[140px]">
                    <Label className="text-xs font-medium text-muted-foreground mb-1 block">Warranty Year</Label>
                    <Select value={year} onValueChange={setYear}>
                      <SelectTrigger>
                        <SelectValue placeholder="Year" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="1">Year 1</SelectItem>
                        <SelectItem value="2">Year 2+</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button variant="ghost" onClick={handleResetFilters} className="mb-0.5">
                    Reset
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Tickets List */}
          <motion.div variants={cardVariants}>
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="flex justify-between items-center">
                  <span>Tickets</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {filteredTickets.length} ticket{filteredTickets.length !== 1 ? "s" : ""}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {filteredTickets.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <AlertCircle className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>No tickets found</p>
                    {(search || status !== "all" || priority !== "all" || year !== "all") && (
                      <Button variant="link" onClick={handleResetFilters} className="mt-2">
                        Clear filters
                      </Button>
                    )}
                  </div>
                ) : isMobile ? (
                  // Mobile card view
                  <AnimatePresence mode="popLayout">
                    <div className="space-y-3">
                      {paginatedTickets.map((ticket) => (
                        <motion.div
                          key={ticket.id}
                          variants={rowVariants}
                          initial="hidden"
                          animate="visible"
                          exit="exit"
                          layout
                          className="border rounded-lg p-4 space-y-2 bg-card"
                        >
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="font-mono text-sm font-medium">{ticket.id}</div>
                              <div className="text-sm font-semibold mt-1">{ticket.homeowner?.name || "Unknown"}</div>
                            </div>
                            <Badge className={statusColors[ticket.status]}>
                              {ticket.status.replace("_", " ")}
                            </Badge>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            <div>{ticket.issueType}</div>
                            <div>{ticket.address}</div>
                          </div>
                          <div className="flex justify-between items-center text-xs">
                            <Badge variant="outline" className={priorityColors[ticket.priority]}>
                              {ticket.priority}
                            </Badge>
                            <span>Year {ticket.warrantyYear}</span>
                            <span>{new Date(ticket.createdAt).toLocaleDateString()}</span>
                          </div>
                          <div className="flex justify-end gap-2 pt-2">
                            {!isHomeowner && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="outline" size="sm">
                                    <MoreVertical className="h-3 w-3 mr-1" />
                                    Status
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent>
                                  <DropdownMenuItem onClick={() => handleStatusChange(ticket.id, "OPEN")}>
                                    Open
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleStatusChange(ticket.id, "IN_PROGRESS")}>
                                    In Progress
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleStatusChange(ticket.id, "RESOLVED")}>
                                    Resolved
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleStatusChange(ticket.id, "ESCALATED")}>
                                    Escalated
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                            <Link href={`/tickets/${ticket.id}`}>
                              <Button variant="ghost" size="sm">
                                <Eye className="h-4 w-4 mr-1" />
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
                  <div className="overflow-x-auto rounded-md">
                    <Table className="min-w-[800px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>ID</TableHead>
                          <TableHead>Homeowner</TableHead>
                          <TableHead>Address</TableHead>
                          <TableHead>Issue</TableHead>
                          <TableHead>Year</TableHead>
                          <TableHead>Priority</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Created</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
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
                              className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                            >
                              <TableCell className="font-mono text-sm font-medium">
                                {ticket.id}
                              </TableCell>
                              <TableCell>{ticket.homeowner?.name || "Unknown"}</TableCell>
                              <TableCell className="max-w-[180px] truncate">
                                {ticket.address}
                              </TableCell>
                              <TableCell className="max-w-[200px] truncate">
                                {ticket.issueType}
                              </TableCell>
                              <TableCell>Year {ticket.warrantyYear}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={priorityColors[ticket.priority]}>
                                  {ticket.priority}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {!isHomeowner ? (
                                  <Select
                                    value={ticket.status}
                                    onValueChange={(val) =>
                                      handleStatusChange(ticket.id, val as TicketStatus)
                                    }
                                  >
                                    <SelectTrigger className="w-[120px] h-7 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="OPEN">Open</SelectItem>
                                      <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                                      <SelectItem value="RESOLVED">Resolved</SelectItem>
                                      <SelectItem value="ESCALATED">Escalated</SelectItem>
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <Badge className={statusColors[ticket.status]}>
                                    {ticket.status.replace("_", " ")}
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                {new Date(ticket.createdAt).toLocaleDateString()}
                              </TableCell>
                              <TableCell className="text-right">
                                <Link href={`/tickets/${ticket.id}`}>
                                  <Button variant="ghost" size="sm">
                                    <Eye className="h-4 w-4 mr-1" />
                                    View
                                  </Button>
                                </Link>
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
                  <div className="flex justify-between items-center mt-6 pt-2 border-t">
                    <p className="text-sm text-muted-foreground">
                      Page {page} of {totalPages}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                      >
                        <ChevronRight className="h-4 w-4" />
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

// Missing Label component import - add at top
import { Label } from "@/components/ui/label";