"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_LEAD_STATUSES, statusColor, resolveLeadStatuses } from "@/lib/lead-statuses";
import { useQuery, fetchKey, invalidate, QUERY_KEYS } from "@/lib/use-query";
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
  Upload,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Trash2,
  Download,
  Save,
  AlertTriangle,
  Filter,
  X
} from "lucide-react";

type SegmentFilter = {
  field: string;
  operator: "equals" | "contains" | "startsWith" | "in" | "true" | "false";
  value: string | string[];
};

interface Segment {
  id: string;
  name: string;
  filters: SegmentFilter[];
  createdAt: string;
}

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

// NFR-P-002: page size for the server-side lead pager.
const ITEMS_PER_PAGE = 25;

export default function LeadsPage() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  // `statuses` is derived from the cached company record — see below.
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [segmentCounts, setSegmentCounts] = useState<Record<string, number>>({});
  const [saveSegmentOpen, setSaveSegmentOpen] = useState(false);
  const [segmentName, setSegmentName] = useState("");
  const [savingSegment, setSavingSegment] = useState(false);

  const activeSegmentFilters = useMemo(() => {
    const filters: SegmentFilter[] = [];
    if (statusFilter !== "all") filters.push({ field: "status", operator: "equals", value: statusFilter });
    if (tagFilter !== "all") filters.push({ field: "tags", operator: "contains", value: tagFilter });
    return filters;
  }, [statusFilter, tagFilter]);

  const fetchSegments = useCallback(async () => {
    try {
      // Shared with the campaigns and announcements pages via the query cache.
      const data = await fetchKey<Segment[]>(QUERY_KEYS.segments);
      if (!Array.isArray(data)) return;
      setSegments(data);
      const entries = await Promise.all(
        data.map(async (seg) => {
          try {
            const r = await fetch(`/api/sales/segments/${seg.id}/evaluate`);
            if (!r.ok) return [seg.id, -1] as const;
            return [seg.id, (await r.json()).count as number] as const;
          } catch {
            return [seg.id, -1] as const;
          }
        }),
      );
      setSegmentCounts(Object.fromEntries(entries));
    } catch {
      /* ignore */
    }
  }, []);

  const saveSegment = async () => {
    if (!segmentName.trim() || activeSegmentFilters.length === 0) return;
    setSavingSegment(true);
    try {
      const res = await fetch("/api/sales/segments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: segmentName.trim(), filters: activeSegmentFilters }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to save segment");
      toast.success(`Segment "${segmentName.trim()}" saved`);
      setSaveSegmentOpen(false);
      setSegmentName("");
      invalidate(QUERY_KEYS.segments);
      fetchSegments();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save segment");
    } finally {
      setSavingSegment(false);
    }
  };

  const deleteSegment = async (seg: Segment) => {
    try {
      const res = await fetch(`/api/sales/segments/${seg.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete segment");
      toast.success(`Segment "${seg.name}" deleted`);
      invalidate(QUERY_KEYS.segments);
      fetchSegments();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete segment");
    }
  };

  const applySegment = (seg: Segment) => {
    const status = seg.filters?.find((f) => f.field === "status")?.value;
    const tag = seg.filters?.find((f) => f.field === "tags")?.value;
    setStatusFilter(typeof status === "string" ? status : "all");
    setTagFilter(typeof tag === "string" ? tag : "all");
    setSearch("");
    setCurrentPage(1);
  };

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

  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [csvStep, setCsvStep] = useState(1);
  const [csvRawText, setCsvRawText] = useState("");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [csvMapping, setCsvMapping] = useState<Record<string, string>>({});
  const [mergeStrategy, setMergeStrategy] = useState<"skip" | "update" | "create">("update");
  const [consentAttested, setConsentAttested] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<any>(null);
  const [validation, setValidation] = useState<any>(null);
  const [validating, setValidating] = useState(false);
  const [csvTemplates, setCsvTemplates] = useState<any[]>([]);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  const [timelineLead, setTimelineLead] = useState<Lead | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalLeads, setTotalLeads] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [serverTags, setServerTags] = useState<string[]>([]);

  const [leadToDelete, setLeadToDelete] = useState<string | null>(null);

  const showToast = (msg: string) => {
    if (msg.toLowerCase().includes("error") || msg.toLowerCase().includes("fail")) {
      toast.error(msg);
    } else {
      toast.success(msg);
    }
  };

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status: statusFilter,
        tag: tagFilter,
        search,
        page: String(currentPage),
        pageSize: String(ITEMS_PER_PAGE),
      });
      const res = await fetch(`/api/sales/leads?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setLeads(data.leads || []);
        setTotalLeads(data.total || 0);
        setTotalPages(data.totalPages || 1);
        setServerTags(data.availableTags || []);
        if (data.total > 0 && currentPage > (data.totalPages || 1)) {
          setCurrentPage(data.totalPages || 1);
        }
      }
    } catch (error) {
      console.error("[sales/leads]", error);
      showToast("Error loading leads");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, tagFilter, currentPage]);

  const changeSearch = (value: string) => { setSearch(value); setCurrentPage(1); };
  const changeStatusFilter = (value: string) => { setStatusFilter(value); setCurrentPage(1); };
  const changeTagFilter = (value: string) => { setTagFilter(value); setCurrentPage(1); };

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  useEffect(() => {
    fetchSegments();
  }, [fetchSegments]);

  // NFR-P-001: /api/company is read by most pages. Going through the shared
  // cache means navigating between them reuses one response instead of
  // re-requesting it on every mount. Derived rather than copied into state, so
  // the tenant's configured statuses apply on the render they arrive.
  const { data: company } = useQuery<{ leadStatuses?: unknown }>(QUERY_KEYS.company);
  const statuses = useMemo(
    () => (company ? resolveLeadStatuses(company.leadStatuses) : DEFAULT_LEAD_STATUSES),
    [company],
  );

  const uniqueTags = useMemo(() => {
    if (serverTags.length > 0) return serverTags;
    const tagsSet = new Set<string>();
    leads.forEach(l => l.tags?.forEach(t => tagsSet.add(t)));
    return Array.from(tagsSet).sort();
  }, [serverTags, leads]);

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
        showToast(err.message || "Failed to delete lead.");
      }
    } catch (error) {
      console.error("[sales/leads]", error);
      showToast("Error deleting lead.");
    } finally {
      setLeadToDelete(null);
    }
  };

  // Handle Manual Lead Submit
  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualForm.firstName || !manualForm.lastName) {
      showToast("First name and last name are required.");
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
        showToast(err.message || "Failed to add lead.");
      }
    } catch {
      showToast("Error adding lead.");
    } finally {
      setSubmittingManual(false);
    }
  };

  // CSV Parsing
  const handleCSVLoad = () => {
    if (!csvRawText.trim()) {
      showToast("Please paste some CSV content.");
      return;
    }

    // Split text by lines and clean commas
    const lines = csvRawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      showToast("CSV must contain a header row and at least one data row.");
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
    setCsvStep(2);
  };

  const buildLeadsList = () => {
    return csvRows.map(row => {
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
  };

  const runValidation = async () => {
    setValidating(true);
    setValidation(null);
    try {
      const res = await fetch("/api/sales/csv/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadsList: buildLeadsList() }),
      });
      const data = await res.json();
      if (res.ok) setValidation(data);
      else showToast(data.message || "Validation failed.");
    } catch {
      showToast("Error validating rows.");
    } finally {
      setValidating(false);
    }
  };

  const downloadRejected = () => {
    const rejected = validation?.rejected || [];
    if (!rejected.length) return;
    const header = ["row", "firstName", "lastName", "email", "phone", "reason"];
    const escape = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [
      header.join(","),
      ...rejected.map((r: any) => header.map(h => escape(r[h])).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rejected-rows.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const fetchCsvTemplates = async () => {
    try {
      const res = await fetch("/api/sales/csv/templates");
      if (res.ok) setCsvTemplates(await res.json());
    } catch {
      /* ignore */
    }
  };

  const saveCsvTemplate = async () => {
    if (!newTemplateName.trim()) { showToast("Enter a template name."); return; }
    setSavingTemplate(true);
    try {
      const res = await fetch("/api/sales/csv/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTemplateName.trim(), mapping: csvMapping }),
      });
      if (res.ok) {
        setNewTemplateName("");
        showToast("Mapping template saved.");
        fetchCsvTemplates();
      } else {
        const d = await res.json().catch(() => ({}));
        showToast(d.message || "Failed to save template.");
      }
    } finally {
      setSavingTemplate(false);
    }
  };

  const applyCsvTemplate = (templateId: string) => {
    const tpl = csvTemplates.find(t => t.id === templateId);
    if (!tpl) return;
    const applied: Record<string, string> = {};
    csvHeaders.forEach(h => { applied[h] = tpl.mapping?.[h] || ""; });
    setCsvMapping(applied);
    showToast(`Applied template "${tpl.name}".`);
  };

  const deleteCsvTemplate = async (id: string) => {
    try {
      const res = await fetch(`/api/sales/csv/templates/${id}`, { method: "DELETE" });
      if (res.ok) fetchCsvTemplates();
    } catch {
      /* ignore */
    } 
  };

  const handleCSVImportExecute = async () => {
    setImporting(true);
    try {
      const leadsList = buildLeadsList();
      const res = await fetch("/api/sales/csv/upload", {
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
        setCsvStep(5);
        fetchLeads();
      } else {
        showToast(data.message || "Failed to parse import.");
      }
    } catch (err) {
      console.error("[sales/leads]", err);
      showToast("Error executing leads import.");
    } finally {
      setImporting(false);
    }
  };

  const closeCSVWizard = () => {
    setCsvModalOpen(false);
    setCsvStep(1);
    setCsvRawText("");
    setCsvHeaders([]);
    setCsvRows([]);
    setCsvMapping({});
    setConsentAttested(false);
    setImportResults(null);
    setValidation(null);
    setNewTemplateName("");
  };

  useEffect(() => {
    if (csvModalOpen) fetchCsvTemplates();
  }, [csvModalOpen]);

  useEffect(() => {
    if (csvStep === 3 && csvRows.length > 0) runValidation();
  }, [csvStep]);

  const openTimeline = async (lead: Lead) => {
    setTimelineLead(lead);
    setTimelineEvents([]);
    setLoadingTimeline(true);
    try {
      const res = await fetch(`/api/sales/leads/${lead.id}/timeline`);
      if (res.ok) {
        const data = await res.json();
        setTimelineEvents(data);
      } else {
        showToast("Failed to load timeline.");
      }
    } catch {
      showToast("Error loading timeline.");
    } finally {
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
                      onChange={(e) => changeSearch(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-xs font-semibold text-muted-foreground mb-1 block">Lead Status</Label>
                  <Select value={statusFilter} onValueChange={changeStatusFilter}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="All Statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      {statuses.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs font-semibold text-muted-foreground mb-1 block">Lead Tag</Label>
                  <Select value={tagFilter} onValueChange={changeTagFilter}>
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

              {/* ─── Saved segments ─────────────────────────────────────────── */}
              <div className="mt-4 pt-4 border-t border-border/60">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Filter className="h-3.5 w-3.5 text-[#b48c3c]" />
                    <span className="text-xs font-semibold">Saved Segments</span>
                    <span className="text-[11px] text-muted-foreground">
                      Reusable audiences you can target from a campaign.
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    disabled={activeSegmentFilters.length === 0}
                    onClick={() => setSaveSegmentOpen(true)}
                    title={
                      activeSegmentFilters.length === 0
                        ? "Pick a status or tag filter first"
                        : "Save the current filters as a segment"
                    }
                  >
                    <Save className="h-3.5 w-3.5" /> Save current filters
                  </Button>
                </div>

                {segments.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground mt-2.5">
                    No segments yet. Filter by status or tag above, then save it as a segment to
                    target it from a campaign.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {segments.map((seg) => {
                      const count = segmentCounts[seg.id];
                      return (
                        <span
                          key={seg.id}
                          className="group inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-white dark:bg-slate-900 pl-3 pr-1.5 py-1 text-xs shadow-xs"
                        >
                          <button
                            type="button"
                            onClick={() => applySegment(seg)}
                            className="font-semibold hover:text-[#b48c3c] transition-colors"
                            title="Apply this segment's filters"
                          >
                            {seg.name}
                          </button>
                          <span className="text-[10px] font-semibold text-muted-foreground bg-slate-100 dark:bg-slate-800 rounded-full px-1.5 py-0.5">
                            {count === undefined ? "…" : count < 0 ? "—" : count}
                          </span>
                          <button
                            type="button"
                            onClick={() => deleteSegment(seg)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-500 rounded-full p-0.5"
                            title={`Delete segment "${seg.name}"`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Save-segment dialog */}
          <Dialog open={saveSegmentOpen} onOpenChange={setSaveSegmentOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Save segment</DialogTitle>
                <DialogDescription>
                  Segments are evaluated live — a campaign targeting this segment enrolls whoever
                  matches at that moment, not a frozen list.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Segment name</Label>
                  <Input
                    autoFocus
                    placeholder="e.g. New leads tagged VIP"
                    value={segmentName}
                    onChange={(e) => setSegmentName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveSegment();
                    }}
                  />
                </div>

                <div className="rounded-lg border border-border/70 bg-slate-50 dark:bg-slate-900/40 p-3">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                    Matches leads where
                  </p>
                  <ul className="space-y-1">
                    {activeSegmentFilters.map((f) => (
                      <li key={f.field} className="text-xs">
                        <span className="text-muted-foreground">
                          {f.field === "tags" ? "Tag" : "Status"}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          {f.field === "tags" ? "includes" : "is"}
                        </span>{" "}
                        <span className="font-semibold">{String(f.value)}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {search.trim() !== "" && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-500 flex items-start gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                    Your search text is not saved — segments match on status and tag only.
                  </p>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setSaveSegmentOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={saveSegment}
                  disabled={!segmentName.trim() || savingSegment}
                  className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90"
                >
                  {savingSegment ? "Saving…" : "Save segment"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Leads Table */}
          <Card className="overflow-hidden border border-border/80 shadow-xs">
            <CardContent className="p-0 overflow-x-auto">
              {loading ? (
                <div className="p-6 space-y-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-40 w-full" /></div>
              ) : leads.length > 0 ? (
                <>
                  <Table className="min-w-250">
                    <TableHeader className="bg-muted/15 border-b border-border/50">
                      <TableRow>
                        <TableHead className="py-3.5 px-4 font-semibold text-xs text-muted-foreground text-left">Prospect Name</TableHead>
                        <TableHead className="py-3.5 px-4 font-semibold text-xs text-muted-foreground text-left">Email</TableHead>
                        <TableHead className="py-3.5 px-4 font-semibold text-xs text-muted-foreground text-left">Phone</TableHead>
                        <TableHead className="py-3.5 px-4 font-semibold text-xs text-muted-foreground text-left">Status</TableHead>
                        <TableHead className="py-3.5 px-4 font-semibold text-xs text-muted-foreground text-left">Opt-in Consent</TableHead>
                        <TableHead className="py-3.5 px-4 font-semibold text-xs text-muted-foreground text-left">Assigned agent</TableHead>
                        <TableHead className="py-3.5 px-4 font-semibold text-xs text-muted-foreground text-right pr-6">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {/* `leads` is already exactly one page from the server. */}
                      {leads.map((lead) => (
                        <TableRow key={lead.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition border-b border-border/30">
                          <TableCell className="py-3 px-4 font-semibold text-slate-800 dark:text-slate-200 align-middle">
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
                          <TableCell className="py-3 px-4 text-xs font-semibold text-slate-800 dark:text-slate-200 align-middle">
                            {lead.email || "—"}
                          </TableCell>
                          <TableCell className="py-3 px-4 text-xs text-slate-500 font-medium align-middle">
                            {lead.phone || "—"}
                          </TableCell>
                          <TableCell className="py-3 px-4 align-middle">
                            <Badge variant="outline" className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold border ${statusColor(lead.status)}`}>
                              {lead.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-3 px-4 text-xs font-semibold align-middle">
                            <div className="space-y-0.5">
                              {lead.emailOptIn ? <span className="text-green-600 block">✓ Email Opt-in</span> : <span className="text-slate-400 block">✗ Email Opt-out</span>}
                              {lead.smsOptIn ? <span className="text-green-600 block">✓ SMS Opt-in</span> : <span className="text-slate-400 block">✗ SMS Opt-out</span>}
                            </div>
                          </TableCell>
                          <TableCell className="py-3 px-4 text-xs text-slate-600 dark:text-slate-300 font-medium align-middle">{lead.owner?.name || "Unassigned"}</TableCell>
                          <TableCell className="py-3 px-4 text-right pr-6 space-x-1 align-middle">
                            <Button variant="ghost" size="sm" onClick={() => openTimeline(lead)} className="text-slate-500 hover:bg-slate-500/10 text-xs px-2" title="View activity timeline">
                              <Clock className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setLeadToDelete(lead.id)} className="text-red-500 hover:bg-red-500/10 text-xs px-2">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {/* Totals come from the server response — `leads` is one page. */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between px-6 py-4 border-t border-border/50 bg-slate-50/30 dark:bg-slate-900/10">
                      <div className="text-xs text-muted-foreground">
                        Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} to {Math.min((currentPage - 1) * ITEMS_PER_PAGE + leads.length, totalLeads)} of {totalLeads} prospects
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground mr-1">
                          Page {currentPage} of {totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                          disabled={currentPage === 1 || loading}
                          className="h-8 text-xs"
                        >
                          Previous
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                          disabled={currentPage >= totalPages || loading}
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
                      {statuses.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
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
                <Label className="font-semibold text-sm">Upload CSV File</Label>
                <div className="p-4 bg-blue-50/50 dark:bg-blue-900/10 rounded-xl border border-blue-100 dark:border-blue-900/30">
                  <h4 className="text-xs font-semibold text-blue-800 dark:text-blue-300 mb-1">Required Data & Headers</h4>
                  <p className="text-[11px] text-blue-700/80 dark:text-blue-400/80 leading-relaxed">
                    Your CSV must contain at least a <strong>First Name</strong> and <strong>Last Name</strong> column. You can also map Email, Phone, Street, City, State, Zip Code, Tags, and SMS/Email Opt-In statuses.
                  </p>
                </div>
                <Input
                  type="file"
                  accept=".csv"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = (evt) => {
                        if (evt.target?.result) {
                          setCsvRawText(evt.target.result as string);
                        }
                      };
                      reader.readAsText(file);
                    } else {
                      setCsvRawText("");
                    }
                  }}
                  className="w-full text-xs cursor-pointer file:cursor-pointer"
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

                {/* SW-CSV-002: mapping templates */}
                <div className="flex flex-col sm:flex-row gap-2 sm:items-end p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border mt-3">
                  <div className="flex-1 space-y-1">
                    <Label className="text-[11px] font-semibold text-muted-foreground">Apply a saved template</Label>
                    <Select onValueChange={applyCsvTemplate}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder={csvTemplates.length ? "Choose template…" : "No templates saved yet"} />
                      </SelectTrigger>
                      <SelectContent>
                        {csvTemplates.map((t) => (
                          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end gap-1.5">
                    <div className="space-y-1">
                      <Label className="text-[11px] font-semibold text-muted-foreground">Save current as</Label>
                      <Input value={newTemplateName} onChange={(e) => setNewTemplateName(e.target.value)} placeholder="Template name" className="h-8 text-xs w-40" />
                    </div>
                    <Button size="sm" variant="outline" className="h-8 text-xs" disabled={savingTemplate || !newTemplateName.trim()} onClick={saveCsvTemplate}>
                      <Save className="h-3.5 w-3.5 mr-1" /> Save
                    </Button>
                  </div>
                </div>
                {csvTemplates.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {csvTemplates.map((t) => (
                      <span key={t.id} className="inline-flex items-center gap-1 text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full">
                        {t.name}
                        <button type="button" onClick={() => deleteCsvTemplate(t.id)} className="text-slate-400 hover:text-red-500" title="Delete template">
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

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

                {/* SW-CSV-003: pre-commit validation summary */}
                <div className="my-4">
                  {validating ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Validating rows…
                    </div>
                  ) : validation ? (
                    <>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-lg border bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 p-3 text-center">
                          <span className="block text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-400">Valid (new)</span>
                          <span className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{validation.valid}</span>
                        </div>
                        <div className="rounded-lg border bg-amber-50 dark:bg-amber-950/20 border-amber-200 p-3 text-center">
                          <span className="block text-[10px] uppercase font-bold text-amber-700 dark:text-amber-400">Duplicates</span>
                          <span className="text-lg font-bold text-amber-700 dark:text-amber-300">{validation.duplicates}</span>
                        </div>
                        <div className="rounded-lg border bg-rose-50 dark:bg-rose-950/20 border-rose-200 p-3 text-center">
                          <span className="block text-[10px] uppercase font-bold text-rose-700 dark:text-rose-400">Invalid</span>
                          <span className="text-lg font-bold text-rose-700 dark:text-rose-300">{validation.invalid}</span>
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-2 flex items-start gap-1">
                        <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-amber-500" />
                        {validation.duplicatesInDb} already in your database · {validation.duplicatesInFile} repeated within this file. Duplicates follow the strategy below; invalid rows are skipped on import.
                      </p>
                      {validation.invalid > 0 && (
                        <Button variant="outline" size="sm" className="h-8 text-xs mt-2 text-rose-600 border-rose-200 hover:bg-rose-50" onClick={downloadRejected}>
                          <Download className="h-3.5 w-3.5 mr-1" /> Download {validation.invalid} rejected row{validation.invalid === 1 ? "" : "s"}
                        </Button>
                      )}
                    </>
                  ) : null}
                </div>

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
                    <div className="max-h-37.5 overflow-y-auto border border-rose-200/50 rounded-lg p-2 bg-rose-50/20 text-[11px] font-mono space-y-1">
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
                      <span className="absolute left-7.75 top-1 h-3.5 w-3.5 rounded-full bg-white dark:bg-slate-950 border-2 border-[#b48c3c] flex items-center justify-center">
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
