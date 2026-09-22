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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
  Plus,
  X,
  Loader2,
  Ticket as TicketIcon,
  Send,
  CalendarClock,
  UserCheck,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Types
type TicketStatus = "OPEN" | "DISPATCHED" | "RESOLVED";
type TicketPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT" | "HAPPY";

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
  assignedStaffId?: string | null;
  assignedStaff?: {
    id: string;
    name: string | null;
    email: string;
  } | null;
  // Present only once the homeowner has picked a time. Its absence on a
  // dispatched ticket is what "awaiting booking" means.
  nextVisitAt?: string | null;
}

interface HomeownerOption {
  id: string;
  name: string | null;
  email: string;
}

interface PropertyOption {
  id: string;
  address: string;
  homeownerId: string;
}

interface StaffOption {
  id: string;
  name: string | null;
  email: string;
}

// Mirrors the categories the classifier assigns to AI-created tickets
// (server/src/lib/warranty-classify.js) so manual and automatic tickets stay in
// the same taxonomy and the Issue filter keeps working across both.
const ISSUE_TYPES = [
  "Appliances",
  "Cabinets & Trim",
  "Drywall & Paint",
  "Electrical",
  "Flooring",
  "General Warranty",
  "HVAC",
  "Plumbing",
  "Roofing",
  "Structural",
  "Windows & Doors",
];

// What a ticket can be filed as. HAPPY is not here on purpose — a claim only
// reaches it by being resolved.
const PRIORITY_OPTIONS: TicketPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

const EMPTY_TICKET_FORM = {
  homeownerId: "",
  propertyId: "",
  issueType: "",
  // Distinguishes these from the agent's tickets, which it stamps "AI Chat".
  ticketType: "Manual Entry",
  description: "",
  priority: "MEDIUM" as TicketPriority,
  isEmergency: false,
  notifyHomeowner: true,
};

