"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Users,
  Search,
  Plus,
  RefreshCw,
  FileDown,
  Upload,
  Layers,
  Calendar,
  Activity,
  CheckCircle2,
  AlertCircle,
  Clock,
  X,
  User,
  ShieldCheck,
  Building2,
  Trash2,
  MoreVertical,
  Check,
  ChevronDown
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Lead {
  id: string;
  source: string;
  externalId?: string | null;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  status: string;
  tags: string[];
  emailOptIn: boolean;
  smsOptIn: boolean;
  consentSource?: string | null;
  consentTimestamp?: string | null;
  createdAt: string;
  owner?: { name: string; email: string } | null;
}

const statusColors: Record<string, string> = {
  New: "bg-blue-50 text-blue-700 border-blue-200/50 dark:bg-blue-900/20 dark:text-blue-300",
  Nurturing: "bg-slate-50 text-slate-700 border-slate-200/50 dark:bg-slate-900/20 dark:text-slate-300",
  Engaged: "bg-amber-50 text-amber-700 border-amber-200/50 dark:bg-amber-900/20 dark:text-amber-300",
  "Appointment Set": "bg-purple-50 text-purple-700 border-purple-200/50 dark:bg-purple-900/20 dark:text-purple-300",
  Qualified: "bg-emerald-50 text-emerald-700 border-emerald-200/50 dark:bg-emerald-900/20 dark:text-emerald-300",
  "Closed Won": "bg-green-50 text-green-700 border-green-200/50 dark:bg-green-900/20 dark:text-green-300",
  "Closed Lost": "bg-rose-50 text-rose-700 border-rose-200/50 dark:bg-rose-900/20 dark:text-rose-300",
  Unsubscribed: "bg-gray-50 text-gray-700 border-gray-200/50 dark:bg-gray-900/20 dark:text-gray-300"
};

const fadeInUp = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } }
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 }
  }
};

