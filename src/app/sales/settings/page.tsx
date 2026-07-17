"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useSearchParams } from "next/navigation";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import MessagingSettingsTab from "@/components/sales/settings/MessagingSettingsTab";
import NewsSourcesTab from "@/components/sales/settings/NewsSourcesTab";
import MappingHistoryDialog from "@/components/sales/settings/MappingHistoryDialog";
import DeadLetterTab from "@/components/sales/settings/DeadLetterTab";
import { DEFAULT_LEAD_STATUSES } from "@/lib/lead-statuses";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Settings,
  Plug,
  Shield,
  SlidersHorizontal,
  Database,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Plus,
  Trash2,
  Clock,
  Key,
  History,
  ArrowDownToLine,
  ArrowUpFromLine,
  ExternalLink,
  Loader2,
  Copy,
  Check,
} from "lucide-react";
import { motion } from "framer-motion";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConnectionStatus {
  connected: boolean;
  environment: string | null;
  instanceUrl?: string;
  syncInterval: number;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncMessage: string | null;
  clientIdMasked: string | null;
  syncedLeadCount?: number;
  connectedSince?: string;
  writeBackEnabled?: boolean;
}

interface FieldMapping {
  id?: string;
  salesforceField: string;
  portalField: string;
  description: string | null;
  isActive: boolean;
  isConsentField: boolean;
}

interface SyncLogEntry {
  id: string;
  direction: string;
  action: string;
  status: string;
  recordCount: number;
  errorCount: number;
  message: string | null;
  createdAt: string;
}

// ─── Animation Variants ───────────────────────────────────────────────────────

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

