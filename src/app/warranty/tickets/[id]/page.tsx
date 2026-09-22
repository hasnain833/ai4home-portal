"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { TicketAppointments } from "@/components/warranty/TicketAppointments";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  User,
  Calendar,
  UserCheck,
  Loader2,
  Sparkles,
  ThumbsUp,
  Trash2,
  FileText,
  Wrench,
  Mail,
  Phone,
  Pencil,
  MapPin,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, ApiError } from "@/lib/api";
import { toast } from "sonner";

type TicketStatus = "OPEN" | "DISPATCHED" | "RESOLVED";
type TicketPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT" | "HAPPY";

/** One knowledge-base document the agent drew on, as buildKbReferences stores it. */
type KbReference = {
  documentId?: string;
  name?: string;
  category?: string | null;
  scope?: string | null;
};

type TicketDetailData = {
  id: string;
  homeownerId?: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  createdAt: string;
  warrantyYear: number;
  isEmergency: boolean;
  issueType: string;
  ticketType?: string | null;
  description?: string | null;
  draftResponse?: string | null;
  chatSummary?: string | null;
  extractedInfo?: string | null;
  kbReferences?: string | null;
  homeowner?: {
    id?: string | null;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  assignedStaff?: {
    id: string;
    name?: string | null;
    email?: string | null;
  } | null;
  nextVisitAt?: string | null;
  property?: {
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zipCode?: string | null;
    coeDate?: string | null;
    coverageTerm?: string | null;
  } | null;
};

type DiagnosticInfo = Record<string, string>;

const statusLabels: Record<TicketStatus, string> = {
  OPEN: "Open",
  DISPATCHED: "Dispatched",
  RESOLVED: "Resolved",
};

function normalizeDiagnosticValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function normalizeDiagnosticKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseDiagnosticInfo(raw?: string | null): DiagnosticInfo | null {
  if (!raw?.trim()) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const normalized = Object.entries(parsed).reduce<DiagnosticInfo>((acc, [key, value]) => {
      const displayValue = normalizeDiagnosticValue(value);
      if (displayValue) acc[key] = displayValue;
      return acc;
    }, {});

    return Object.keys(normalized).length ? normalized : null;
  } catch {
    const pairs = Array.from(raw.matchAll(/(?:^|[,;\n])\s*([^:,\n;]+?)\s*:\s*([^,;\n]+)/g));
    const parsed = pairs.reduce<DiagnosticInfo>((acc, match) => {
      const key = match[1]?.trim();
      const value = match[2]?.trim();
      if (key && value) acc[key] = value;
      return acc;
    }, {});

    return Object.keys(parsed).length ? parsed : null;
  }
}

function isRedundantDiagnosticField(key: string, value: string, ticket: TicketDetailData) {
  const normalizedKey = normalizeDiagnosticKey(key);
  const normalizedValue = value.trim().toLowerCase();

  if (!normalizedValue) return true;
  if (["location", "address", "property", "propertylocation"].includes(normalizedKey)) {
    return [
      ticket.property?.address,
      ticket.property?.city,
      ticket.property?.state,
      ticket.property?.zipCode,
    ].some((part) => part?.trim().toLowerCase() === normalizedValue);
  }
  if (["issue", "issuetype", "category", "issuecategory", "symptom"].includes(normalizedKey)) {
    return ticket.issueType.trim().toLowerCase() === normalizedValue;
  }
  if (["description", "details", "summary"].includes(normalizedKey)) {
    return ticket.description?.trim().toLowerCase() === normalizedValue;
  }
  // How the classifier reached its answer ("model", "heuristic") is internal
  // plumbing — it tells staff nothing they can act on.
  if (["classifiedby", "classifier", "classificationsource"].includes(normalizedKey)) {
    return true;
  }

  return false;
}

function getDiagnosticValue(info: DiagnosticInfo | null, acceptedKeys: string[]) {
  if (!info) return null;
  const normalizedKeys = new Set(acceptedKeys.map(normalizeDiagnosticKey));
  const match = Object.entries(info).find(([key, value]) => normalizedKeys.has(normalizeDiagnosticKey(key)) && value.trim());
  return match?.[1] ?? null;
}