export default function LeadsPage() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [toast, setToast] = useState<string | null>(null);

  // Manual Lead Modal state
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [submittingManual, setSubmittingManual] = useState(false);
  const [manualForm, setManualForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    street: "",
    city: "",
    state: "",
    zipCode: "",
    status: "New",
    tagsString: "",
    emailOptIn: false,
    smsOptIn: false,
  });

  // CSV Wizard Modal state
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [csvStep, setCsvStep] = useState(1); // 1: Select, 2: Map, 3: Preview, 4: Consent & Execute, 5: Done
  const [csvRawText, setCsvRawText] = useState("");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [csvMapping, setCsvMapping] = useState<Record<string, string>>({});
  const [mergeStrategy, setMergeStrategy] = useState<"skip" | "update" | "create">("update");
  const [consentAttested, setConsentAttested] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<any>(null);

  // Timeline dialog
  const [timelineLead, setTimelineLead] = useState<Lead | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  const [leadToDelete, setLeadToDelete] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      let url = `/api/sales/leads?status=${statusFilter}&tag=${tagFilter}&search=${encodeURIComponent(search)}`;
      const res = await fetch(url);
      if (res.ok) {
        setLeads(await res.json());
        setCurrentPage(1); // Reset to page 1 on new fetch
      }
    } catch (error) {
      console.error("Error loading leads:", error);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, tagFilter]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  // Unique tags across all leads for dropdown filter
  const uniqueTags = useMemo(() => {
    const tagsSet = new Set<string>();
    leads.forEach(l => l.tags?.forEach(t => tagsSet.add(t)));
    return Array.from(tagsSet).sort();
  }, [leads]);

  // Handle Delete Lead
  const confirmDeleteLead = async () => {
    if (!leadToDelete) return;
    try {
      const res = await fetch(`/api/sales/leads/${leadToDelete}`, { method: "DELETE" });
      if (res.ok) {
        showToast("Lead deleted successfully.");
        fetchLeads();
      } else {
        const err = await res.json();
        alert(err.message || "Failed to delete lead.");
      }
    } catch (error) {
      alert("Error deleting lead.");
    } finally {
      setLeadToDelete(null);
    }
  };

  // Handle Manual Lead Submit
  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualForm.firstName || !manualForm.lastName) {
      alert("First name and last name are required.");
      return;
    }
    setSubmittingManual(true);
    try {
      const res = await fetch("/api/sales/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...manualForm,
          tags: manualForm.tagsString ? manualForm.tagsString.split(",").map(t => t.trim()).filter(Boolean) : [],
        }),
      });
      if (res.ok) {
        showToast("Lead added manually.");
        setManualModalOpen(false);
        setManualForm({
          firstName: "",
          lastName: "",
          email: "",
          phone: "",
          street: "",
          city: "",
          state: "",
          zipCode: "",
          status: "New",
          tagsString: "",
          emailOptIn: false,
          smsOptIn: false,
        });
        fetchLeads();
      } else {
        const err = await res.json();
        alert(err.message || "Failed to add lead.");
      }
    } catch {
      alert("Error adding lead.");
    } finally {
      setSubmittingManual(false);
    }
  };

  // CSV Parsing
  const handleCSVLoad = () => {
    if (!csvRawText.trim()) {
      alert("Please paste some CSV content.");
      return;
    }

    // Split text by lines and clean commas
    const lines = csvRawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      alert("CSV must contain a header row and at least one data row.");
      return;
    }

    // Parse values splitting by commas (considering simple quotes if any)
    const headers = lines[0].split(",").map(h => h.trim().replace(/^["']|["']$/g, ""));
    const dataRows = lines.slice(1).map(line => {
      return line.split(",").map(val => val.trim().replace(/^["']|["']$/g, ""));
    });

    setCsvHeaders(headers);
    setCsvRows(dataRows);

    // Initial Guess / Auto-detection mappings
    const initialMapping: Record<string, string> = {};
    const standardFields = [
      { key: "firstName", aliases: ["first name", "firstname", "first", "fname"] },
      { key: "lastName", aliases: ["last name", "lastname", "last", "lname"] },
      { key: "email", aliases: ["email", "e-mail", "emailaddress", "mail"] },
      { key: "phone", aliases: ["phone", "telephone", "mobile", "tel", "cell"] },
      { key: "street", aliases: ["street", "address", "address1", "location"] },
      { key: "city", aliases: ["city"] },
      { key: "state", aliases: ["state", "province"] },
      { key: "zipCode", aliases: ["zip", "zipcode", "postal", "postalcode"] },
      { key: "tags", aliases: ["tags", "labels", "interests"] },
      { key: "emailOptIn", aliases: ["email opt in", "emailoptin", "email_consent", "consent_email"] },
      { key: "smsOptIn", aliases: ["sms opt in", "smsoptin", "sms_consent", "consent_sms"] }
    ];

    headers.forEach(header => {
      const lowerHeader = header.toLowerCase();
      const matchedField = standardFields.find(f =>
        f.aliases.some(alias => lowerHeader.includes(alias))
      );
      if (matchedField) {
        initialMapping[header] = matchedField.key;
      } else {
        initialMapping[header] = "";
      }
    });

    setCsvMapping(initialMapping);
    setCsvStep(2); // Map Columns Step
  };

  // Run Import Request
  const handleCSVImportExecute = async () => {
    setImporting(true);
    try {
      // 1. Build leads list from row parsing + column mapping
      const leadsList = csvRows.map(row => {
        const leadObj: any = {};
        csvHeaders.forEach((header, idx) => {
          const mappedKey = csvMapping[header];
          if (mappedKey) {
            const rawVal = row[idx];
            if (mappedKey === "emailOptIn" || mappedKey === "smsOptIn") {
              const strVal = (rawVal || "").toLowerCase();
              leadObj[mappedKey] = strVal === "true" || strVal === "yes" || strVal === "1";
            } else if (mappedKey === "tags") {
              leadObj[mappedKey] = rawVal ? rawVal.split(";").map(t => t.trim()).filter(Boolean) : [];
            } else {
              leadObj[mappedKey] = rawVal || "";
            }
          }
        });
        return leadObj;
      });

      // 2. Call API
      const res = await fetch("/api/sales/leads/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadsList,
          mergeStrategy,
          attested: consentAttested,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setImportResults(data);
        setCsvStep(5); // Completion step
        fetchLeads();
      } else {
        alert(data.message || "Failed to parse import.");
      }
    } catch (err) {
      alert("Error executing leads import.");
    } finally {
      setImporting(false);
    }
  };

  // Reset CSV Wizard
  const closeCSVWizard = () => {
    setCsvModalOpen(false);
    setCsvStep(1);
    setCsvRawText("");
    setCsvHeaders([]);
    setCsvRows([]);
    setCsvMapping({});
    setConsentAttested(false);
    setImportResults(null);
  };

  // Open timeline previewer
  const openTimeline = async (lead: Lead) => {
    setTimelineLead(lead);
    setTimelineEvents([]);
    setLoadingTimeline(true);
    try {
      // Mock fetch timeline / in a real system we fetch from `/api/sales/leads/${id}/timeline`
      // For this wizard let's check or mock it
      setTimeout(() => {
        setTimelineEvents([
          { type: "IMPORT", description: `Lead synchronized from ${lead.source} source`, createdAt: lead.createdAt },
          lead.emailOptIn || lead.smsOptIn
            ? { type: "CONSENT_CHANGE", description: `Subscribed with consent logged via ${lead.consentSource || "System"}`, createdAt: lead.createdAt }
            : null
        ].filter(Boolean));
        setLoadingTimeline(false);
      }, 500);
    } catch {
      setLoadingTimeline(false);
    }
  };

  return (
    <ProtectedRoute allowedRoles={["admin", "staff"]}>
      <PortalLayout workspace="sales">
        <div className="space-y-6 max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
                Leads Directory
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                View detailed profiles of builder prospects, track activity logs, and import lists.
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setManualModalOpen(true)} className="bg-[#0F3B3D] text-white hover:bg-[#0F3B3D]/90 gap-2 h-9">
                <Plus className="h-4 w-4" /> Add Lead
              </Button>
              <Button onClick={() => setCsvModalOpen(true)} className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90 gap-2 h-9 border-none">
                <Upload className="h-4 w-4" /> Import CSV
              </Button>
              <Button variant="outline" onClick={fetchLeads} className="h-9">
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Filtering bar */}
          <Card className="border border-border/60 shadow-xs bg-white/70 dark:bg-slate-900/60 backdrop-blur-md">
            <CardContent className="p-4 md:p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-end">
                <div className="sm:col-span-2">
                  <Label className="text-xs font-semibold text-muted-foreground mb-1 block">Search Prospects</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name, email, or telephone..."
                      className="pl-9 h-9"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-xs font-semibold text-muted-foreground mb-1 block">Lead Status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="All Statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="New">New</SelectItem>
                      <SelectItem value="Nurturing">Nurturing</SelectItem>
                      <SelectItem value="Engaged">Engaged</SelectItem>
                      <SelectItem value="Appointment Set">Appointment Set</SelectItem>
                      <SelectItem value="Qualified">Qualified</SelectItem>
                      <SelectItem value="Closed Won">Closed Won</SelectItem>
                      <SelectItem value="Closed Lost">Closed Lost</SelectItem>
                      <SelectItem value="Unsubscribed">Unsubscribed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs font-semibold text-muted-foreground mb-1 block">Lead Tag</Label>
                  <Select value={tagFilter} onValueChange={setTagFilter}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="All Tags" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Tags</SelectItem>
                      {uniqueTags.map(tag => (
                        <SelectItem key={tag} value={tag}>{tag}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Leads Table */}
          <Card className="overflow-hidden border border-border/80 shadow-xs">
            <CardContent className="p-0 overflow-x-auto">
              {loading ? (
                <div className="p-6 space-y-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-40 w-full" /></div>
              ) : leads.length > 0 ? (
                <>
                  <Table className="min-w-[1000px]">
                    <TableHeader className="bg-muted/15 border-b border-border/50">
                      <TableRow>
                        <th className="py-3.5 px-4 font-semibold text-xs text-muted-foreground pl-6">ID</th>
                        <th className="py-3.5 px-4 font-semibold text-xs text-muted-foreground">Prospect Name</th>
                        <th className="py-3.5 px-4 font-semibold text-xs text-muted-foreground">Contact details</th>
                        <th className="py-3.5 px-4 font-semibold text-xs text-muted-foreground">Status</th>
                        <th className="py-3.5 px-4 font-semibold text-xs text-muted-foreground">Opt-in Consent</th>
                        <th className="py-3.5 px-4 font-semibold text-xs text-muted-foreground">Ingested from</th>
                        <th className="py-3.5 px-4 font-semibold text-xs text-muted-foreground">Assigned agent</th>
                        <th className="py-3.5 px-4 font-semibold text-xs text-muted-foreground text-right pr-6">Timeline</th>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {leads.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE).map((lead) => (
                        <TableRow key={lead.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition border-b border-border/30">
                          <TableCell className="py-3 pl-6 font-mono text-xs font-semibold text-[#b48c3c]">{lead.id.substring(0, 8)}...</TableCell>
                          <TableCell className="py-3 font-semibold text-slate-800 dark:text-slate-200">
                            <div>
                              <p className="text-sm font-semibold">{lead.firstName} {lead.lastName}</p>
                              <div className="flex gap-1 mt-1 flex-wrap">
                                {lead.tags.map((t, idx) => (
                                  <Badge key={idx} variant="secondary" className="text-[9px] font-mono tracking-tight px-1.5 py-0">
                                    {t}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="py-3 text-xs">
                            <div>
                              <p className="font-semibold">{lead.email || "—"}</p>
                              <p className="text-slate-400 mt-0.5">{lead.phone || "—"}</p>
                            </div>
                          </TableCell>
                          <TableCell className="py-3">
                            <Badge variant="outline" className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold border ${statusColors[lead.status]}`}>
                              {lead.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-3 text-xs font-semibold">
                            <div className="space-y-0.5">
                              {lead.emailOptIn ? <span className="text-green-600 block">✓ Email Opt-in</span> : <span className="text-slate-400 block">✗ Email Opt-out</span>}
                              {lead.smsOptIn ? <span className="text-green-600 block">✓ SMS Opt-in</span> : <span className="text-slate-400 block">✗ SMS Opt-out</span>}
                            </div>
                          </TableCell>
                          <TableCell className="py-3 text-xs">
                            <div>
                              <p className="font-bold">{lead.source}</p>
                              {lead.externalId && <p className="text-[10px] text-slate-400 font-mono mt-0.5">CRM: {lead.externalId.substring(0, 8)}</p>}
                            </div>
                          </TableCell>
                          <TableCell className="py-3 text-xs text-slate-600 dark:text-slate-300 font-medium">{lead.owner?.name || "Unassigned"}</TableCell>
                          <TableCell className="py-3 text-right pr-6 space-x-1">
                            <Button variant="ghost" size="sm" onClick={() => openTimeline(lead)} className="text-[#b48c3c] hover:bg-[#b48c3c]/10 text-xs">
                              <Clock className="h-3.5 w-3.5 mr-1" /> View Logs
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setLeadToDelete(lead.id)} className="text-red-500 hover:bg-red-500/10 text-xs px-2">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {leads.length > ITEMS_PER_PAGE && (
                    <div className="flex items-center justify-between px-6 py-4 border-t border-border/50 bg-slate-50/30 dark:bg-slate-900/10">
                      <div className="text-xs text-muted-foreground">
                        Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, leads.length)} of {leads.length} prospects
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                          className="h-8 text-xs"
                        >
                          Previous
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(p => Math.min(Math.ceil(leads.length / ITEMS_PER_PAGE), p + 1))}
                          disabled={currentPage >= Math.ceil(leads.length / ITEMS_PER_PAGE)}
                          className="h-8 text-xs"
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-20 text-muted-foreground">
                  <Users className="h-16 w-16 mx-auto opacity-20 text-[#b48c3c] mb-3" />
                  <p className="font-semibold text-sm">No prospects found in this company.</p>
                  <p className="text-xs mt-1 text-slate-400">Click "Add Lead" or "Import CSV" to populate your workspace.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Manual Creation Modal */}
        <Dialog open={manualModalOpen} onOpenChange={setManualModalOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Add Manual Lead</DialogTitle>
              <DialogDescription>Input new prospect contact details. Manual leads default to unconsented unless checked below.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleManualSubmit} className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="firstName" className="font-semibold">First Name</Label>
                  <Input
                    id="firstName"
                    placeholder="John"
                    value={manualForm.firstName}
                    onChange={(e) => setManualForm(f => ({ ...f, firstName: e.target.value }))}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lastName" className="font-semibold">Last Name</Label>
                  <Input
                    id="lastName"
                    placeholder="Doe"
                    value={manualForm.lastName}
                    onChange={(e) => setManualForm(f => ({ ...f, lastName: e.target.value }))}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="font-semibold">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="john@example.com"
                    value={manualForm.email}
                    onChange={(e) => setManualForm(f => ({ ...f, email: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone" className="font-semibold">Telephone (E.164)</Label>
                  <Input
                    id="phone"
                    placeholder="+15550192288"
                    value={manualForm.phone}
                    onChange={(e) => setManualForm(f => ({ ...f, phone: e.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="street" className="font-semibold">Address Street</Label>
                <Input
                  id="street"
                  placeholder="Street details"
                  value={manualForm.street}
                  onChange={(e) => setManualForm(f => ({ ...f, street: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="city" className="font-semibold">City</Label>
                  <Input id="city" value={manualForm.city} onChange={(e) => setManualForm(f => ({ ...f, city: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="state" className="font-semibold">State</Label>
                  <Input id="state" value={manualForm.state} onChange={(e) => setManualForm(f => ({ ...f, state: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="zip" className="font-semibold">Zip</Label>
                  <Input id="zip" value={manualForm.zipCode} onChange={(e) => setManualForm(f => ({ ...f, zipCode: e.target.value }))} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="status" className="font-semibold">Outreach Status</Label>
                  <Select value={manualForm.status} onValueChange={(val) => setManualForm(f => ({ ...f, status: val }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="New">New</SelectItem>
                      <SelectItem value="Nurturing">Nurturing</SelectItem>
                      <SelectItem value="Engaged">Engaged</SelectItem>
                      <SelectItem value="Appointment Set">Appointment Set</SelectItem>
                      <SelectItem value="Qualified">Qualified</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tags" className="font-semibold">Tags (comma-separated)</Label>
                  <Input
                    id="tags"
                    placeholder="Hot prospect, Year 1, resale"
                    value={manualForm.tagsString}
                    onChange={(e) => setManualForm(f => ({ ...f, tagsString: e.target.value }))}
                  />
                </div>
              </div>

              <div className="flex gap-4 items-center bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="emailOptIn"
                    checked={manualForm.emailOptIn}
                    onChange={(e) => setManualForm(f => ({ ...f, emailOptIn: e.target.checked }))}
                    className="h-4 w-4 text-[#b48c3c] rounded"
                  />
                  <Label htmlFor="emailOptIn" className="text-xs font-semibold cursor-pointer">Email Consent Opt-in</Label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="smsOptIn"
                    checked={manualForm.smsOptIn}
                    onChange={(e) => setManualForm(f => ({ ...f, smsOptIn: e.target.checked }))}
                    className="h-4 w-4 text-[#b48c3c] rounded"
                  />
                  <Label htmlFor="smsOptIn" className="text-xs font-semibold cursor-pointer">SMS Consent Opt-in</Label>
                </div>
              </div>

              <DialogFooter className="pt-2">
                <Button type="button" variant="ghost" onClick={() => setManualModalOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={submittingManual} className="bg-[#0F3B3D] text-white">
                  {submittingManual ? "Saving..." : "Save Manual Lead"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* CSV Import Wizard Dialog */}
        <Dialog open={csvModalOpen} onOpenChange={closeCSVWizard}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-[#b48c3c]" />
                CSV Lead Import Wizard
              </DialogTitle>
              <DialogDescription>Import bulk prospects. Homeowner accounts are capped at 500 leads maximum.</DialogDescription>
            </DialogHeader>

            {/* STEP 1: Paste CSV content */}
            {csvStep === 1 && (
              <div className="space-y-4 pt-2">
                <Label className="font-semibold text-sm">Paste CSV Text Content</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Ensure your CSV contains a headers row at the top (e.g. FirstName, LastName, Email, Phone, Tags).</p>
                <textarea
                  value={csvRawText}
                  onChange={(e) => setCsvRawText(e.target.value)}
                  placeholder="FirstName,LastName,Email,Phone,Tags&#10;John,Doe,john@example.com,+15550192834,Hot Lead;Referral&#10;Alice,Smith,alice@example.com,,Year 2"
                  rows={8}
                  className="w-full bg-background border p-4 text-xs font-mono rounded-xl focus:ring-1 focus:ring-[#b48c3c]"
                />
                <DialogFooter>
                  <Button variant="ghost" onClick={closeCSVWizard}>Cancel</Button>
                  <Button onClick={handleCSVLoad} disabled={!csvRawText.trim()} className="bg-[#b48c3c] text-white">
                    Next: Map Columns
                  </Button>
                </DialogFooter>
              </div>
            )}

            {/* STEP 2: Map Columns */}
            {csvStep === 2 && (
              <div className="space-y-4 pt-2 max-h-[60vh] overflow-y-auto pr-2">
                <Label className="font-semibold text-sm">Map CSV Headers to Lead Data Model</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Assign your CSV columns to the appropriate fields. Leftover columns will be omitted.</p>

                <div className="space-y-3 mt-4">
                  {csvHeaders.map((header) => (
                    <div key={header} className="flex items-center justify-between gap-4 p-2 bg-slate-50 dark:bg-slate-900 rounded-lg">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate w-1/2" title={header}>
                        CSV Column: <strong className="text-foreground">{header}</strong>
                      </span>
                      <Select
                        value={csvMapping[header] || "ignore"}
                        onValueChange={(val) => setCsvMapping(prev => ({ ...prev, [header]: val === "ignore" ? "" : val }))}
                      >
                        <SelectTrigger className="w-1/2 h-8 text-xs">
                          <SelectValue placeholder="Ignore Column" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ignore">Ignore Column</SelectItem>
                          <SelectItem value="firstName">First Name *</SelectItem>
                          <SelectItem value="lastName">Last Name *</SelectItem>
                          <SelectItem value="email">Email Address</SelectItem>
                          <SelectItem value="phone">Phone Number</SelectItem>
                          <SelectItem value="street">Street Address</SelectItem>
                          <SelectItem value="city">City</SelectItem>
                          <SelectItem value="state">State</SelectItem>
                          <SelectItem value="zipCode">Zip/Postal Code</SelectItem>
                          <SelectItem value="tags">Tags (semicolon split)</SelectItem>
                          <SelectItem value="emailOptIn">Email Opt-in Consent</SelectItem>
                          <SelectItem value="smsOptIn">SMS Opt-in Consent</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>

                <DialogFooter className="pt-4 border-t border-border">
                  <Button variant="ghost" onClick={() => setCsvStep(1)}>Back</Button>
                  <Button onClick={() => setCsvStep(3)} className="bg-[#b48c3c] text-white">
                    Next: Preview Rows
                  </Button>
                </DialogFooter>
              </div>
            )}

            {/* STEP 3: Preview Rows */}
            {csvStep === 3 && (
              <div className="space-y-4 pt-2">
                <Label className="font-semibold text-sm">Preview Data Rows & Selection Options</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Parsed <strong className="text-foreground">{csvRows.length}</strong> potential records. Choose duplicate handling logic.
                </p>

                <div className="space-y-4 my-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border">
                  <div className="space-y-1.5">
                    <Label className="font-semibold text-xs">Duplicate Ingestion Strategy (SW-LEAD-003)</Label>
                    <Select value={mergeStrategy} onValueChange={(val: any) => setMergeStrategy(val)}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="update">Update Existing Records (Merge tags/overwrite fields)</SelectItem>
                        <SelectItem value="skip">Skip duplicates entirely</SelectItem>
                        <SelectItem value="create">Create anyway (Force insert records)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="ghost" onClick={() => setCsvStep(2)}>Back</Button>
                  <Button onClick={() => setCsvStep(4)} className="bg-[#b48c3c] text-white">
                    Next: Consent Attestation
                  </Button>
                </DialogFooter>
              </div>
            )}

            {/* STEP 4: Consent & Execute */}
            {csvStep === 4 && (
              <div className="space-y-5 pt-2">
                <div className="p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 rounded-xl space-y-3 text-slate-800 dark:text-slate-300">
                  <div className="flex items-start gap-2">
                    <ShieldCheck className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <h4 className="font-bold text-xs">Legal Consent Attestation (SW-CSV-005)</h4>
                      <p className="text-[11px] mt-1 leading-relaxed text-slate-600 dark:text-slate-400">
                        By checking the box below, you explicitly attest and confirm that you possess a lawful basis and appropriate opt-in consents to message the contacts in this list under CAN-SPAM and TCPA compliance protocols.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-2 border-t border-amber-200/40">
                    <input
                      type="checkbox"
                      id="csvAttestation"
                      checked={consentAttested}
                      onChange={(e) => setConsentAttested(e.target.checked)}
                      className="h-4 w-4 text-[#b48c3c] rounded"
                    />
                    <label htmlFor="csvAttestation" className="text-xs font-bold text-slate-900 dark:text-white cursor-pointer">
                      I attest that all contacts have explicitly consented.
                    </label>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="ghost" onClick={() => setCsvStep(3)} disabled={importing}>Back</Button>
                  <Button
                    onClick={handleCSVImportExecute}
                    disabled={importing || !consentAttested}
                    className="bg-[#b48c3c] text-white gap-1.5"
                  >
                    {importing && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                    {importing ? "Importing leads..." : "Execute Bulk Import"}
                  </Button>
                </DialogFooter>
              </div>
            )}

            {/* STEP 5: Results & Completion */}
            {csvStep === 5 && importResults && (
              <div className="space-y-4 pt-2">
                <div className="p-4 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 rounded-xl flex items-center gap-3">
                  <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                  <div>
                    <h4 className="font-bold text-emerald-800 dark:text-emerald-400 text-sm">Bulk Ingestion Complete!</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">CSV import job finished processing successfully.</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 my-4">
                  <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-lg border text-center">
                    <span className="text-slate-400 text-[10px] block uppercase font-bold">Created</span>
                    <span className="text-xl font-bold text-slate-800 dark:text-slate-100">{importResults.createdCount}</span>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-lg border text-center">
                    <span className="text-slate-400 text-[10px] block uppercase font-bold">Merged</span>
                    <span className="text-xl font-bold text-slate-800 dark:text-slate-100">{importResults.updatedCount}</span>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-lg border text-center">
                    <span className="text-slate-400 text-[10px] block uppercase font-bold">Skipped</span>
                    <span className="text-xl font-bold text-slate-800 dark:text-slate-100">{importResults.skippedCount}</span>
                  </div>
                </div>

                {importResults.errorsCount > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs text-rose-500 font-bold">Ingestion error reports ({importResults.errorsCount} rows skipped):</Label>
                    <div className="max-h-[150px] overflow-y-auto border border-rose-200/50 rounded-lg p-2 bg-rose-50/20 text-[11px] font-mono space-y-1">
                      {importResults.errors.map((err: any, idx: number) => (
                        <p key={idx} className="text-rose-700 dark:text-rose-400">
                          Row {err.row} ({err.name}): {err.reason}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                <DialogFooter>
                  <Button onClick={closeCSVWizard} className="bg-primary text-white">Done</Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Lead Timeline Dialog */}
        <Dialog open={timelineLead !== null} onOpenChange={(open) => { if (!open) setTimelineLead(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-[#b48c3c]" />
                Prospect Activity Timeline
              </DialogTitle>
              {timelineLead && (
                <DialogDescription>
                  Activity timeline for <span className="font-semibold text-foreground">{timelineLead.firstName} {timelineLead.lastName}</span>
                </DialogDescription>
              )}
            </DialogHeader>

            <div className="space-y-4 my-2 pr-1 max-h-[50vh] overflow-y-auto">
              {loadingTimeline ? (
                <div className="p-8 text-center"><Skeleton className="h-20 w-full" /></div>
              ) : timelineEvents.length > 0 ? (
                <div className="relative border-l border-slate-200 dark:border-slate-800 ml-3.5 pl-6 space-y-6">
                  {timelineEvents.map((evt, idx) => (
                    <div key={idx} className="relative">
                      {/* Timeline Dot */}
                      <span className="absolute left-[-31px] top-1 h-3.5 w-3.5 rounded-full bg-white dark:bg-slate-950 border-2 border-[#b48c3c] flex items-center justify-center">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#b48c3c]" />
                      </span>
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">{evt.description}</p>
                      <p className="text-[10px] text-slate-400 mt-1">{new Date(evt.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-6">No timeline logged for this prospect.</p>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => setTimelineLead(null)} className="h-9">Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={!!leadToDelete} onOpenChange={(open) => !open && setLeadToDelete(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete Lead</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this lead? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="sm:justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setLeadToDelete(null)}>
                Cancel
              </Button>
              <Button variant="destructive" className="bg-red-500 hover:bg-red-600 text-white" onClick={confirmDeleteLead}>
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </PortalLayout>
    </ProtectedRoute>
  );
}