function SettingsPageContent() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState("crm");

  // ─── Salesforce Connection State ──────────────────────────────────────────
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [oauthModalOpen, setOauthModalOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [bulkIngesting, setBulkIngesting] = useState(false);
  const [syncingIncremental, setSyncingIncremental] = useState(false);

  // OAuth form fields
  const [sfClientId, setSfClientId] = useState("");
  const [sfClientSecret, setSfClientSecret] = useState("");
  const [sfEnvironment, setSfEnvironment] = useState<"sandbox" | "production">("sandbox");
  const [copiedRedirect, setCopiedRedirect] = useState(false);

  // The exact callback URL that must be registered in the Salesforce Connected
  // App — mirrors the redirect_uri the backend sends (derived from the origin).
  const redirectUri =
    typeof window !== "undefined" ? `${window.location.origin}/api/sales/salesforce/callback` : "";

  const copyRedirectUri = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopiedRedirect(true);
      setTimeout(() => setCopiedRedirect(false), 2000);
    } catch {
      showToast("Couldn't copy — copy it manually.", "error");
    }
  };

  // ─── Field Mappings State ────────────────────────────────────────────────
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [loadingMappings, setLoadingMappings] = useState(false);
  const [addMappingOpen, setAddMappingOpen] = useState(false);
  const [newSfField, setNewSfField] = useState("");
  const [newPortalField, setNewPortalField] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newIsConsent, setNewIsConsent] = useState(false);
  const [savingMapping, setSavingMapping] = useState(false);
  // SW-CRM-004: mapping version history / rollback.
  const [mappingHistoryOpen, setMappingHistoryOpen] = useState(false);

  // ─── Sync Logs State ─────────────────────────────────────────────────────
  const [syncLogs, setSyncLogs] = useState<SyncLogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // ─── Outreach & Compliance State ──────────────────────────────────────────
  const [defaultOwner, setDefaultOwner] = useState("Unassigned");
  const [teamMembers, setTeamMembers] = useState<{ id: string; name: string | null; email: string }[]>([]);
  const [voiceProfile, setVoiceProfile] = useState("professional");
  const [complianceOptInRequired, setComplianceOptInRequired] = useState(true);

  // ─── SMS Quiet Hours (SW-ANN — tenant-configurable, not hardcoded) ─────────
  const [smsQuietHoursEnabled, setSmsQuietHoursEnabled] = useState(true);
  const [quietHoursStart, setQuietHoursStart] = useState(8);
  const [quietHoursEnd, setQuietHoursEnd] = useState(21);
  const [quietHoursTimezone, setQuietHoursTimezone] = useState("");

  // ─── Lead Lifecycle Statuses (SW-LEAD-006 — tenant-configurable) ───────────
  const [leadStatuses, setLeadStatuses] = useState<string[]>([]);
  const [newStatus, setNewStatus] = useState("");
  const [savingStatuses, setSavingStatuses] = useState(false);

  const [savingOutreach, setSavingOutreach] = useState(false);
  const [suppressionList, setSuppressionList] = useState<{ id: string; value: string; reason: string; createdAt: string }[]>([]);
  const [loadingSuppression, setLoadingSuppression] = useState(false);
  const [newSuppressValue, setNewSuppressValue] = useState("");
  const [newSuppressReason, setNewSuppressReason] = useState("UNSUBSCRIBE");
  const [addingSuppression, setAddingSuppression] = useState(false);
  const [suppressionSearch, setSuppressionSearch] = useState("");
  const [suppressionPage, setSuppressionPage] = useState(1);
  const [suppressionTotalPages, setSuppressionTotalPages] = useState(1);

  // ─── Toast / Notifications ────────────────────────────────────────────────
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // ─── Fetch Connection Status ──────────────────────────────────────────────

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/sales/salesforce/status");
      if (res.ok) {
        const data = await res.json();
        setConnectionStatus(data);
      }
    } catch (error) {
      console.error("Failed to fetch SF status:", error);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  // ─── Fetch Field Mappings ─────────────────────────────────────────────────

  const fetchMappings = useCallback(async () => {
    setLoadingMappings(true);
    try {
      const res = await fetch("/api/sales/salesforce/mappings");
      if (res.ok) {
        const data = await res.json();
        setMappings(data);
      }
    } catch (error) {
      console.error("Failed to fetch mappings:", error);
    } finally {
      setLoadingMappings(false);
    }
  }, []);

  // ─── Fetch Sync Logs ──────────────────────────────────────────────────────

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const res = await fetch("/api/sales/salesforce/logs?limit=10");
      if (res.ok) {
        const data = await res.json();
        setSyncLogs(data.logs || []);
      }
    } catch (error) {
      console.error("Failed to fetch logs:", error);
    } finally {
      setLoadingLogs(false);
    }
  }, []);

  // ─── Fetch Company Settings ──────────────────────────────────────────────
  const fetchCompanySettings = useCallback(async () => {
    try {
      const res = await fetch("/api/company");
      if (res.ok) {
        const data = await res.json();
        if (data) {
          if (data.defaultLeadOwner) setDefaultOwner(data.defaultLeadOwner);
          if (data.voiceProfile) setVoiceProfile(data.voiceProfile);
          if (data.complianceOptInRequired !== undefined) setComplianceOptInRequired(data.complianceOptInRequired);
          if (data.smsQuietHoursEnabled !== undefined) setSmsQuietHoursEnabled(data.smsQuietHoursEnabled);
          if (data.quietHoursStart !== undefined) setQuietHoursStart(data.quietHoursStart);
          if (data.quietHoursEnd !== undefined) setQuietHoursEnd(data.quietHoursEnd);
          if (data.quietHoursTimezone) setQuietHoursTimezone(data.quietHoursTimezone);
          if (Array.isArray(data.leadStatuses) && data.leadStatuses.length) {
            setLeadStatuses(data.leadStatuses.map((s: unknown) => String(s)));
          } else {
            setLeadStatuses([...DEFAULT_LEAD_STATUSES]);
          }
        }
      }
    } catch (error) {
      console.error("Failed to fetch company compliance settings:", error);
    }

    // Populate the "default lead owner" dropdown from real team members.
    try {
      const usersRes = await fetch("/api/users");
      if (usersRes.ok) {
        const users = await usersRes.json();
        if (Array.isArray(users)) setTeamMembers(users);
      }
    } catch (error) {
      console.error("Failed to fetch team members:", error);
    }
  }, []);

  // ─── Fetch Suppression List ──────────────────────────────────────────────
  const fetchSuppressionList = useCallback(async (page = 1, search = "") => {
    setLoadingSuppression(true);
    try {
      const res = await fetch(`/api/sales/compliance/suppression?page=${page}&limit=5&search=${encodeURIComponent(search)}`);
      if (res.ok) {
        const data = await res.json();
        setSuppressionList(data.suppressedItems || []);
        setSuppressionTotalPages(data.pagination?.totalPages || 1);
        setSuppressionPage(data.pagination?.page || 1);
      }
    } catch (error) {
      console.error("Failed to fetch suppression list:", error);
    } finally {
      setLoadingSuppression(false);
    }
  }, []);

  const handleSaveOutreachSettings = async () => {
    setSavingOutreach(true);
    try {
      const res = await fetch("/api/company", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultLeadOwner: defaultOwner,
          voiceProfile,
          complianceOptInRequired,
          smsQuietHoursEnabled,
          quietHoursStart,
          quietHoursEnd,
          quietHoursTimezone: quietHoursTimezone || null,
        }),
      });

      if (res.ok) {
        showToast("Outreach and compliance settings saved successfully.");
      } else {
        const data = await res.json();
        showToast(data.message || "Failed to save settings", "error");
      }
    } catch (error) {
      console.error("[sales/settings]", error);
      showToast("Error saving outreach settings", "error");
    } finally {
      setSavingOutreach(false);
    }
  };

  // SW-LEAD-006: persist the tenant's lead lifecycle status set.
  const handleSaveLeadStatuses = async () => {
    const cleaned = leadStatuses.map((s) => s.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      showToast("Add at least one lead status", "error");
      return;
    }
    setSavingStatuses(true);
    try {
      const res = await fetch("/api/company", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadStatuses: cleaned }),
      });
      if (res.ok) {
        showToast("Lead statuses saved.");
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.message || "Failed to save lead statuses", "error");
      }
    } catch (error) {
      console.error("[sales/settings] lead statuses save failed:", error);
      showToast("Error saving lead statuses", "error");
    } finally {
      setSavingStatuses(false);
    }
  };

  const addLeadStatus = () => {
    const label = newStatus.trim();
    if (!label) return;
    if (leadStatuses.some((s) => s.toLowerCase() === label.toLowerCase())) {
      showToast("That status already exists", "error");
      return;
    }
    setLeadStatuses((prev) => [...prev, label]);
    setNewStatus("");
  };

  const removeLeadStatus = (label: string) => {
    setLeadStatuses((prev) => prev.filter((s) => s !== label));
  };

  const moveLeadStatus = (index: number, dir: -1 | 1) => {
    setLeadStatuses((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleAddSuppression = async () => {
    if (!newSuppressValue.trim()) {
      showToast("Email address or phone number is required", "error");
      return;
    }
    setAddingSuppression(true);
    try {
      const res = await fetch("/api/sales/compliance/suppression", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value: newSuppressValue,
          reason: newSuppressReason,
        }),
      });

      if (res.ok) {
        showToast("Successfully added to suppression list");
        setNewSuppressValue("");
        fetchSuppressionList(1, suppressionSearch);
      } else {
        const data = await res.json();
        showToast(data.message || "Failed to add to suppression list", "error");
      }
    } catch (error) {
      console.error("[sales/settings]", error);
      showToast("Error adding to suppression list", "error");
    } finally {
      setAddingSuppression(false);
    }
  };

  const confirm = useConfirm();

  const handleDeleteSuppression = async (id: string) => {
    if (!(await confirm({
      title: "Remove from suppression list?",
      description: "This contact will be eligible to receive messages again.",
      confirmText: "Remove",
    }))) return;
    try {
      const res = await fetch("/api/sales/compliance/suppression", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      if (res.ok) {
        showToast("Removed from suppression list");
        fetchSuppressionList(suppressionPage, suppressionSearch);
      } else {
        const data = await res.json();
        showToast(data.message || "Failed to delete", "error");
      }
    } catch (error) {
      console.error("[sales/settings]", error);
      showToast("Error deleting suppression item", "error");
    }
  };

  // ─── Initial Data Load ────────────────────────────────────────────────────

  useEffect(() => {
    fetchStatus();
    fetchMappings();
    fetchLogs();
    fetchCompanySettings();
    fetchSuppressionList(1, "");
  }, [fetchStatus, fetchMappings, fetchLogs, fetchCompanySettings, fetchSuppressionList]);

  // Handle OAuth redirect results
  useEffect(() => {
    const connected = searchParams.get("connected");
    const sfError = searchParams.get("sf_error");

    if (connected === "true") {
      showToast("Successfully connected to Salesforce!", "success");
      fetchStatus();
      fetchMappings();
      fetchLogs();
      // Clean URL
      window.history.replaceState({}, "", "/sales/settings");
    } else if (sfError) {
      showToast(`Salesforce connection failed: ${decodeURIComponent(sfError)}`, "error");
      window.history.replaceState({}, "", "/sales/settings");
    }
  }, [searchParams, fetchStatus, fetchMappings, fetchLogs]);

  // Auto-refresh logs every 30 seconds when CRM tab is active
  useEffect(() => {
    if (activeTab !== "crm") return;
    const interval = setInterval(fetchLogs, 30000);
    return () => clearInterval(interval);
  }, [activeTab, fetchLogs]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleConnectSF = async () => {
    if (!sfClientId.trim() || !sfClientSecret.trim()) {
      showToast("Client ID and Client Secret are required", "error");
      return;
    }
    setConnecting(true);
    try {
      const res = await fetch("/api/sales/salesforce/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: sfClientId,
          clientSecret: sfClientSecret,
          environment: sfEnvironment,
        }),
      });
      const data = await res.json();
      if (res.ok && data.authUrl) {
        // Redirect to Salesforce OAuth login
        window.location.href = data.authUrl;
      } else {
        showToast(data.message || "Failed to initiate OAuth", "error");
      }
    } catch (error) {
      console.error("[sales/settings]", error);
      showToast("Failed to connect to Salesforce", "error");
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnectSF = async () => {
    if (!(await confirm({
      title: "Disconnect Salesforce?",
      description: "Disconnecting will pause all background sync.",
      confirmText: "Disconnect",
    }))) return;
    setDisconnecting(true);
    try {
      const res = await fetch("/api/sales/salesforce/disconnect", {
        method: "POST",
      });
      if (res.ok) {
        showToast("Salesforce disconnected successfully");
        fetchStatus();
        fetchLogs();
      } else {
        const data = await res.json();
        showToast(data.message || "Disconnect failed", "error");
      }
    } catch (error) {
      console.error("[sales/settings]", error);
      showToast("Disconnect failed", "error");
    } finally {
      setDisconnecting(false);
    }
  };

  const handleBulkIngest = async () => {
    setBulkIngesting(true);
    try {
      const res = await fetch("/api/sales/salesforce/bulk-import", {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        showToast(
          `Bulk import complete! Created: ${data.createdCount}, Updated: ${data.updatedCount}${data.errorCount > 0 ? `, Errors: ${data.errorCount}` : ""}`,
          data.errorCount > 0 ? "error" : "success"
        );
        fetchStatus();
        fetchLogs();
      } else {
        showToast(data.message || "Bulk import failed", "error");
        fetchLogs();
      }
    } catch (error) {
      console.error("[sales/settings]", error);
      showToast("Bulk import failed — check console for details", "error");
    } finally {
      setBulkIngesting(false);
    }
  };

  const handleIncrementalSync = async () => {
    setSyncingIncremental(true);
    try {
      const res = await fetch("/api/sales/salesforce/sync", {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || "Incremental sync complete");
        fetchStatus();
        fetchLogs();
      } else {
        showToast(data.message || "Sync failed", "error");
        fetchLogs();
      }
    } catch (error) {
      console.error("[sales/settings]", error);
      showToast("Sync failed", "error");
    } finally {
      setSyncingIncremental(false);
    }
  };

  const handleSyncIntervalChange = async (value: string) => {
    try {
      await fetch("/api/sales/salesforce/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syncInterval: value }),
      });
      fetchStatus();
    } catch (error) {
      console.error("Failed to update sync interval:", error);
    }
  };

  // SW-CRM-008: toggle outbound write-back (status/consent → Salesforce).
  const handleWriteBackToggle = async (enabled: boolean) => {
    // Optimistic update; revert on failure.
    setConnectionStatus((prev) => (prev ? { ...prev, writeBackEnabled: enabled } : prev));
    try {
      const res = await fetch("/api/sales/salesforce/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ writeBackEnabled: enabled }),
      });
      if (!res.ok) throw new Error("request failed");
      showToast(
        enabled ? "Salesforce write-back enabled." : "Salesforce write-back disabled.",
      );
      fetchStatus();
    } catch (error) {
      console.error("[sales/settings] write-back toggle failed:", error);
      setConnectionStatus((prev) => (prev ? { ...prev, writeBackEnabled: !enabled } : prev));
      showToast("Couldn't update write-back setting. Please try again.", "error");
    }
  };

  // ─── Field Mapping Handlers ───────────────────────────────────────────────

  const handleAddMapping = async () => {
    if (!newSfField.trim() || !newPortalField.trim()) return;
    setSavingMapping(true);
    try {
      const res = await fetch("/api/sales/salesforce/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salesforceField: newSfField,
          portalField: newPortalField,
          description: newDescription || null,
          isConsentField: newIsConsent,
        }),
      });
      if (res.ok) {
        showToast("Field mapping added");
        setNewSfField("");
        setNewPortalField("");
        setNewDescription("");
        setNewIsConsent(false);
        setAddMappingOpen(false);
        fetchMappings();
      } else {
        const data = await res.json();
        showToast(data.message || "Failed to save mapping", "error");
      }
    } catch (error) {
      console.error("[sales/settings]", error);
      showToast("Failed to save mapping", "error");
    } finally {
      setSavingMapping(false);
    }
  };

  const handleDeleteMapping = async (id: string) => {
    try {
      const res = await fetch("/api/sales/salesforce/mappings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        showToast("Mapping removed");
        fetchMappings();
      }
    } catch (error) {
      console.error("[sales/settings]", error);
      showToast("Failed to delete mapping", "error");
    }
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const isConnected = connectionStatus?.connected ?? false;

  const formatTimeAgo = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} min ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };

  const getLogStatusColor = (status: string) => {
    switch (status) {
      case "SUCCESS": return "bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400";
      case "WARNING": return "bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400";
      case "ERROR": return "bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400";
      default: return "bg-slate-50 text-slate-700 dark:bg-slate-950/20 dark:text-slate-400";
    }
  };

  return (
    <ProtectedRoute allowedRoles={["admin", "staff"]}>
      <PortalLayout workspace="sales">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="space-y-6 max-w-7xl mx-auto"
        >
          {/* Toast Notification */}
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className={`fixed top-4 right-4 z-100 max-w-md px-4 py-3 rounded-xl shadow-lg border text-sm font-medium ${toast.type === "success"
                ? "bg-green-50 text-green-800 border-green-200 dark:bg-green-950/80 dark:text-green-300 dark:border-green-800"
                : "bg-red-50 text-red-800 border-red-200 dark:bg-red-950/80 dark:text-red-300 dark:border-red-800"
                }`}
            >
              <div className="flex items-center gap-2">
                {toast.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                {toast.message}
              </div>
            </motion.div>
          )}

          {/* Header */}
          <motion.div variants={fadeInUp} className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
                Sales Workspace Settings
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                Configure Salesforce CRM connector integration, compliance rules, and custom fields metadata.
              </p>
            </div>
            <Settings className="h-6 w-6 text-[#b48c3c]" />
          </motion.div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <motion.div variants={fadeInUp}>
              <TabsList className="bg-slate-100 dark:bg-slate-900/60 p-1 rounded-xl grid grid-cols-6 max-w-4xl h-10">
                <TabsTrigger value="crm" className="text-xs font-semibold rounded-lg">CRM Integrations</TabsTrigger>
                <TabsTrigger value="outreach" className="text-xs font-semibold rounded-lg">Outreach & Compliance</TabsTrigger>
                <TabsTrigger value="pipeline" className="text-xs font-semibold rounded-lg">Lead Pipeline</TabsTrigger>
                <TabsTrigger value="messaging" className="text-xs font-semibold rounded-lg">Email & SMS</TabsTrigger>
                <TabsTrigger value="news" className="text-xs font-semibold rounded-lg">News Sources</TabsTrigger>
                <TabsTrigger value="failed" className="text-xs font-semibold rounded-lg">Failed Sends</TabsTrigger>
              </TabsList>
            </motion.div>

            {/* TAB: MESSAGING (EMAIL & SMS) */}
            <TabsContent value="messaging" className="space-y-6 focus-visible:outline-none">
              <MessagingSettingsTab />
            </TabsContent>

            {/* TAB: NEWS SOURCES (SW-NEWS-001 — per-tenant configurable feeds) */}
            <TabsContent value="news" className="space-y-6 focus-visible:outline-none">
              <NewsSourcesTab />
            </TabsContent>

            {/* SW-ANN-002: dead-letter queue — permanently failed sends. */}
            <TabsContent value="failed" className="space-y-6 focus-visible:outline-none">
              <DeadLetterTab />
            </TabsContent>

            {/* TAB: LEAD PIPELINE (SW-LEAD-006 — tenant-configurable statuses) */}
            <TabsContent value="pipeline" className="space-y-6 focus-visible:outline-hidden">
              <Card className="border border-border/80 shadow-xs max-w-2xl">
                <CardHeader>
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <SlidersHorizontal className="h-4.5 w-4.5 text-[#b48c3c]" />
                    Lead Lifecycle Statuses
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Define the pipeline stages your team uses. These appear in the lead table, filters, and status dropdowns. Reorder to match your funnel.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-5 space-y-4">
                  <div className="space-y-2">
                    {leadStatuses.map((status, idx) => (
                      <div
                        key={status}
                        className="flex items-center gap-2 rounded-lg border p-2 pl-3 bg-slate-50/40 dark:bg-slate-900/20"
                      >
                        <span className="flex-1 text-xs font-medium">{status}</span>
                        <div className="flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground"
                            disabled={idx === 0}
                            onClick={() => moveLeadStatus(idx, -1)}
                            title="Move up"
                          >
                            <ArrowUpFromLine className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground"
                            disabled={idx === leadStatuses.length - 1}
                            onClick={() => moveLeadStatus(idx, 1)}
                            title="Move down"
                          >
                            <ArrowDownToLine className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-red-500 hover:bg-red-500/10"
                            disabled={leadStatuses.length <= 1}
                            onClick={() => removeLeadStatus(status)}
                            title="Remove"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {leadStatuses.length === 0 && (
                      <p className="text-xs text-muted-foreground py-4 text-center">No statuses yet — add one below.</p>
                    )}
                  </div>

                  <div className="flex gap-2 pt-1">
                    <Input
                      value={newStatus}
                      onChange={(e) => setNewStatus(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addLeadStatus();
                        }
                      }}
                      placeholder="Add a status (e.g. Proposal Sent)"
                      className="h-9 text-xs"
                      maxLength={40}
                    />
                    <Button
                      onClick={addLeadStatus}
                      variant="outline"
                      className="h-9 text-xs gap-1.5 shrink-0"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add
                    </Button>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground"
                      onClick={() => setLeadStatuses([...DEFAULT_LEAD_STATUSES])}
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Reset to defaults
                    </Button>
                    <Button
                      onClick={handleSaveLeadStatuses}
                      disabled={savingStatuses}
                      className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90 border-none text-xs h-9 px-4"
                    >
                      {savingStatuses && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                      Save Statuses
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Note: changing labels here doesn&apos;t rewrite statuses already stored on existing leads. Existing values remain valid and are still shown.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB 1: CRM & SALESFORCE CONNECTOR */}
            <TabsContent value="crm" className="space-y-6 focus-visible:outline-hidden">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Salesforce Info & Settings */}
                <div className="lg:col-span-2 space-y-6">
                  <Card className="border border-border/80 shadow-xs">
                    <CardHeader className="border-b border-border/40 bg-slate-50/40 dark:bg-slate-950/20">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 bg-sky-50 dark:bg-sky-950/20 rounded-xl text-sky-600">
                            <Plug className="h-5 w-5" />
                          </div>
                          <div>
                            <CardTitle className="text-sm font-bold text-slate-800 dark:text-slate-100">Salesforce OAuth 2.0 Integration</CardTitle>
                            <CardDescription className="text-xs">Connect to Salesforce REST & Bulk APIs for background contacts fetching.</CardDescription>
                          </div>
                        </div>
                        {loadingStatus ? (
                          <Badge className="text-xs font-semibold px-2.5 py-0.5 rounded-full border border-none bg-slate-50 text-slate-500">
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            Loading...
                          </Badge>
                        ) : (
                          <Badge className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border border-none ${isConnected
                            ? "bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400"
                            : "bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400"
                            }`}>
                            {isConnected ? "CONNECTED" : "DISCONNECTED"}
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="p-5 space-y-4">

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-muted-foreground">Connected Environment</Label>
                          <div className="h-9 flex items-center px-3 rounded-md border bg-muted text-xs">
                            {isConnected
                              ? connectionStatus?.environment === "production"
                                ? "Production Instance"
                                : "Sandbox / Developer Org"
                              : "Not connected"
                            }
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-muted-foreground">Background Sync Schedule</Label>
                          <Select
                            value={String(connectionStatus?.syncInterval || 15)}
                            onValueChange={handleSyncIntervalChange}
                            disabled={!isConnected}
                          >
                            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="5">Every 5 minutes (Real-time)</SelectItem>
                              <SelectItem value="15">Every 15 minutes (Standard)</SelectItem>
                              <SelectItem value="60">Every 1 hour</SelectItem>
                              <SelectItem value="1440">Daily at Midnight</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-muted-foreground">OAuth Consumer Key (Client ID)</Label>
                          <Input
                            value={isConnected ? (connectionStatus?.clientIdMasked || "••••••••") : "Not configured"}
                            readOnly
                            disabled
                            className="bg-muted h-9 text-xs font-mono"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-muted-foreground">Last Sync</Label>
                          <div className="h-9 flex items-center gap-2 px-3 rounded-md border bg-muted text-xs">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            <span>{formatTimeAgo(connectionStatus?.lastSyncAt || null)}</span>
                            {connectionStatus?.lastSyncStatus && (
                              <Badge className={`ml-auto text-[9px] font-semibold px-1.5 py-0 border-none ${getLogStatusColor(connectionStatus.lastSyncStatus)}`}>
                                {connectionStatus.lastSyncStatus}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* SW-CRM-008: outbound write-back toggle */}
                      <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 p-4">
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">Write changes back to Salesforce</p>
                          <p className="text-[11px] text-muted-foreground leading-relaxed max-w-md">
                            When enabled, lead status changes, consent/opt-outs, and appointment bookings made in the portal are pushed back to the linked Salesforce record. Off by default.
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!isConnected}
                          onClick={() => handleWriteBackToggle(!connectionStatus?.writeBackEnabled)}
                          className={`shrink-0 h-8 text-xs font-semibold ${connectionStatus?.writeBackEnabled ? "border-emerald-300 text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}
                        >
                          {connectionStatus?.writeBackEnabled ? "Enabled" : "Disabled"}
                        </Button>
                      </div>

                      {/* Synced Leads Count */}
                      {isConnected && connectionStatus?.syncedLeadCount !== undefined && (
                        <div className="bg-sky-50/50 dark:bg-sky-950/10 p-3 rounded-lg border border-sky-100/50 dark:border-sky-900/20 flex items-center gap-3">
                          <Database className="h-4 w-4 text-sky-600" />
                          <span className="text-xs text-slate-700 dark:text-slate-300">
                            <strong className="text-sky-700 dark:text-sky-400">{connectionStatus.syncedLeadCount}</strong> leads synchronized from Salesforce
                          </span>
                        </div>
                      )}

                      <div className="flex gap-2 pt-3 border-t justify-end flex-wrap">
                        {isConnected ? (
                          <>
                            <Button
                              variant="ghost"
                              onClick={handleDisconnectSF}
                              disabled={disconnecting}
                              className="text-red-500 hover:bg-red-500/10 h-9 text-xs"
                            >
                              {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                              Disconnect CRM
                            </Button>
                            <Button
                              variant="outline"
                              onClick={handleIncrementalSync}
                              disabled={syncingIncremental || bulkIngesting}
                              className="gap-2 h-9 text-xs"
                            >
                              <RefreshCw className={`h-3.5 w-3.5 ${syncingIncremental ? "animate-spin" : ""}`} />
                              {syncingIncremental ? "Syncing..." : "Incremental Sync"}
                            </Button>
                            <Button
                              onClick={handleBulkIngest}
                              disabled={bulkIngesting || syncingIncremental}
                              className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90 gap-2 h-9 text-xs border-none"
                            >
                              <RefreshCw className={`h-3.5 w-3.5 ${bulkIngesting ? "animate-spin" : ""}`} />
                              {bulkIngesting ? "Syncing Bulk API 2.0..." : "Sync Salesforce Bulk Now"}
                            </Button>
                          </>
                        ) : (
                          <Button onClick={() => setOauthModalOpen(true)} className="bg-[#0F3B3D] text-white hover:bg-[#0F3B3D]/90 h-9 text-xs">
                            Setup Salesforce Connection
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Mapping Fields Card */}
                  <Card className="border border-border/80 shadow-xs">
                    <CardHeader>
                      <div className="flex justify-between items-center">
                        <div>
                          <CardTitle className="text-sm font-bold flex items-center gap-2">
                            <Database className="h-4.5 w-4.5 text-[#b48c3c]" />
                            Salesforce SObject Field Mapping
                          </CardTitle>
                          <CardDescription className="text-xs">Align Lead fields in the care portal database with Salesforce API field paths.</CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                          {/* SW-CRM-004: history is readable even when disconnected —
                              past mappings are exactly what you want to look at while
                              reconnecting a broken integration. */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setMappingHistoryOpen(true)}
                            className="gap-1.5 h-8 text-xs text-muted-foreground"
                          >
                            <History className="h-3.5 w-3.5" />
                            History
                          </Button>
                          {isConnected && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setAddMappingOpen(true)}
                              className="gap-1.5 h-8 text-xs"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Add Mapping
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0 overflow-x-auto">
                      {loadingMappings ? (
                        <div className="p-8 flex items-center justify-center">
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : (
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-slate-50 dark:bg-slate-900/40 border-b border-border/50">
                              <th className="py-2.5 px-4 font-semibold text-muted-foreground pl-6">Salesforce API Field</th>
                              <th className="py-2.5 px-4 font-semibold text-muted-foreground">Care Portal Field (Destination)</th>
                              <th className="py-2.5 px-4 font-semibold text-muted-foreground">Data Purpose</th>
                              <th className="py-2.5 px-4 font-semibold text-muted-foreground">Type</th>
                              {isConnected && (
                                <th className="py-2.5 px-4 font-semibold text-muted-foreground text-right pr-6">Action</th>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {mappings.map((mapping, idx) => (
                              <tr key={mapping.id || idx} className="border-b border-border/30 hover:bg-slate-50/40 dark:hover:bg-slate-900/10">
                                <td className="py-2.5 px-4 pl-6 font-mono font-bold text-slate-800 dark:text-slate-200">{mapping.salesforceField}</td>
                                <td className="py-2.5 px-4 font-mono font-bold text-[#b48c3c]">{mapping.portalField}</td>
                                <td className="py-2.5 px-4 pr-6 text-muted-foreground">{mapping.description || "—"}</td>
                                <td className="py-2.5 px-4">
                                  {mapping.isConsentField ? (
                                    <Badge className="bg-purple-50 text-purple-700 dark:bg-purple-950/20 dark:text-purple-400 text-[9px] border-none">
                                      Consent
                                    </Badge>
                                  ) : (
                                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                                      Data
                                    </Badge>
                                  )}
                                </td>
                                {isConnected && (
                                  <td className="py-2.5 px-4 text-right pr-6">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => mapping.id && handleDeleteMapping(mapping.id)}
                                      className="h-7 w-7 text-red-500 hover:bg-red-500/10"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </td>
                                )}
                              </tr>
                            ))}
                            {mappings.length === 0 && (
                              <tr>
                                <td colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                                  {isConnected
                                    ? "No field mappings configured. Click 'Add Mapping' to create one."
                                    : "Connect to Salesforce to configure field mappings."
                                  }
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Logs History Sidebar */}
                <div className="space-y-6">
                  <Card className="border border-border/80 shadow-xs">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-xs font-bold flex items-center gap-2">
                          <History className="h-4.5 w-4.5 text-[#0F3B3D]" />
                          Sync Activity Logs
                        </CardTitle>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={fetchLogs}
                          className="h-6 w-6"
                        >
                          <RefreshCw className={`h-3 w-3 ${loadingLogs ? "animate-spin" : ""}`} />
                        </Button>
                      </div>
                      <CardDescription className="text-[10px]">Real-time audit trail of sync operations.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 pt-2">
                      {loadingLogs && syncLogs.length === 0 ? (
                        <div className="p-4 flex items-center justify-center">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : syncLogs.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground text-center py-4">
                          No sync activity recorded yet.
                        </p>
                      ) : (
                        syncLogs.map((log) => (
                          <div key={log.id} className="p-2.5 border rounded-lg bg-slate-50/50 dark:bg-slate-900/10 text-[11px] space-y-1.5">
                            <div className="flex justify-between items-center">
                              <div className="flex items-center gap-1.5">
                                {log.direction === "OUTBOUND" ? (
                                  <ArrowUpFromLine className="h-3 w-3 text-blue-500" />
                                ) : (
                                  <ArrowDownToLine className="h-3 w-3 text-green-500" />
                                )}
                                <span className="font-semibold text-slate-700 dark:text-slate-300">{log.action.replace(/_/g, " ")}</span>
                              </div>
                              <Badge className={`text-[9px] font-semibold tracking-tight border-none ${getLogStatusColor(log.status)}`}>
                                {log.status}
                              </Badge>
                            </div>
                            <div className="flex justify-between text-[10px] text-muted-foreground font-medium">
                              <span>
                                {log.recordCount > 0 && (
                                  <>Ingested: <strong>{log.recordCount} leads</strong></>
                                )}
                                {log.errorCount > 0 && (
                                  <span className="text-red-500 ml-2">({log.errorCount} errors)</span>
                                )}
                              </span>
                              <span>{formatTimeAgo(log.createdAt)}</span>
                            </div>
                            {log.message && log.status !== "SUCCESS" && (
                              <p className="text-[10px] text-red-500 font-mono pt-1 border-t border-dashed leading-tight">
                                {log.message}
                              </p>
                            )}
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>
                </div>

              </div>
            </TabsContent>

            {/* TAB 2: OUTREACH & COMPLIANCE */}
            <TabsContent value="outreach" className="space-y-6 focus-visible:outline-hidden">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <Card className="border border-border/80 shadow-xs">
                <CardHeader>
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Shield className="h-4.5 w-4.5 text-[#b48c3c]" />
                    Centralized Outreach & TCPA Compliance Safeguards
                  </CardTitle>
                  <CardDescription className="text-xs">Adjust throttling limits, default voice profile parameters, and consent requirements.</CardDescription>
                </CardHeader>
                <CardContent className="p-5 space-y-6">

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="defaultOwner" className="font-semibold text-xs">Default Lead Owner Assignment</Label>
                      <Select value={defaultOwner} onValueChange={setDefaultOwner}>
                        <SelectTrigger id="defaultOwner"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Unassigned">Assign to Pool Queue</SelectItem>
                          {teamMembers.map((m) => (
                            <SelectItem key={m.id} value={m.name || m.email}>
                              {m.name || m.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="voiceProfile" className="font-semibold text-xs">AI Outreach Voice Profile (Tone)</Label>
                      <Select value={voiceProfile} onValueChange={setVoiceProfile}>
                        <SelectTrigger id="voiceProfile"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="professional">Formal & Direct (Trustworthy)</SelectItem>
                          <SelectItem value="friendly">Informal & Conversational (Friendly)</SelectItem>
                          <SelectItem value="energetic">Energetic & Promotional (Urgent)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="font-semibold text-xs block mb-2">Consent Validation Enforcement</Label>
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="checkbox"
                        id="consentEnforce"
                        checked={complianceOptInRequired}
                        onChange={(e) => setComplianceOptInRequired(e.target.checked)}
                        className="h-4 w-4 text-[#b48c3c] rounded"
                      />
                      <Label htmlFor="consentEnforce" className="text-xs cursor-pointer font-medium text-slate-700 dark:text-slate-300">
                        Block automated SMS if smsOptIn !== true
                      </Label>
                    </div>
                  </div>

                  <Separator />

                  {/* SW-ANN: tenant-configurable SMS quiet hours (no hardcoded window). */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-[#b48c3c]" />
                        <Label className="font-semibold text-xs">SMS Quiet Hours</Label>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={smsQuietHoursEnabled}
                          onChange={(e) => setSmsQuietHoursEnabled(e.target.checked)}
                          className="h-4 w-4 accent-[#b48c3c]"
                        />
                        <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                          {smsQuietHoursEnabled ? "Enforced" : "Off (send anytime)"}
                        </span>
                      </label>
                    </div>

                    {smsQuietHoursEnabled ? (
                      <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-[11px] font-medium text-muted-foreground">Send from (hour)</Label>
                          <Select value={String(quietHoursStart)} onValueChange={(v) => setQuietHoursStart(parseInt(v))}>
                            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: 24 }, (_, h) => (
                                <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}:00</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-[11px] font-medium text-muted-foreground">Send until (hour)</Label>
                          <Select value={String(quietHoursEnd)} onValueChange={(v) => setQuietHoursEnd(parseInt(v))}>
                            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: 24 }, (_, h) => (
                                <SelectItem key={h} value={String(h + 1)}>{String(h + 1).padStart(2, "0")}:00</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-[11px] font-medium text-muted-foreground">Timezone (optional)</Label>
                          <Input
                            value={quietHoursTimezone}
                            onChange={(e) => setQuietHoursTimezone(e.target.value)}
                            placeholder="e.g. America/New_York"
                            className="h-9 text-xs"
                          />
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Quiet-hours filtering is off — messages send whenever they&apos;re queued. Set the exact time yourself using the scheduled send time on each announcement/campaign. You remain responsible for TCPA compliance.
                      </p>
                    )}
                    {smsQuietHoursEnabled && (
                      <p className="text-[10px] text-muted-foreground leading-relaxed">
                        SMS outside this window are skipped. Leave the timezone blank to infer it per recipient (state / area code); set one to apply a single timezone to everyone.
                      </p>
                    )}
                  </div>

                  <div className="flex justify-end pt-4">
                    <Button
                      onClick={handleSaveOutreachSettings}
                      disabled={savingOutreach}
                      className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90 border-none text-xs h-9 px-4"
                    >
                      {savingOutreach && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                      Save Safeguards
                    </Button>
                  </div>

                </CardContent>
              </Card>

              {/* Suppression List Card */}
              <Card className="border border-border/80 shadow-xs">
                <CardHeader>
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Database className="h-4.5 w-4.5 text-red-500" />
                    Global Suppression List (Opt-Outs & Bounces)
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Manually add or remove phone numbers (E.164) and email addresses from receiving any outbound campaigns or alerts.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-5 space-y-4">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add email or phone number to suppress..."
                      value={newSuppressValue}
                      onChange={(e) => setNewSuppressValue(e.target.value)}
                      className="h-9 text-xs"
                    />
                    <Select value={newSuppressReason} onValueChange={setNewSuppressReason}>
                      <SelectTrigger className="w-40 h-9 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="UNSUBSCRIBE">Unsubscribed</SelectItem>
                        <SelectItem value="BOUNCE">Bounced Email</SelectItem>
                        <SelectItem value="COMPLAINT">Spam Complaint</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={handleAddSuppression}
                      disabled={addingSuppression}
                      className="bg-red-600 hover:bg-red-700 text-white text-xs h-9 px-3 shrink-0"
                    >
                      {addingSuppression ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
                      Suppress
                    </Button>
                  </div>

                  <div className="flex justify-between items-center pt-2">
                    <Input
                      placeholder="Filter suppression list..."
                      value={suppressionSearch}
                      onChange={(e) => {
                        setSuppressionSearch(e.target.value);
                        fetchSuppressionList(1, e.target.value);
                      }}
                      className="h-8 text-xs max-w-xs"
                    />
                  </div>

                  <div className="border border-border/40 rounded-lg overflow-hidden">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-900/40 border-b border-border/40">
                          <th className="py-2 px-3 font-semibold text-muted-foreground pl-4">Suppressed Contact</th>
                          <th className="py-2 px-3 font-semibold text-muted-foreground">Reason</th>
                          <th className="py-2 px-3 font-semibold text-muted-foreground">Suppressed Date</th>
                          <th className="py-2 px-3 font-semibold text-muted-foreground text-right pr-4">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loadingSuppression ? (
                          <tr>
                            <td colSpan={4} className="py-8 text-center text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1" />
                              Loading list...
                            </td>
                          </tr>
                        ) : suppressionList.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-8 text-center text-muted-foreground">
                              No suppressed contacts found.
                            </td>
                          </tr>
                        ) : (
                          suppressionList.map((item) => (
                            <tr key={item.id} className="border-b border-border/30 hover:bg-slate-50/20 dark:hover:bg-slate-900/10">
                              <td className="py-2 px-3 pl-4 font-medium text-slate-800 dark:text-slate-200">{item.value}</td>
                              <td className="py-2 px-3">
                                <Badge
                                  variant="secondary"
                                  className={`text-[9px] font-semibold px-2 py-0.5 ${item.reason === "BOUNCE"
                                      ? "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/20 dark:text-amber-300"
                                      : item.reason === "COMPLAINT"
                                        ? "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/20 dark:text-red-300"
                                        : "bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-300"
                                    }`}
                                >
                                  {item.reason}
                                </Badge>
                              </td>
                              <td className="py-2 px-3 text-muted-foreground font-mono text-[10px]">
                                {new Date(item.createdAt).toLocaleDateString()} {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </td>
                              <td className="py-2 px-3 text-right pr-4">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDeleteSuppression(item.id)}
                                  className="h-6 w-6 text-red-500 hover:bg-red-500/10"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {suppressionTotalPages > 1 && (
                    <div className="flex justify-end items-center gap-2 pt-2 text-xs">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={suppressionPage === 1 || loadingSuppression}
                        onClick={() => fetchSuppressionList(suppressionPage - 1, suppressionSearch)}
                        className="h-7 text-[11px]"
                      >
                        Previous
                      </Button>
                      <span className="text-muted-foreground font-mono">
                        Page {suppressionPage} of {suppressionTotalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={suppressionPage === suppressionTotalPages || loadingSuppression}
                        onClick={() => fetchSuppressionList(suppressionPage + 1, suppressionSearch)}
                        className="h-7 text-[11px]"
                      >
                        Next
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
              </div>
            </TabsContent>

          </Tabs>
        </motion.div>

        {/* Salesforce Connection Settings Modal */}
        <Dialog open={oauthModalOpen} onOpenChange={setOauthModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sky-600">
                <Key className="h-5 w-5" />
                Salesforce OAuth credentials
              </DialogTitle>
              <DialogDescription>
                Input your Salesforce Connected App details to acquire bearer session tokens.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="sfEnvSelect" className="font-semibold text-xs">Environment Type</Label>
                <Select value={sfEnvironment} onValueChange={(val) => setSfEnvironment(val as "production" | "sandbox")}>
                  <SelectTrigger id="sfEnvSelect" className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="production">Production Instance (login.salesforce.com)</SelectItem>
                    <SelectItem value="sandbox">Sandbox Org (test.salesforce.com)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="clientIdForm" className="font-semibold text-xs">Consumer Key (Client ID) *</Label>
                <Input
                  id="clientIdForm"
                  placeholder="Enter Salesforce consumer key..."
                  value={sfClientId}
                  onChange={(e) => setSfClientId(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="clientSecretForm" className="font-semibold text-xs">Consumer Secret *</Label>
                <Input
                  id="clientSecretForm"
                  type="password"
                  placeholder="Enter consumer secret..."
                  value={sfClientSecret}
                  onChange={(e) => setSfClientSecret(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              {connecting && (
                <div className="p-4 bg-slate-50 dark:bg-slate-900 border rounded-xl flex items-center justify-center gap-3">
                  <Loader2 className="h-4 w-4 animate-spin text-[#b48c3c]" />
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Redirecting to Salesforce OAuth 2.0 Login...</span>
                </div>
              )}

              <div className="bg-sky-50 dark:bg-sky-950/20 p-3 rounded-lg border border-sky-100/50 text-[11px] text-slate-600 dark:text-slate-400 space-y-1.5">
                <p className="font-semibold flex items-center gap-1.5">
                  <ExternalLink className="h-3 w-3" />
                  OAuth Redirect URI
                </p>
                <div className="flex items-stretch gap-1.5">
                  <code className="flex-1 min-w-0 truncate text-[10px] font-mono bg-white dark:bg-slate-900 px-2 py-1.5 rounded border text-sky-700 dark:text-sky-400">
                    {redirectUri}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={copyRedirectUri}
                    className="h-auto shrink-0 px-2 text-[10px] font-semibold gap-1"
                    title="Copy redirect URI"
                  >
                    {copiedRedirect ? (
                      <><Check className="h-3 w-3 text-emerald-600" /> Copied</>
                    ) : (
                      <><Copy className="h-3 w-3" /> Copy</>
                    )}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Add this URI <strong>exactly</strong> (no trailing slash) to your Salesforce Connected App&apos;s Callback URLs.
                </p>
                <div className="flex items-start gap-1.5 pt-1.5 mt-1 border-t border-sky-100/60 dark:border-sky-900/40 text-[10px] text-amber-700 dark:text-amber-400">
                  <AlertCircle className="h-3 w-3 mt-px shrink-0" />
                  <span>
                    The Connected App must live in your{" "}
                    <strong>{sfEnvironment === "production" ? "Production" : "Sandbox"}</strong>{" "}
                    org — matching the environment selected above (
                    <span className="font-mono">
                      {sfEnvironment === "production" ? "login.salesforce.com" : "test.salesforce.com"}
                    </span>
                    ). PKCE is supported, so you can safely keep &ldquo;Require Proof Key for Code Exchange&rdquo; enabled.
                  </span>
                </div>
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setOauthModalOpen(false)} disabled={connecting}>Cancel</Button>
              <Button onClick={handleConnectSF} disabled={connecting || !sfClientId.trim() || !sfClientSecret.trim()} className="bg-sky-600 text-white hover:bg-sky-700 border-none">
                {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                Connect CRM
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* SW-CRM-004: mapping version history + rollback */}
        <MappingHistoryDialog
          open={mappingHistoryOpen}
          onOpenChange={setMappingHistoryOpen}
          onRolledBack={fetchMappings}
        />

        {/* Add Field Mapping Modal */}
        <Dialog open={addMappingOpen} onOpenChange={setAddMappingOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Database className="h-5 w-5 text-[#b48c3c]" />
                Add Field Mapping
              </DialogTitle>
              <DialogDescription>
                Map a Salesforce SObject field to a portal Lead field.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="font-semibold text-xs">Salesforce API Field Name *</Label>
                <Input
                  placeholder="e.g. Company, Title, LeadSource"
                  value={newSfField}
                  onChange={(e) => setNewSfField(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="font-semibold text-xs">Portal Destination Field *</Label>
                <Input
                  placeholder="e.g. company, title, customFields.leadSource"
                  value={newPortalField}
                  onChange={(e) => setNewPortalField(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="font-semibold text-xs">Description</Label>
                <Input
                  placeholder="What this mapping does..."
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="consentMapping"
                  checked={newIsConsent}
                  onChange={(e) => setNewIsConsent(e.target.checked)}
                  className="h-4 w-4 rounded"
                />
                <Label htmlFor="consentMapping" className="text-xs cursor-pointer font-medium">
                  This is a consent/opt-in field
                </Label>
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button variant="ghost" onClick={() => setAddMappingOpen(false)}>Cancel</Button>
              <Button
                onClick={handleAddMapping}
                disabled={savingMapping || !newSfField.trim() || !newPortalField.trim()}
                className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90 border-none"
              >
                {savingMapping ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                Save Mapping
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </PortalLayout>
    </ProtectedRoute>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-slate-900/50">
        <Loader2 className="w-8 h-8 animate-spin text-[#b48c3c]" />
      </div>
    }>
      <SettingsPageContent />
    </Suspense>
  );
}