// No date here: dispatch assigns the staff member and emails the homeowner a
// link to pick a time from that person's availability.
const EMPTY_DISPATCH_FORM = {
  staffId: "",
  notes: "",
};

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
  DISPATCHED: {
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
  HAPPY: {
    bg: "bg-teal-50 dark:bg-teal-950/20",
    text: "text-teal-700 dark:text-teal-400",
    border: "border-teal-200 dark:border-teal-900/50",
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
  const [dateRange, setDateRange] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [toastMessage, setToastMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const itemsPerPage = 10;

  // Role-based filtering
  const isHomeowner = user?.role === "homeowner";
  const canManage = user?.role === "admin" || user?.role === "staff";

  // Create-ticket modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_TICKET_FORM);
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  const [homeowners, setHomeowners] = useState<HomeownerOption[]>([]);
  const [allProperties, setAllProperties] = useState<PropertyOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [dispatchTarget, setDispatchTarget] = useState<Ticket | null>(null);
  const [dispatchForm, setDispatchForm] = useState(EMPTY_DISPATCH_FORM);
  const [dispatchError, setDispatchError] = useState("");
  const [dispatching, setDispatching] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const showToast = (type: "success" | "error", text: string) => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3000);
  };

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

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;

    (async () => {
      try {
        const [ownerRes, propertyRes, staffRes] = await Promise.all([
          fetch("/api/users?role=homeowner"),
          fetch("/api/properties"),
          fetch("/api/admin/staff"),
        ]);
        if (cancelled) return;
        if (ownerRes.ok) setHomeowners(await ownerRes.json());
        if (propertyRes.ok) setAllProperties(await propertyRes.json());
        if (staffRes.ok) {
          const payload = await staffRes.json();
          setStaff(Array.isArray(payload) ? payload : payload.staff || []);
        }
      } catch (error) {
        console.error("Error loading ticket form options:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canManage]);

  const homeownerProperties = useMemo(
    () => allProperties.filter((p) => p.homeownerId === createForm.homeownerId),
    [allProperties, createForm.homeownerId],
  );

  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      const homeownerName = t.homeowner?.name || "Unknown";
      const matchSearch =
        search === "" ||
        t.id.toLowerCase().includes(search.toLowerCase()) ||
        homeownerName.toLowerCase().includes(search.toLowerCase()) ||
        (t.property?.address ?? "").toLowerCase().includes(search.toLowerCase()) ||
        t.issueType.toLowerCase().includes(search.toLowerCase());
      const matchStatus = status === "all" || t.status === status;
      const matchPriority = priority === "all" || t.priority === priority;

      let matchDate = true;
      if (dateRange !== "all") {
        const ticketDate = new Date(t.createdAt);
        const now = new Date();
        const diffDays = (now.getTime() - ticketDate.getTime()) / (1000 * 3600 * 24);

        if (dateRange === "7d") matchDate = diffDays <= 7;
        else if (dateRange === "30d") matchDate = diffDays <= 30;
        else if (dateRange === "90d") matchDate = diffDays <= 90;
      }

      return matchSearch && matchStatus && matchPriority && matchDate;
    });
  }, [tickets, search, status, priority, dateRange]);

  const totalPages = Math.ceil(filteredTickets.length / itemsPerPage);
  const paginatedTickets = filteredTickets.slice(
    (page - 1) * itemsPerPage,
    page * itemsPerPage
  );

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, status, priority, dateRange]);

  const handleResetFilters = () => {
    setSearch("");
    setStatus("all");
    setPriority("all");
    setDateRange("all");
    showToast("success", "Filters reset");
  };

  const openCreateModal = () => {
    setCreateForm(EMPTY_TICKET_FORM);
    setCreateError("");
    setIsCreateOpen(true);
  };

  const closeCreateModal = () => {
    setIsCreateOpen(false);
    setCreateForm(EMPTY_TICKET_FORM);
    setCreateError("");
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");

    if (!createForm.homeownerId) {
      setCreateError("Please select a homeowner.");
      return;
    }
    if (!createForm.propertyId) {
      setCreateError("Please select a property.");
      return;
    }
    if (!createForm.issueType) {
      setCreateError("Please select an issue type.");
      return;
    }

    setCreating(true);
    try {
      const response = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          homeownerId: createForm.homeownerId,
          propertyId: createForm.propertyId,
          issueType: createForm.issueType,
          ticketType: createForm.ticketType.trim() || null,
          description: createForm.description.trim() || null,
          priority: createForm.isEmergency ? "URGENT" : createForm.priority,
          isEmergency: createForm.isEmergency,
          notifyHomeowner: createForm.notifyHomeowner,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setCreateError(data.message || "Failed to create ticket.");
        return;
      }

      closeCreateModal();
      await fetchTickets(true);
      showToast(data.notice ? "error" : "success", data.notice || "Ticket created");
    } catch (error) {
      console.error("Error creating ticket:", error);
      setCreateError("Error connecting to server.");
    } finally {
      setCreating(false);
    }
  };

  const openDispatch = (ticket: Ticket) => {
    setDispatchTarget(ticket);
    setDispatchForm(EMPTY_DISPATCH_FORM);
    setDispatchError("");
  };

  const closeDispatch = () => {
    setDispatchTarget(null);
    setDispatchForm(EMPTY_DISPATCH_FORM);
    setDispatchError("");
  };

  const handleDispatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispatchTarget) return;
    setDispatchError("");

    if (!dispatchForm.staffId) {
      setDispatchError("Please choose a staff member.");
      return;
    }

    setDispatching(true);
    try {
      const response = await fetch(`/api/tickets/${dispatchTarget.id}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId: dispatchForm.staffId,
          notes: dispatchForm.notes.trim() || null,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setDispatchError(data.message || "Failed to dispatch the ticket.");
        return;
      }

      closeDispatch();
      await fetchTickets(true);
      showToast(
        data.notice ? "error" : "success",
        data.notice ||
          "Ticket dispatched. The homeowner has been emailed a link to pick a time.",
      );
    } catch (error) {
      console.error("Error dispatching ticket:", error);
      setDispatchError("Error connecting to server.");
    } finally {
      setDispatching(false);
    }
  };

  const handleResolve = async (ticket: Ticket) => {
    setResolvingId(ticket.id);
    try {
      const response = await fetch(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "RESOLVED" }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        showToast("error", data.message || "Failed to resolve the ticket.");
        return;
      }

      await fetchTickets(true);
      showToast(data.notice ? "error" : "success", data.notice || "Ticket resolved");
    } catch (error) {
      console.error("Error resolving ticket:", error);
      showToast("error", "Error connecting to server");
    } finally {
      setResolvingId(null);
    }
  };

  const renderRowActions = (ticket: Ticket) => {
    if (!canManage) return null;

    if (ticket.status === "OPEN") {
      return (
        <Button
          size="sm"
          onClick={() => openDispatch(ticket)}
          className="h-8 px-3 text-xs bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 text-white font-semibold rounded-lg gap-1.5"
        >
          <Send className="h-3.5 w-3.5" />
          Dispatch
        </Button>
      );
    }

    if (ticket.status === "DISPATCHED") {
      // "Awaiting booking" is shown in the Status column — this cell stays a
      // single control so every row's action lines up.
      return (
        <Button
          size="sm"
          variant="outline"
          disabled={resolvingId === ticket.id}
          onClick={() => handleResolve(ticket)}
          className="h-8 px-3 text-xs font-semibold rounded-lg gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-900/60 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
        >
          {resolvingId === ticket.id ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          Resolved
        </Button>
      );
    }

    return <span className="text-[11px] text-muted-foreground/70 italic">Closed</span>;
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
                  <div className="h-10 w-35 bg-muted rounded"></div>
                  <div className="h-10 w-35 bg-muted rounded"></div>
                  <div className="h-10 w-35 bg-muted rounded"></div>
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
              className={cn(
                "fixed top-20 left-1/2 transform -translate-x-1/2 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 border max-w-md",
                toastMessage.type === "error"
                  ? "bg-red-50 dark:bg-red-900/80 text-red-800 dark:text-red-200 border-red-200"
                  : "bg-green-50 dark:bg-green-900/80 text-green-800 dark:text-green-200 border-green-200",
              )}
            >
              {toastMessage.type === "error" ? (
                <AlertCircle className="h-5 w-5 shrink-0" />
              ) : (
                <CheckCircle2 className="h-5 w-5 shrink-0" />
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
              {canManage && (
                <Button onClick={openCreateModal} className="gap-2">
                  <Plus className="h-4 w-4" />
                  Create Ticket
                </Button>
              )}
            </div>
          </motion.div>

          {/* Filters Card */}
          <motion.div variants={cardVariants}>
            <Card className="border border-border/80 bg-linear-to-b from-card/85 to-card/50 backdrop-blur-md shadow-xs">
              <CardContent className="p-5 md:p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 items-end">
                  <div className="sm:col-span-2 md:col-span-1 lg:col-span-1">
                    <Label className="text-sm font-semibold text-foreground tracking-tight mb-1.5 block">Search</Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground/80" />
                      <Input
                        placeholder="ID, homeowner, address, issue..."
                        className="pl-9 h-9 border-border/80 focus-visible:ring-1 focus-visible:ring-primary/45 rounded-lg text-sm bg-background/50"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-sm font-semibold text-foreground tracking-tight mb-1.5 block">Status</Label>
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger className="h-9 border-border/80 focus:ring-1 focus:ring-primary/45 rounded-lg text-sm bg-background/50">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="OPEN">Open</SelectItem>
                        <SelectItem value="DISPATCHED">Dispatched</SelectItem>
                        <SelectItem value="RESOLVED">Resolved</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-sm font-semibold text-foreground tracking-tight mb-1.5 block">Priority</Label>
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
                        <SelectItem value="HAPPY">Happy</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-sm font-semibold text-foreground tracking-tight mb-1.5 block">Date</Label>
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
                    {(search || status !== "all" || priority !== "all" || dateRange !== "all") && (
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
                            {ticket.assignedStaff && (
                              <span className="flex items-center gap-1">
                                <UserCheck className="h-3 w-3" />
                                {ticket.assignedStaff.name || ticket.assignedStaff.email}
                              </span>
                            )}
                          </div>

                          <div className="flex justify-between items-center gap-2 pt-2 border-t border-border/30" onClick={(e) => e.stopPropagation()}>
                            <Link href={`/warranty/tickets/${ticket.id}`} className="w-fit">
                              <Button variant="ghost" size="sm" className="h-7 text-xs">
                                <Eye className="h-3.5 w-3.5 mr-1" />
                                View
                              </Button>
                            </Link>
                            {renderRowActions(ticket)}
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </AnimatePresence>
                ) : (
                  // Desktop table view
                  <div className="overflow-x-auto">
                    <Table className="min-w-225 border-collapse table-fixed">
                      <TableHeader className="bg-muted/15 border-b border-border/50">
                        <TableRow>
                          <TableHead className="font-semibold text-xs text-muted-foreground py-3 pl-6 w-1/6">Address</TableHead>
                          <TableHead className="font-semibold text-xs text-muted-foreground py-3 w-1/6">Homeowner</TableHead>
                          <TableHead className="font-semibold text-xs text-muted-foreground py-3 w-1/6">Issue</TableHead>
                          <TableHead className="font-semibold text-xs text-muted-foreground py-3 w-1/6">Priority</TableHead>
                          <TableHead className="font-semibold text-xs text-muted-foreground py-3 w-1/6">Status</TableHead>
                          {canManage && (
                            <TableHead className="font-semibold text-xs text-muted-foreground py-3 pr-6 text-right w-1/6">
                              Actions
                            </TableHead>
                          )}
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
                              <TableCell className="pl-6 py-3.5 font-medium text-foreground text-sm truncate" title={ticket.property?.address}>
                                {ticket.property?.address || <span className="text-muted-foreground/50 italic">No address linked</span>}
                              </TableCell>
                              <TableCell className="py-3.5 text-foreground/90 font-medium text-xs truncate" title={ticket.homeowner?.name || "Unknown"}>
                                {ticket.homeowner?.name || "Unknown"}
                              </TableCell>
                              <TableCell className="py-3.5 text-foreground/90 font-medium text-xs truncate" title={ticket.issueType}>
                                {ticket.issueType}
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
                                {ticket.status === "DISPATCHED" && !ticket.nextVisitAt && (
                                  // A sub-state of dispatched, so it sits with the status
                                  // rather than competing with the action button for width.
                                  <span
                                    className="mt-1 flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-500"
                                    title="The homeowner has been emailed a booking link but has not picked a time yet."
                                  >
                                    <CalendarClock className="h-3 w-3 shrink-0" />
                                    Awaiting booking
                                  </span>
                                )}
                              </TableCell>
                              {canManage && (
                                <TableCell
                                  className="py-3.5 pr-6 text-right"
                                  // The row itself opens the ticket, so a click
                                  // on a button must not navigate as well.
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div className="flex justify-end">{renderRowActions(ticket)}</div>
                                </TableCell>
                              )}
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

          {/* Dispatch Modal */}
          <AnimatePresence>
            {dispatchTarget && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
                <motion.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  className="bg-white dark:bg-gray-900 rounded-3xl p-6 w-full max-w-lg shadow-2xl relative border dark:border-gray-800 my-8"
                >
                  <button
                    type="button"
                    onClick={closeDispatch}
                    className="absolute right-4 top-4 p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full text-gray-400 hover:text-gray-600 transition"
                  >
                    <X className="h-5 w-5" />
                  </button>

                  <div className="flex items-center gap-3 mb-5 border-b dark:border-gray-800 pb-4">
                    <div className="bg-[#0F3B3D] p-2.5 rounded-2xl text-white">
                      <Send className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-[#0F3B3D] dark:text-[#E8B86B]">
                        Dispatch Ticket
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Assign a staff member and book the repair visit.
                      </p>
                    </div>
                  </div>

                  <div className="rounded-2xl border dark:border-gray-800 bg-muted/20 p-3 mb-4 space-y-1">
                    <p className="text-sm font-semibold text-foreground">
                      {dispatchTarget.issueType}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {dispatchTarget.homeowner?.name || "Unknown homeowner"}
                      {dispatchTarget.property?.address ? ` · ${dispatchTarget.property.address}` : ""}
                    </p>
                  </div>

                  <form onSubmit={handleDispatchSubmit} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="font-semibold">Assign to</Label>
                      <Select
                        value={dispatchForm.staffId}
                        onValueChange={(val) => setDispatchForm((f) => ({ ...f, staffId: val }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select staff member..." />
                        </SelectTrigger>
                        <SelectContent>
                          {staff.map((member) => (
                            <SelectItem key={member.id} value={member.id}>
                              {member.name || member.email} &mdash; {member.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {staff.length === 0 && (
                        <p className="text-xs text-amber-600">
                          No staff members yet. Add one on the Staff page first.
                        </p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="dispatchNotes" className="font-semibold">Notes for the visit</Label>
                      <Textarea
                        id="dispatchNotes"
                        rows={3}
                        placeholder="Anything the staff member should know before turning up"
                        value={dispatchForm.notes}
                        onChange={(e) => setDispatchForm((f) => ({ ...f, notes: e.target.value }))}
                      />
                    </div>

                    <div className="flex items-start gap-2.5 rounded-2xl border dark:border-gray-800 p-3">
                      <CalendarClock className="h-4 w-4 mt-0.5 text-[#0F3B3D] dark:text-[#E8B86B] shrink-0" />
                      <p className="text-xs text-gray-500 dark:text-slate-400 leading-snug">
                        The homeowner picks the time. They&apos;re emailed a link showing when
                        this staff member is free; the staff member gets the full ticket now
                        and a confirmation once a slot is chosen.
                      </p>
                    </div>

                    {dispatchError && (
                      <div className="text-red-600 bg-red-50 dark:bg-red-950/30 p-3 rounded-xl text-sm font-semibold">
                        {dispatchError}
                      </div>
                    )}

                    <div className="flex gap-3 justify-end pt-3 border-t dark:border-gray-800">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={closeDispatch}
                        className="text-gray-600"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={dispatching}
                        className="bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 text-white font-semibold gap-2"
                      >
                        {dispatching ? (
                          <><Loader2 className="h-4 w-4 animate-spin" /> Dispatching...</>
                        ) : (
                          <><Send className="h-4 w-4" /> Dispatch &amp; Send Link</>
                        )}
                      </Button>
                    </div>
                  </form>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* Create Ticket Modal */}
          <AnimatePresence>
            {isCreateOpen && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
                <motion.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  className="bg-white dark:bg-gray-900 rounded-3xl p-6 w-full max-w-lg shadow-2xl relative border dark:border-gray-800 my-8"
                >
                  <button
                    type="button"
                    onClick={closeCreateModal}
                    className="absolute right-4 top-4 p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full text-gray-400 hover:text-gray-600 transition"
                  >
                    <X className="h-5 w-5" />
                  </button>

                  <div className="flex items-center gap-3 mb-5 border-b dark:border-gray-800 pb-4">
                    <div className="bg-[#0F3B3D] p-2.5 rounded-2xl text-white">
                      <TicketIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-[#0F3B3D] dark:text-[#E8B86B]">
                        Create Ticket
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Log a warranty claim on a homeowner&apos;s behalf.
                      </p>
                    </div>
                  </div>

                  <form onSubmit={handleCreateSubmit} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="font-semibold">Homeowner</Label>
                      <Select
                        value={createForm.homeownerId}
                        onValueChange={(val) =>
                          // The chosen property must belong to the homeowner,
                          // so switching homeowner clears it.
                          setCreateForm((f) => ({ ...f, homeownerId: val, propertyId: "" }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select homeowner..." />
                        </SelectTrigger>
                        <SelectContent>
                          {homeowners.map((h) => (
                            <SelectItem key={h.id} value={h.id}>
                              {h.name || h.email} &mdash; {h.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="font-semibold">Property</Label>
                      <Select
                        value={createForm.propertyId}
                        onValueChange={(val) => setCreateForm((f) => ({ ...f, propertyId: val }))}
                        disabled={!createForm.homeownerId}
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              createForm.homeownerId
                                ? "Select property..."
                                : "Select a homeowner first"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {homeownerProperties.map((prop) => (
                            <SelectItem key={prop.id} value={prop.id}>
                              {prop.address}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {createForm.homeownerId && homeownerProperties.length === 0 && (
                        <p className="text-xs text-amber-600">
                          This homeowner has no registered properties. Add one on the Properties
                          page first.
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="font-semibold">Issue Type</Label>
                        <Select
                          value={createForm.issueType}
                          onValueChange={(val) => setCreateForm((f) => ({ ...f, issueType: val }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select issue..." />
                          </SelectTrigger>
                          <SelectContent>
                            {ISSUE_TYPES.map((t) => (
                              <SelectItem key={t} value={t}>
                                {t}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="ticketType" className="font-semibold">Ticket Type</Label>
                        <Input
                          id="ticketType"
                          placeholder="e.g. Manual Entry"
                          value={createForm.ticketType}
                          onChange={(e) =>
                            setCreateForm((f) => ({ ...f, ticketType: e.target.value }))
                          }
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="ticketDescription" className="font-semibold">Description</Label>
                      <Textarea
                        id="ticketDescription"
                        rows={4}
                        placeholder="What did the homeowner report?"
                        value={createForm.description}
                        onChange={(e) =>
                          setCreateForm((f) => ({ ...f, description: e.target.value }))
                        }
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="font-semibold">Priority</Label>
                      <Select
                        value={createForm.isEmergency ? "URGENT" : createForm.priority}
                        onValueChange={(val) =>
                          setCreateForm((f) => ({ ...f, priority: val as TicketPriority }))
                        }
                        disabled={createForm.isEmergency}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select priority..." />
                        </SelectTrigger>
                        <SelectContent>
                          {PRIORITY_OPTIONS.map((level) => (
                            <SelectItem key={level} value={level}>
                              {level}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {createForm.isEmergency && (
                        <p className="text-xs text-gray-400 dark:text-slate-500">
                          Emergencies are always URGENT.
                        </p>
                      )}
                    </div>

                    <div className="space-y-3 rounded-2xl border dark:border-gray-800 p-3">
                      <div className="flex items-start gap-2.5">
                        <Checkbox
                          id="isEmergency"
                          checked={createForm.isEmergency}
                          onCheckedChange={(checked) =>
                            setCreateForm((f) => ({ ...f, isEmergency: checked === true }))
                          }
                          className="mt-0.5"
                        />
                        <Label htmlFor="isEmergency" className="font-normal leading-snug cursor-pointer">
                          Mark as emergency
                          <span className="block text-xs text-gray-400 dark:text-slate-500">
                            Flags the ticket and forces URGENT priority.
                          </span>
                        </Label>
                      </div>

                      <div className="flex items-start gap-2.5">
                        <Checkbox
                          id="notifyHomeowner"
                          checked={createForm.notifyHomeowner}
                          onCheckedChange={(checked) =>
                            setCreateForm((f) => ({ ...f, notifyHomeowner: checked === true }))
                          }
                          className="mt-0.5"
                        />
                        <Label htmlFor="notifyHomeowner" className="font-normal leading-snug cursor-pointer">
                          Email the homeowner
                          <span className="block text-xs text-gray-400 dark:text-slate-500">
                            Unticked, the ticket is still created and admins are notified in the
                            portal &mdash; but nothing is emailed.
                          </span>
                        </Label>
                      </div>
                    </div>

                    {createError && (
                      <div className="text-red-600 bg-red-50 dark:bg-red-950/30 p-3 rounded-xl text-sm font-semibold">
                        {createError}
                      </div>
                    )}

                    <div className="flex gap-3 justify-end pt-3 border-t dark:border-gray-800">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={closeCreateModal}
                        className="text-gray-600"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={creating}
                        className="bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 text-white font-semibold gap-2"
                      >
                        {creating ? (
                          <><Loader2 className="h-4 w-4 animate-spin" /> Creating...</>
                        ) : "Create Ticket"}
                      </Button>
                    </div>
                  </form>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </motion.div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