function formatDiagnosticKey(key: string) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

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

export default function TicketDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [ticket, setTicket] = useState<TicketDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingField, setSavingField] = useState<"status" | "priority" | null>(null);
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState("");
  const [savingPhone, setSavingPhone] = useState(false);
  const [draftResponse, setDraftResponse] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [isProcessingDraft, setIsProcessingDraft] = useState(false);

  useEffect(() => {
    const fetchTicket = async () => {
      try {
        const data = await apiFetch<TicketDetailData>(`/api/tickets/${id}`);
        setTicket(data);
        setDraftResponse(data.draftResponse ?? null);
        setDraftText(data.draftResponse || "");
      } catch (error) {
        console.error("Error fetching ticket:", error);
        toast.error(
          error instanceof ApiError
            ? error.message
            : "We couldn't load this ticket. Please refresh and try again.",
        );
      } finally {
        setLoading(false);
      }
    };
    fetchTicket();
  }, [id]);

  // Manual overrides, for correcting a ticket that went the wrong way. Dispatch
  // is still the normal route out of OPEN — the server refuses a manual move to
  // DISPATCHED unless somebody is already assigned.
  const handleFieldChange = async (field: "status" | "priority", value: string) => {
    if (!ticket) return;
    const previous = ticket;
    setSavingField(field);
    // Optimistic: the select should not snap back while the request is in flight.
    setTicket((prev) => (prev ? { ...prev, [field]: value } : prev));
    try {
      const updated = await apiFetch<TicketDetailData>(`/api/tickets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      // The server may change more than was asked — resolving stamps HAPPY,
      // reopening drops the assignee — so take its version, not ours.
      setTicket((prev) => (prev ? { ...prev, ...updated } : prev));
      toast.success(
        field === "status" ? `Moved to ${statusLabels[value as TicketStatus]}.` : "Priority updated.",
      );
    } catch (error) {
      setTicket(previous);
      toast.error(
        error instanceof ApiError ? error.message : `Could not update the ${field}.`,
      );
    } finally {
      setSavingField(null);
    }
  };

  const startEditingPhone = () => {
    setPhoneDraft(ticket?.homeowner?.phone || "");
    setEditingPhone(true);
  };

  const savePhone = async () => {
    if (!ticket?.homeownerId) return;
    const next = phoneDraft.trim();
    setSavingPhone(true);
    try {
      await apiFetch(`/api/homeowners/${ticket.homeownerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // An empty string clears it, which the server reads as "set to null".
        body: JSON.stringify({ phone: next }),
      });
      setTicket((prev) =>
        prev ? { ...prev, homeowner: { ...prev.homeowner, phone: next || null } } : prev,
      );
      setEditingPhone(false);
      toast.success(next ? "Phone number saved." : "Phone number cleared.");
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Could not save the phone number.",
      );
    } finally {
      setSavingPhone(false);
    }
  };

  const handleApproveDraft = async () => {
    if (!draftText.trim()) return;
    setIsProcessingDraft(true);
    try {
      await apiFetch(`/api/tickets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", draftResponse: draftText }),
      });
      setDraftResponse(null);
      setDraftText("");
      if (ticket) {
        setTicket({ ...ticket, draftResponse: null });
      }
    } catch (error) {
      console.error("Error approving draft:", error);
      toast.error(
        error instanceof ApiError ? error.message : "Failed to approve draft.",
      );
    } finally {
      setIsProcessingDraft(false);
    }
  };

  const handleRejectDraft = async () => {
    setIsProcessingDraft(true);
    try {
      await apiFetch(`/api/tickets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      });
      setDraftResponse(null);
      setDraftText("");
      if (ticket) {
        setTicket({ ...ticket, draftResponse: null });
      }
    } catch (error) {
      console.error("Error rejecting draft:", error);
      toast.error(
        error instanceof ApiError ? error.message : "Failed to reject draft.",
      );
    } finally {
      setIsProcessingDraft(false);
    }
  };

  if (loading) return (
    <PortalLayout>
      <div className="flex flex-col items-center justify-center h-[60vh] gap-3">
        <Loader2 className="h-10 w-10 animate-spin text-[#b48c3c]" />
        <p className="text-sm text-slate-400 font-medium animate-pulse">Loading ticket details...</p>
      </div>
    </PortalLayout>
  );

  if (!ticket) return (
    <PortalLayout>
      <div className="text-center py-20 max-w-md mx-auto">
        <div className="w-16 h-16 bg-rose-50 dark:bg-rose-950/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-rose-200 dark:border-rose-900/50">
          <AlertTriangle className="h-8 w-8 text-rose-500" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Ticket Not Found</h2>
        <p className="text-slate-500 dark:text-slate-400 mt-2">The ticket details could not be retrieved, or you do not have permission to view them.</p>
        <Link href="/warranty/tickets">
          <Button className="mt-6 bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 text-white rounded-xl px-6">
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Tickets
          </Button>
        </Link>
      </div>
    </PortalLayout>
  );

  const st = statusStyles[ticket.status as TicketStatus] || statusStyles.OPEN;
  const pr = priorityStyles[ticket.priority as TicketPriority] || priorityStyles.MEDIUM;
  const canManage = user?.role === "admin" || user?.role === "staff";
  const diagnosticInfo = parseDiagnosticInfo(ticket.extractedInfo);
  const duration = getDiagnosticValue(diagnosticInfo, ["duration", "timing", "timeframe", "time", "howLong"]);
  const additionalIssueDetails = diagnosticInfo
    ? Object.entries(diagnosticInfo).filter(([key, value]) => {
        const normalizedKey = normalizeDiagnosticKey(key);
        const isDuration = ["duration", "timing", "timeframe", "time", "howlong"].includes(normalizedKey);
        return !isDuration && !isRedundantDiagnosticField(key, value, ticket);
      })
    : [];

  return (
    <ProtectedRoute allowedRoles={["admin", "staff", "homeowner"]}>
      <PortalLayout>
        <div className="max-w-7xl mx-auto space-y-6 pb-12">
          {/* Top Bar / Navigation */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/60 dark:border-slate-800/60 pb-6">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Link href="/warranty/tickets">
                  <Button variant="outline" size="icon" className="rounded-full h-9 w-9 border-slate-200/80 dark:border-slate-800/80 shadow-xs hover:bg-slate-100 dark:hover:bg-slate-800/50 transition">
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                </Link>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50">
                    Ticket <span className="text-slate-500 dark:text-slate-400 font-mono text-2xl">#{ticket.id}</span>
                  </h1>
                </div>
              </div>
              <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400 text-xs font-medium pl-12 flex-wrap">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 text-slate-400" />
                  Created {new Date(ticket.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
                </span>
                <span className="text-slate-300 dark:text-slate-700">•</span>
                <span className="flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-slate-400" />
                  Warranty Year {ticket.warrantyYear}
                </span>
              </div>
            </div>

            {/* Badges / Header Actions */}
            <div className="flex items-center gap-2 flex-wrap pl-12 sm:pl-0">
              {ticket.isEmergency && (
                <Badge className="bg-rose-500 hover:bg-rose-600 text-white font-bold uppercase tracking-wider text-[10px] px-2.5 py-1 rounded-full animate-pulse border-none shadow-sm">
                  🚨 Emergency
                </Badge>
              )}
              <Badge variant="outline" className={cn("rounded-full px-3 py-1 font-semibold flex items-center gap-1.5 border shadow-2xs", st.bg, st.text, st.border)}>
                <span className={cn("h-1.5 w-1.5 rounded-full", st.dot)} />
                {ticket.status.replace("_", " ")}
              </Badge>
              <Badge variant="outline" className={cn("rounded-full px-3 py-1 font-semibold border shadow-2xs", pr.bg, pr.text, pr.border)}>
                {ticket.priority} Priority
              </Badge>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_390px] gap-6 items-start">
            {/* Left Main Content */}
            <div className="space-y-6">
              {/* Warranty Agent Reviewer (AI Draft) */}
              {draftResponse && (
                <Card className="border-cyan-500/30 bg-linear-to-br from-slate-900 to-slate-950 text-slate-100 shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-4 duration-300">
                  <div className="bg-linear-to-r from-cyan-600/20 to-blue-600/20 px-6 py-4 flex items-center justify-between border-b border-slate-800">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-cyan-500/20 rounded-xl">
                        <Sparkles className="h-5 w-5 text-cyan-400 animate-pulse" />
                      </div>
                      <div>
                        <CardTitle className="text-base font-bold tracking-tight">AI Assistant Response Draft</CardTitle>
                        <p className="text-[11px] text-cyan-300/80 font-medium">Pending Human-in-the-Loop Review</p>
                      </div>
                    </div>
                    <Badge className="bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 border-cyan-500/30 font-semibold tracking-wide rounded-full text-xs">
                      AI DRAFT
                    </Badge>
                  </div>
                  <CardContent className="p-6 space-y-4">
                    <p className="text-xs text-slate-400 leading-relaxed">
                      The AI assistant drafted the following response based on active warranty policies and diagnostic logs. You can refine the draft inline before approving and sending it directly to the homeowner.
                    </p>

                    <div className="relative">
                      <Textarea
                        value={draftText}
                        onChange={(e) => setDraftText(e.target.value)}
                        rows={6}
                        className="w-full bg-slate-950 border-slate-800 focus:border-cyan-500 focus:ring-cyan-500/20 text-slate-100 placeholder-slate-600 text-sm leading-relaxed rounded-xl resize-y p-4 transition duration-200"
                        placeholder="Type or edit the response here..."
                      />
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 pt-2">
                      <Button
                        onClick={handleApproveDraft}
                        disabled={isProcessingDraft || !draftText.trim()}
                        className="flex-1 bg-linear-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold transition duration-200 border-none shadow-md shadow-emerald-950/20 py-2.5 rounded-xl"
                      >
                        {isProcessingDraft ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <ThumbsUp className="mr-2 h-4 w-4" />
                        )}
                        Approve & Send Response
                      </Button>
                      <Button
                        onClick={handleRejectDraft}
                        disabled={isProcessingDraft}
                        variant="outline"
                        className="border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white transition duration-200 py-2.5 rounded-xl"
                      >
                        {isProcessingDraft ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="mr-2 h-4 w-4 text-rose-400" />
                        )}
                        Reject Draft
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Issue Details Card */}
              <Card className="border-slate-200/60 dark:border-slate-800/60 shadow-xs overflow-hidden bg-white/70 dark:bg-slate-900/60 backdrop-blur-md">
                <CardHeader className="border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/40 py-4 px-6 flex flex-row items-center gap-3">
                  <div className="p-2 bg-[#0F3B3D]/10 dark:bg-[#0f3b3d]/30 text-[#0F3B3D] dark:text-[#a0c5c7] rounded-lg">
                    <Wrench className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-lg font-bold">Issue Details</CardTitle>
                    <CardDescription className="text-xs">Initial request information reported by user</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="p-6 space-y-5">
                  <div className={cn("grid grid-cols-1 gap-4", duration && "md:grid-cols-2")}>
                    <div className="space-y-2 bg-slate-50 dark:bg-slate-950/40 p-4 rounded-xl border border-slate-100 dark:border-slate-900/50">
                      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Issue Category</p>
                      <div className="flex items-center gap-2">
                        <Badge className="bg-[#b48c3c]/10 text-[#b48c3c] dark:bg-[#b48c3c]/20 dark:text-[#ebd09a] border border-[#b48c3c]/30 font-semibold px-2.5 py-0.5 rounded-md text-xs">
                          {ticket.issueType}
                        </Badge>
                        {ticket.ticketType && (
                          <Badge variant="secondary" className="text-xs font-medium">
                            {ticket.ticketType}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {duration && (
                      <div className="space-y-2 bg-slate-50 dark:bg-slate-950/40 p-4 rounded-xl border border-slate-100 dark:border-slate-900/50">
                        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Duration</p>
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{duration}</p>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Description</p>
                    <p className="text-slate-700 dark:text-slate-300 text-sm leading-relaxed whitespace-pre-line bg-slate-50/30 dark:bg-slate-950/20 p-4 rounded-xl border border-slate-100/80 dark:border-slate-900/30">
                      {ticket.description || "No description provided."}
                    </p>
                  </div>
                  {additionalIssueDetails.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {additionalIssueDetails.map(([key, value]) => (
                        <div key={key} className="space-y-2 bg-slate-50 dark:bg-slate-950/40 p-4 rounded-xl border border-slate-100 dark:border-slate-900/50">
                          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{formatDiagnosticKey(key)}</p>
                          <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{value}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Repair visits between the trade and the homeowner */}
              <TicketAppointments
                ticketId={String(id)}
                canSchedule={user?.role === "admin" || user?.role === "staff"}
                ticketClosed={ticket.status === "RESOLVED"}
              />

              {/* Warranty Agent Conversation Summary */}
              {ticket.chatSummary && (
                <Card className="border-amber-500/20 bg-linear-to-br from-slate-900 to-slate-950 text-slate-100 shadow-md overflow-hidden">
                  <div className="bg-linear-to-r from-amber-600/10 to-orange-600/10 px-6 py-4 flex items-center gap-3 border-b border-slate-800">
                    <div className="p-2 bg-amber-500/20 rounded-xl">
                      <Sparkles className="h-5 w-5 text-amber-400" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-bold tracking-tight">AI Conversation Summary</CardTitle>
                      <p className="text-[10px] text-amber-300/80 font-medium">Automatically compiled handoff context</p>
                    </div>
                  </div>
                  <CardContent className="p-6">
                    <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line bg-slate-950/40 p-4 rounded-xl border border-slate-800/40">
                      {ticket.chatSummary}
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Referenced KB Documents */}
              {ticket.kbReferences && (() => {
                // buildKbReferences writes objects, not strings. A bare string is
                // still accepted in case an older ticket stored only the name.
                let parsedRefs: KbReference[] = [];
                try {
                  const parsed = JSON.parse(ticket.kbReferences);
                  if (Array.isArray(parsed)) {
                    parsedRefs = parsed
                      .map((r) => (typeof r === "string" ? { name: r } : r))
                      .filter((r): r is KbReference => !!r && typeof r === "object");
                  }
                } catch (e) {
                  console.warn("Failed to parse ticket.kbReferences JSON:", e);
                }

                if (parsedRefs.length === 0) return null;

                return (
                  <Card className="border-teal-500/20 bg-linear-to-br from-slate-900 to-slate-950 text-slate-100 shadow-md overflow-hidden">
                    <div className="bg-linear-to-r from-teal-600/10 to-emerald-600/10 px-6 py-4 flex items-center gap-3 border-b border-slate-800">
                      <div className="p-2 bg-teal-500/20 rounded-xl">
                        <FileText className="h-5 w-5 text-teal-400" />
                      </div>
                      <div>
                        <CardTitle className="text-sm font-bold tracking-tight">Referenced KB Documents</CardTitle>
                        <p className="text-[10px] text-teal-300/80 font-medium">Knowledge Base files matched by AI</p>
                      </div>
                    </div>
                    <CardContent className="p-6">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {parsedRefs.map((ref, idx) => {
                          const label = ref.name || ref.documentId || "Untitled document";
                          const meta = [
                            ref.category,
                            ref.scope === "PLATFORM" ? "Platform" : ref.scope === "COMPANY" ? "Company" : null,
                          ].filter(Boolean).join(" · ");

                          return (
                            <div key={ref.documentId || idx} className="flex items-center gap-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800/40 hover:border-teal-500/30 transition duration-200">
                              <div className="p-1.5 bg-teal-500/10 rounded-lg text-teal-400 shrink-0">
                                <FileText className="h-4 w-4" />
                              </div>
                              <div className="min-w-0">
                                <span className="block text-sm font-medium text-slate-200 truncate" title={label}>{label}</span>
                                {meta && <span className="text-[10px] text-slate-400">{meta}</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}
            </div>

            {/* Right Side Sidebar */}
            <div className="space-y-6">
              {/* Homeowner & Property Card */}
              <Card className="border-slate-200/60 dark:border-slate-800/60 shadow-xs bg-white/70 dark:bg-slate-900/60 backdrop-blur-md overflow-hidden">
                <CardHeader className="border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/40 py-4 px-6 flex flex-row items-center gap-3">
                  <div className="p-2 bg-[#0F3B3D]/10 dark:bg-[#0f3b3d]/30 text-[#0F3B3D] dark:text-[#a0c5c7] rounded-lg">
                    <User className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold">Homeowner & Property</CardTitle>
                    <CardDescription className="text-[11px]">Contact & property coverage details</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="p-6 space-y-6">
                  {/* Contact Info */}
                  <div className="space-y-3">
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Contact Profile</p>
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 bg-[#b48c3c] text-white rounded-full flex items-center justify-center font-extrabold text-sm shadow-xs shrink-0">
                        {(ticket.homeowner?.name || "U").slice(0, 2).toUpperCase()}
                      </div>
                      <div className="space-y-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">{ticket.homeowner?.name || "Unknown Homeowner"}</p>
                        {ticket.homeowner?.email ? (
                          <a href={`mailto:${ticket.homeowner.email}`} className="text-xs text-[#b48c3c] hover:underline flex items-center gap-1 min-w-0">
                            <Mail className="h-3 w-3 shrink-0" />
                            <span className="truncate">{ticket.homeowner.email}</span>
                          </a>
                        ) : (
                          <span className="text-xs text-slate-400 flex items-center gap-1">
                            <Mail className="h-3 w-3 shrink-0" /> N/A
                          </span>
                        )}

                        {editingPhone ? (
                          <div className="flex items-center gap-1.5 pt-1">
                            <Input
                              value={phoneDraft}
                              onChange={(e) => setPhoneDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void savePhone();
                                if (e.key === "Escape") setEditingPhone(false);
                              }}
                              placeholder="e.g. (555) 010-4477"
                              autoFocus
                              className="h-7 text-xs"
                            />
                            <Button
                              size="sm"
                              onClick={savePhone}
                              disabled={savingPhone}
                              className="h-7 px-2 text-xs"
                            >
                              {savingPhone ? "…" : "Save"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingPhone(false)}
                              className="h-7 px-2 text-xs"
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            {ticket.homeowner?.phone ? (
                              <a
                                href={`tel:${ticket.homeowner.phone}`}
                                className="text-xs text-[#b48c3c] hover:underline flex items-center gap-1 min-w-0"
                              >
                                <Phone className="h-3 w-3 shrink-0" />
                                <span className="truncate">{ticket.homeowner.phone}</span>
                              </a>
                            ) : (
                              <span className="text-xs text-slate-400 flex items-center gap-1">
                                <Phone className="h-3 w-3 shrink-0" /> No phone number
                              </span>
                            )}
                            {canManage && (
                              <button
                                onClick={startEditingPhone}
                                className="text-slate-400 hover:text-[#b48c3c] transition"
                                aria-label={ticket.homeowner?.phone ? "Edit phone number" : "Add phone number"}
                                title={ticket.homeowner?.phone ? "Edit" : "Add"}
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <Separator className="bg-slate-100 dark:bg-slate-800" />

                  {/* Property Details */}
                  <div className="space-y-4">
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Property Location</p>
                    <div className="space-y-3 text-slate-700 dark:text-slate-300">
                      <div className="flex items-start gap-2.5">
                        <MapPin className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                        <div className="text-xs space-y-0.5">
                          <p className="font-semibold text-slate-800 dark:text-slate-200">{ticket.property?.address || "N/A"}</p>
                          {(ticket.property?.city || ticket.property?.state) && (
                            <p className="text-slate-500 dark:text-slate-400">{ticket.property?.city}, {ticket.property?.state} {ticket.property?.zipCode}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5 text-xs">
                        <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
                        <span>
                          <span className="text-slate-400">COE Date:</span>{" "}
                          <span className="font-medium">
                            {ticket.property?.coeDate ? new Date(ticket.property.coeDate).toLocaleDateString(undefined, { dateStyle: "medium" }) : "N/A"}
                          </span>
                        </span>
                      </div>
                      {ticket.property?.coverageTerm && (
                        <div className="flex items-center gap-2.5 text-xs">
                          <ShieldCheck className="h-4 w-4 text-slate-400 shrink-0" />
                          <span>
                            <span className="text-slate-400">Coverage Term:</span>{" "}
                            <span className="font-medium">
                              {new Date(ticket.property.coverageTerm).toLocaleDateString(undefined, { dateStyle: "medium" })}
                            </span>
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Assignment — read-only. Status moves and dispatching happen from
                  the quick actions on the tickets list. */}
              <Card className="border-slate-200/60 dark:border-slate-800/60 shadow-xs bg-white/70 dark:bg-slate-900/60 backdrop-blur-md overflow-hidden">
                <CardHeader className="border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/40 py-4 px-6 flex flex-row items-center gap-3">
                  <div className="p-2 bg-[#0F3B3D]/10 dark:bg-[#0f3b3d]/30 text-[#0F3B3D] dark:text-[#a0c5c7] rounded-lg">
                    <UserCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold">Assignment</CardTitle>
                    <CardDescription className="text-[11px]">Who is handling this ticket</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="p-6 space-y-4">
                  {canManage ? (
                    <div className="grid grid-cols-1 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                          Status
                        </label>
                        <Select
                          value={ticket.status}
                          onValueChange={(v) => handleFieldChange("status", v)}
                          disabled={savingField !== null}
                        >
                          <SelectTrigger className="h-9 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(["OPEN", "DISPATCHED", "RESOLVED"] as TicketStatus[]).map((v) => (
                              <SelectItem key={v} value={v}>
                                {statusLabels[v]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                          Priority
                        </label>
                        <Select
                          value={ticket.priority}
                          onValueChange={(v) => handleFieldChange("priority", v)}
                          disabled={savingField !== null}
                        >
                          <SelectTrigger className="h-9 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(["LOW", "MEDIUM", "HIGH", "URGENT", "HAPPY"] as TicketPriority[]).map(
                              (v) => (
                                <SelectItem key={v} value={v}>
                                  {v.charAt(0) + v.slice(1).toLowerCase()}
                                </SelectItem>
                              ),
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/30 p-4">
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Current Status</p>
                      <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-200">{statusLabels[ticket.status]}</p>
                    </div>
                  )}

                  <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/30 p-4">
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Assigned Staff</p>
                    {ticket.assignedStaff ? (
                      <div className="mt-2 flex items-start gap-3">
                        <div className="h-9 w-9 bg-[#0F3B3D] text-white rounded-full flex items-center justify-center font-extrabold text-xs shrink-0">
                          {(ticket.assignedStaff.name || ticket.assignedStaff.email || "S").slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0 space-y-0.5">
                          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                            {ticket.assignedStaff.name || "Staff member"}
                          </p>
                          {ticket.assignedStaff.email && (
                            <a
                              href={`mailto:${ticket.assignedStaff.email}`}
                              className="text-xs text-[#b48c3c] hover:underline flex items-center gap-1 min-w-0"
                            >
                              <Mail className="h-3 w-3 shrink-0" />
                              <span className="truncate">{ticket.assignedStaff.email}</span>
                            </a>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Not assigned yet.
                      </p>
                    )}
                  </div>

                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {canManage && ticket.status === "OPEN" && !ticket.assignedStaff
                      ? "Moving straight to Dispatched needs an assignee — use Dispatch on the tickets list to pick one and send the booking link."
                      : ticket.status === "OPEN"
                      ? "Dispatch this ticket from the tickets list to assign a staff member and send the homeowner a booking link."
                      : ticket.status === "DISPATCHED"
                        ? ticket.nextVisitAt
                          ? "Mark it resolved from the tickets list once the work is done."
                          : "Waiting on the homeowner to pick a time from their booking link."
                        : "This ticket is closed."}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </PortalLayout>
    </ProtectedRoute>
  );
}

