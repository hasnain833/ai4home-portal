"use client";

import { useState, useEffect, useMemo } from "react";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { fetchKey, QUERY_KEYS } from "@/lib/use-query";
import { useMessagingCapabilities, NOT_CONFIGURED_HINT } from "@/lib/use-messaging-capabilities";
import { DEFAULT_LEAD_STATUSES, statusColor } from "@/lib/lead-statuses";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
  Plus,
  Mail,
  MessageSquare,
  CheckCircle,
  Play,
  Users,
  Trash2,
  Clock,
  Pencil,
  Layers,
  Activity,
  Sparkles,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

const DEFAULT_EMAIL_SUBJECT = "Checking in from {companyName}";
const DEFAULT_EMAIL_BODY = `Hi {firstName},

I wanted to check in from {companyName} about our "{campaignName}" campaign.

If you have questions or would like to talk through next steps, you can book a time here: {bookingLink}

Best,
The {companyName} Team`;

const DEFAULT_SMS_BODY = "Hi {firstName}, just checking in from {companyName} about {campaignName}. Let me know if you need anything! Reply STOP to unsubscribe.";
const CAMPAIGN_EXCLUDED_STATUSES = new Set(["Closed Won", "Unsubscribed"]);

type EnrollableLead = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  status?: string | null;
  tags?: string[];
};

const isEnrollableLead = (lead: unknown): lead is EnrollableLead => {
  return typeof lead === "object" && lead !== null && typeof (lead as { id?: unknown }).id === "string";
};

const buildDefaultEmailStep = () => ({
  type: "EMAIL",
  subject: DEFAULT_EMAIL_SUBJECT,
  body: DEFAULT_EMAIL_BODY,
  delayValue: "",
  delayUnit: "DAYS",
});

export default function CampaignsPage() {
  const { emailConfigured, smsConfigured } = useMessagingCapabilities();

  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [activeSeq, setActiveSeq] = useState<any>(null);
  const [activeSeqDetail, setActiveSeqDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Modals state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newSeqName, setNewSeqName] = useState("New Campaign");
  const [seqToDelete, setSeqToDelete] = useState<any>(null);
  const [addStepModalOpen, setAddStepModalOpen] = useState(false);
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);
  const [newStep, setNewStep] = useState<any>(buildDefaultEmailStep());
  const [generatingStepCopy, setGeneratingStepCopy] = useState(false);
  const [aiReady, setAiReady] = useState(false);

  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [leadsForEnroll, setLeadsForEnroll] = useState<EnrollableLead[]>([]);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [tagFilter, setTagFilter] = useState("ALL");

  // Segment-based enrollment (SW-NUR-002)
  const [segments, setSegments] = useState<any[]>([]);
  const [enrollMode, setEnrollMode] = useState<"leads" | "segment">("leads");
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>("");
  const [enrolling, setEnrolling] = useState(false);

  const enrollLeadTags = useMemo(() => {
    const tags = new Set<string>();
    leadsForEnroll.forEach((lead) => lead.tags?.forEach((tag) => tags.add(tag)));
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }, [leadsForEnroll]);

  const fetchCampaigns = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sales/campaigns");
      if (res.ok) {
        const data = await res.json();
        setCampaigns(data);
        if (data.length > 0 && !activeSeq) {
          setActiveSeq(data[0]);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCampaigns();
  }, []);

  // The AI drafting button is useless without a configured provider, so find out
  // up front rather than letting the request fail.
  useEffect(() => {
    const checkAi = async () => {
      try {
        const res = await fetch("/api/company", { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        const ready =
          data.aiProvider === "platform"
            ? !!data.aiPlatformGrant
            : data.aiProvider === "openai"
              ? !!data.aiOpenAiKeyMasked
              : data.aiProvider === "groq"
                ? !!data.aiGroqKeyMasked
                : !!data.aiAnthropicKeyMasked;
        setAiReady(ready);
      } catch {
        /* leave AI disabled if we can't tell */
      }
    };
    checkAi();
  }, []);

  useEffect(() => {
    if (!activeSeq) return;
    const fetchDetail = async () => {
      setLoadingDetail(true);
      try {
        const res = await fetch(`/api/sales/campaigns/${activeSeq.id}`);
        if (res.ok) {
          const detail = await res.json();
          setActiveSeqDetail(detail);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingDetail(false);
      }
    };
    fetchDetail();
  }, [activeSeq]);

  // Polling for real-time updates when a campaign is Active or Paused
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (activeSeq && (activeSeq.status === "Active" || activeSeq.status === "Paused")) {
      interval = setInterval(() => {
        fetch(`/api/sales/campaigns/${activeSeq.id}`)
          .then(res => res.json())
          .then(detail => {
            setActiveSeqDetail(detail);
            // If the campaign finished, update main state too
            if (detail.status !== activeSeq.status) {
              setActiveSeq((prev: any) => ({ ...prev, status: detail.status }));
              fetchCampaigns();
            }
          })
          .catch(err => console.error("Error polling campaign detail:", err));
      }, 3000); // Poll every 3 seconds for fast real-time feedback
    }
    return () => clearInterval(interval);
  }, [activeSeq]);

  const confirmCreateCampaign = async () => {
    if (!newSeqName) return;
    try {
      const res = await fetch("/api/sales/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newSeqName, channel: "Email & SMS" })
      });
      if (res.ok) {
        setCreateModalOpen(false);
        setNewSeqName("");
        fetchCampaigns();
        toast.success("Campaign created successfully.");
      } else {
        toast.error("Failed to create campaign.");
      }
    } catch (error) {
      console.error("[sales/campaigns]", error);
      toast.error("Error creating campaign.");
    }
  };

  const confirmDeleteCampaign = async () => {
    if (!seqToDelete) return;
    try {
      const res = await fetch(`/api/sales/campaigns/${seqToDelete.id}`, { method: "DELETE" });
      if (res.ok) {
        setSeqToDelete(null);
        if (activeSeq?.id === seqToDelete.id) setActiveSeq(null);
        fetchCampaigns();
        toast.success("Campaign deleted.");
      } else {
        toast.error("Failed to delete campaign.");
      }
    } catch (error) {
      console.error("[sales/campaigns]", error);
      toast.error("Error deleting campaign.");
    }
  };

  const confirmAddStep = async () => {
    if (!activeSeq || !activeSeqDetail) return;

    const newSteps = [...(activeSeqDetail.steps || [])];
    if (editingStepIndex !== null) {
      newSteps[editingStepIndex] = { ...newSteps[editingStepIndex], ...newStep };
    } else {
      newSteps.push(newStep);
    }

    try {
      const res = await fetch(`/api/sales/campaigns/${activeSeq.id}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steps: newSteps })
      });
      if (res.ok) {
        const saved = await res.json().catch(() => ({}));
        setAddStepModalOpen(false);
        setEditingStepIndex(null);
        setNewStep(buildDefaultEmailStep());
        // Refetch campaign detail and list to update steps count
        const resDetail = await fetch(`/api/sales/campaigns/${activeSeq.id}`);
        if (resDetail.ok) {
          setActiveSeqDetail(await resDetail.json());
        }
        fetchCampaigns();
        toast.success(editingStepIndex !== null ? "Step updated successfully." : "Step added successfully.");
        // Saving is never blocked — a tenant can draft SMS steps before Twilio
        // exists — but they are told the step will not be delivered.
        for (const w of saved.warnings || []) toast.warning(w, { duration: 8000 });
      } else {
        toast.error("Failed to save step.");
      }
    } catch (error) {
      console.error("[sales/campaigns]", error);
      toast.error("Error saving step.");
    }
  };

  const generateStepCopy = async () => {
    if (!activeSeq || newStep.type === "DELAY") return;

    setGeneratingStepCopy(true);
    try {
      const res = await fetch("/api/sales/campaigns/generate-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: `Write a ${newStep.type === "SMS" ? "short SMS" : "nurture email"} for the campaign named "${activeSeq.name}".`,
          audience: "Sales leads, homebuyers, and existing homeowner prospects",
          stepType: newStep.type,
          contextInfo: [
            `Campaign name: ${activeSeq.name}`,
            activeSeq.description ? `Campaign description: ${activeSeq.description}` : null,
            newStep.body ? `Current draft to improve: ${newStep.body}` : null,
          ].filter(Boolean).join("\n"),
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(data?.message || "Failed to generate AI copy.");
        return;
      }

      setNewStep((prev: any) => ({
        ...prev,
        subject: prev.type === "EMAIL" ? (data.subject || prev.subject) : prev.subject,
        body: data.body || data.draft || prev.body,
      }));
      toast.success("AI copy generated.");
    } catch (error) {
      console.error("[sales/campaigns] generate copy", error);
      toast.error("Error generating AI copy.");
    } finally {
      setGeneratingStepCopy(false);
    }
  };

  const deleteStep = async (indexToRemove: number) => {
    if (!activeSeq || !activeSeqDetail) return;
    const newSteps = activeSeqDetail.steps.filter((_: any, i: number) => i !== indexToRemove);
    try {
      const res = await fetch(`/api/sales/campaigns/${activeSeq.id}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steps: newSteps })
      });
      if (res.ok) {
        const resDetail = await fetch(`/api/sales/campaigns/${activeSeq.id}`);
        if (resDetail.ok) setActiveSeqDetail(await resDetail.json());
        fetchCampaigns();
        toast.success("Step deleted.");
      } else {
        toast.error("Failed to delete step.");
      }
    } catch (e) {
      console.error("[sales/campaigns]", e);
      toast.error("Error deleting step.");
    }
  };

  const openEditStep = (step: any, index: number) => {
    setEditingStepIndex(index);
    setNewStep({
      type: step.type,
      subject: step.subject || "",
      body: step.body || "",
      delayValue: step.delayValue || "",
      delayUnit: step.delayUnit || "DAYS"
    });
    setAddStepModalOpen(true);
  };

  const launchCampaign = async () => {
    if (!activeSeq) return;
    try {
      const res = await fetch(`/api/sales/campaigns/${activeSeq.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Active" })
      });
      if (res.ok) {
        fetchCampaigns();
        setActiveSeq({ ...activeSeq, status: "Active" });
        toast.success("Campaign launched.");
      } else {
        toast.error("Failed to launch campaign.");
      }
    } catch (e) {
      console.error("[sales/campaigns]", e);
      toast.error("Error launching campaign.");
    }
  };


  const pauseCampaign = async () => {
    if (!activeSeq) return;
    try {
      const res = await fetch(`/api/sales/campaigns/${activeSeq.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Paused" })
      });
      if (res.ok) {
        fetchCampaigns();
        setActiveSeq({ ...activeSeq, status: "Paused" });
        toast.success("Campaign paused.");
      } else {
        toast.error("Failed to pause campaign.");
      }
    } catch (e) {
      console.error("[sales/campaigns]", e);
      toast.error("Error pausing campaign.");
    }
  };

  const openEnrollModal = async () => {
    setEnrollModalOpen(true);
    setEnrollMode("leads");
    setSelectedSegmentId("");
    setSearchQuery("");
    setStatusFilter("ALL");
    setTagFilter("ALL");
    setLoadingLeads(true);
    try {
      // NFR-P-001: concurrent, and the segment list comes from the cache shared
      // with the leads and announcements pages.
      const [leadsResult, segResult] = await Promise.allSettled([
        fetchKey<unknown[] | { leads?: unknown[] }>("/api/sales/leads?pageSize=200"),
        fetchKey<unknown[] | { segments?: unknown[] }>(QUERY_KEYS.segments),
      ]);
      if (leadsResult.status === "fulfilled") {
        const data = leadsResult.value;
        const allLeads = Array.isArray(data) ? data : data?.leads || [];
        setLeadsForEnroll(
          allLeads
            .filter(isEnrollableLead)
            .filter((lead) => !CAMPAIGN_EXCLUDED_STATUSES.has(String(lead.status || "")))
        );
      }
      if (segResult.status === "fulfilled") {
        const s = segResult.value;
        setSegments(Array.isArray(s) ? s : s?.segments || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingLeads(false);
    }
  };

  const confirmEnroll = async () => {
    if (!activeSeq) return;
    if (enrollMode === "segment" && !selectedSegmentId) {
      toast.error("Select a segment to enroll.");
      return;
    }
    if (enrollMode === "leads" && selectedLeadIds.length === 0) return;

    const payload = enrollMode === "segment"
      ? { segmentId: selectedSegmentId }
      : { leadIds: selectedLeadIds };

    setEnrolling(true);
    try {
      const res = await fetch(`/api/sales/campaigns/${activeSeq.id}/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const r = await res.json().catch(() => ({}));
        setEnrollModalOpen(false);
        setSelectedLeadIds([]);
        setSelectedSegmentId("");
        const enrolled = r.enrolledCount ?? 0;
        const skipped = r.skippedDuplicatesCount ?? 0;
        toast.success(`Enrolled ${enrolled} lead${enrolled === 1 ? "" : "s"}${skipped ? ` (${skipped} already enrolled, skipped)` : ""}.`);
        // The campaign may contain steps on a channel this workspace cannot send.
        for (const w of r.warnings || []) toast.warning(w, { duration: 8000 });
        fetchCampaigns();
        const rd = await fetch(`/api/sales/campaigns/${activeSeq.id}`);
        if (rd.ok) setActiveSeqDetail(await rd.json());
      } else {
        toast.error("Failed to enroll leads.");
      }
    } catch (e) {
      console.error("[sales/campaigns]", e);
      toast.error("Error enrolling leads.");
    } finally {
      setEnrolling(false);
    }
  };

  return (
    <ProtectedRoute allowedRoles={["admin", "staff"]}>
      <PortalLayout workspace="sales">
        <div className="space-y-6 max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
                Nurture Campaigns
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                Design multi-step email and SMS workflows to nurture builder leads.
              </p>
            </div>
            <Button onClick={() => setCreateModalOpen(true)} className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90 gap-2 h-9 border-none">
              <Plus className="h-4 w-4" /> Create Campaign
            </Button>
          </div>

          {(!emailConfigured || !smsConfigured) && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong>
                  {!emailConfigured && !smsConfigured
                    ? "Email and SMS are not configured."
                    : !smsConfigured
                      ? "SMS is not configured."
                      : "Email is not configured."}
                </strong>{" "}
                Steps on that channel will not be delivered. Set it up in{" "}
                <a href="/sales/settings" className="font-semibold underline underline-offset-2">
                  Settings &rarr; Messaging
                </a>
                .
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Panel: List of Campaigns */}
            <div className="space-y-4">
              {campaigns.length === 0 && !loading && (
                <p className="text-muted-foreground text-sm py-4">No campaigns found. Create one to get started.</p>
              )}
              {campaigns.map((seq) => (
                <Card
                  key={seq.id}
                  onClick={() => setActiveSeq(seq)}
                  className={`cursor-pointer transition-all duration-300 relative overflow-hidden group ${activeSeq?.id === seq.id
                    ? "border-[#b48c3c] bg-white dark:bg-slate-900 shadow-md ring-1 ring-[#b48c3c]/30"
                    : "hover:border-[#b48c3c]/50 hover:shadow-sm bg-slate-50/50 dark:bg-slate-800/20 hover:bg-white dark:hover:bg-slate-800/80"
                    }`}
                >
                  <div className={`absolute left-0 top-0 bottom-0 w-1 transition-colors duration-300 ${activeSeq?.id === seq.id ? "bg-[#b48c3c]" : "bg-transparent group-hover:bg-[#b48c3c]/40"}`} />
                  <CardHeader className="p-4 pb-2">
                    <div className="flex justify-between items-center w-full gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <CardTitle className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">
                          {seq.name}
                        </CardTitle>
                        <Badge className={`text-[10px] px-1.5 py-0 font-semibold ${seq.status === "Active" ? "bg-green-50 text-green-700 border-green-200/50 dark:bg-green-950/20 dark:text-green-400" :
                          seq.status === "Completed" ? "bg-emerald-100 text-emerald-800 border-emerald-300/50 dark:bg-emerald-900/30 dark:text-emerald-300" :
                            seq.status === "Ready" ? "bg-blue-50 text-blue-700 border-blue-200/50 dark:bg-blue-950/20 dark:text-blue-400" :
                              seq.status === "Paused" ? "bg-orange-50 text-orange-700 border-orange-200/50 dark:bg-orange-950/20 dark:text-orange-400" :
                                "bg-gray-100 text-gray-700 dark:bg-gray-800"
                          }`}>
                          {seq.status === "Completed" ? (
                            <span className="inline-flex items-center gap-0.5"><CheckCircle className="h-2.5 w-2.5" /> Completed</span>
                          ) : seq.status}
                        </Badge>
                      </div>
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSeqToDelete(seq); }} className="h-6 w-6 p-0 text-slate-400 hover:text-red-500 hover:bg-red-50 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 text-xs text-muted-foreground space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="flex items-center gap-1.5"><Layers className="h-3.5 w-3.5 text-slate-400" /> {seq.stepsCount} Steps</span>
                      <span className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full font-medium">{seq.channel}</span>
                    </div>
                    <div className="flex justify-between items-center border-t border-slate-100 dark:border-slate-800/50 pt-3">
                      <span className="flex items-center gap-1.5 text-slate-500"><Users className="h-3.5 w-3.5" /> {seq.totalLeads || 0} Enrolled</span>
                      <span className="text-[#b48c3c] font-bold bg-[#b48c3c]/10 px-2 py-0.5 rounded-full">{seq.conversionRate} conv</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Right Panel: Active Campaign Detail View */}
            <div className="lg:col-span-2 space-y-6">
              {activeSeq ? (
                <Card className="border border-border/80">
                  <CardHeader className="border-b border-border/50 bg-slate-50/50 dark:bg-slate-900/40 p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                      <CardTitle className="text-lg font-bold text-slate-800 dark:text-slate-100">{activeSeq.name}</CardTitle>
                      <CardDescription className="text-xs mt-1">Multi-step drip campaign flow settings.</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      {activeSeq.status === "Completed" ? (
                        // A completed campaign is terminal — no re-enroll / re-launch.
                        <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/40">
                          <CheckCircle className="h-3.5 w-3.5" /> Completed
                        </span>
                      ) : (
                        <>
                          <Button variant="outline" size="sm" className="h-8 text-xs font-semibold" onClick={openEnrollModal}>
                            <Users className="h-3.5 w-3.5 mr-1" /> Enroll Leads
                          </Button>

                          {activeSeq.status !== "Active" ? (
                            <Button size="sm" className="bg-green-600 text-white hover:bg-green-700 h-8 text-xs font-semibold" onClick={launchCampaign} disabled={activeSeq.status === "Draft"}>
                              <Play className="h-3.5 w-3.5 mr-1" /> {activeSeq.status === "Paused" ? "Resume" : "Launch"}
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" className="h-8 text-xs font-semibold text-orange-600 hover:text-orange-700 hover:bg-orange-50 border-orange-200" onClick={pauseCampaign}>
                              <Clock className="h-3.5 w-3.5 mr-1" /> Pause
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="p-6">
                    {/* Drip Step Workflow Visualizer */}
                    <div className="space-y-6 relative border-l-2 border-dashed border-[#b48c3c]/30 ml-4 pl-8">
                      {loadingDetail ? (
                        <div className="p-8 text-center text-muted-foreground animate-pulse text-sm">
                          Loading steps...
                        </div>
                      ) : activeSeqDetail?.steps?.length > 0 ? (
                        activeSeqDetail.steps.map((step: any, index: number) => {
                          const isRunning = activeSeq.status === "Active" || activeSeq.status === "Paused" || activeSeq.status === "Completed";
                          const totalEnrollments = activeSeqDetail?.enrollments?.length || 0;
                          // currentStepPosition is the next step to run, so a step counts
                          // as done only once the pointer has moved past it.
                          const completedCount = activeSeqDetail?.enrollments?.filter((e: any) => e.currentStepPosition > step.position).length || 0;
                          const isFullyCompleted = isRunning && totalEnrollments > 0 && completedCount === totalEnrollments;

                          return (
                            <div key={step.id} className="relative">
                              <span className={`absolute -left-11.25 top-1.5 z-10 h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold ring-4 ring-white dark:ring-slate-900 ${isFullyCompleted ? "bg-green-500 text-white" : "bg-[#b48c3c] text-white"}`}>
                                {isFullyCompleted ? <CheckCircle className="h-4 w-4" /> : index + 1}
                              </span>
                              <div className={`relative p-5 border rounded-xl max-w-xl group transition-all duration-300 hover:shadow-md ${isFullyCompleted ? "bg-linear-to-br from-green-50/50 to-white border-green-200 dark:from-green-950/20 dark:to-slate-900" : "bg-linear-to-br from-white to-slate-50 border-slate-200 shadow-sm dark:from-slate-900 dark:to-slate-900/50"}`}>
                                <div className="flex justify-between items-center mb-3">
                                  <span className="text-sm font-bold flex items-center gap-2 text-slate-800 dark:text-slate-200">
                                    <div className={`p-1.5 rounded-md ${step.type === "EMAIL" ? "bg-[#b48c3c]/10" : step.type === "SMS" ? "bg-cyan-100 dark:bg-cyan-900/30" : "bg-slate-100 dark:bg-slate-800"}`}>
                                      {step.type === "EMAIL" ? <Mail className="h-4 w-4 text-[#b48c3c]" /> : step.type === "SMS" ? <MessageSquare className="h-4 w-4 text-cyan-600" /> : <Clock className="h-4 w-4 text-slate-500" />}
                                    </div>
                                    {step.type === "DELAY" ? "Wait Condition" : `${step.type === "EMAIL" ? `Email: "${step.subject || "No Subject"}"` : "SMS"}`}
                                    {((step.type === "SMS" && !smsConfigured) ||
                                      (step.type === "EMAIL" && !emailConfigured)) && (
                                      <Badge
                                        variant="outline"
                                        title={NOT_CONFIGURED_HINT}
                                        className="text-[9px] px-1.5 py-0 gap-1 border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
                                        <AlertTriangle className="h-2.5 w-2.5" /> will not send
                                      </Badge>
                                    )}
                                  </span>
                                  <div className="flex items-center gap-3">
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-slate-400 hover:text-[#b48c3c] hover:bg-[#b48c3c]/10 rounded-full" onClick={() => openEditStep(step, index)}>
                                        <Pencil className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full" onClick={() => deleteStep(index)}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                    <Badge variant="secondary" className="text-[10px] bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 font-semibold px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700 shadow-sm">
                                      {step.delayValue ? `${step.delayValue} ${step.delayUnit || "Days"}` : "Immediate"}
                                    </Badge>
                                  </div>
                                </div>
                                {step.body && (
                                  <div className="bg-slate-50 dark:bg-slate-950/30 p-3 rounded-lg border border-slate-100 dark:border-slate-800/50">
                                    <p className="text-[12px] text-slate-600 dark:text-slate-400 leading-relaxed whitespace-pre-line">
                                      {step.body}
                                    </p>
                                  </div>
                                )}
                                {isRunning && totalEnrollments > 0 && (
                                  <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/60 flex justify-between items-center text-[11px] font-semibold text-slate-500">
                                    <span className="flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" /> Progress Status</span>
                                    <span className={`px-2 py-0.5 rounded-full ${isFullyCompleted ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"}`}>
                                      {completedCount} / {totalEnrollments} Leads Completed
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-center py-10 text-muted-foreground text-sm border border-dashed rounded-lg">
                          No steps configured for this campaign.
                        </div>
                      )}
                    </div>
                    <div className="mt-8 pt-4 border-t border-border/50 flex justify-center ml-4 pl-8">
                      <Button onClick={() => { setEditingStepIndex(null); setNewStep(buildDefaultEmailStep()); setAddStepModalOpen(true); }} variant="outline" size="sm" className="border-dashed hover:border-[#b48c3c] hover:text-[#b48c3c] text-muted-foreground w-full max-w-xl text-xs h-10">
                        <Plus className="h-4 w-4 mr-2" /> Add Step
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </div>
        </div>

        {/* Create Campaign Dialog */}
        <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create New Campaign</DialogTitle>
              <DialogDescription>
                Enter a name for your new campaign. You can configure the steps later.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Input
                value={newSeqName}
                onChange={(e) => setNewSeqName(e.target.value)}
                placeholder="Campaign Name"
                className="w-full"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && confirmCreateCampaign()}
              />
            </div>
            <DialogFooter className="sm:justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateModalOpen(false)}>
                Cancel
              </Button>
              <Button className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" onClick={confirmCreateCampaign}>
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={!!seqToDelete} onOpenChange={(open) => !open && setSeqToDelete(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete Campaign</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete the "{seqToDelete?.name}" campaign? This will also stop all active lead enrollments on this campaign. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="sm:justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setSeqToDelete(null)}>
                Cancel
              </Button>
              <Button variant="destructive" className="bg-red-500 hover:bg-red-600 text-white" onClick={confirmDeleteCampaign}>
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add Step Dialog */}
        <Dialog open={addStepModalOpen} onOpenChange={setAddStepModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editingStepIndex !== null ? "Edit Step" : "Add Step to Flow"}</DialogTitle>
              <DialogDescription>
                {editingStepIndex !== null ? "Modify the properties of this step." : "Configure the message type, content, and delay for this step."}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div className="space-y-2">
                <Label>Step Type</Label>
                <Select value={newStep.type} onValueChange={(val) => {
                  let defaultBody = newStep.body;
                  let defaultSubject = newStep.subject;
                  if (val === "SMS" && !defaultBody) {
                    defaultBody = DEFAULT_SMS_BODY;
                  }
                  if (val === "EMAIL") {
                    if (!defaultBody) defaultBody = DEFAULT_EMAIL_BODY;
                    if (!defaultSubject) defaultSubject = DEFAULT_EMAIL_SUBJECT;
                  }
                  setNewStep({ ...newStep, type: val, subject: defaultSubject, body: defaultBody });
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EMAIL" disabled={!emailConfigured}>
                      {emailConfigured ? "Email" : "Email — not configured"}
                    </SelectItem>
                    <SelectItem value="SMS" disabled={!smsConfigured}>
                      {smsConfigured ? "SMS" : "SMS — not configured"}
                    </SelectItem>
                    <SelectItem value="DELAY">Wait Condition</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {newStep.type === "DELAY" ? (
                <div className="flex gap-2">
                  <div className="space-y-2 flex-1">
                    <Label>Delay Value</Label>
                    <Input type="number" value={newStep.delayValue} onChange={(e) => setNewStep({ ...newStep, delayValue: e.target.value })} placeholder="e.g. 3" />
                  </div>
                  <div className="space-y-2 flex-1">
                    <Label>Unit</Label>
                    <Select value={newStep.delayUnit} onValueChange={(val) => setNewStep({ ...newStep, delayUnit: val })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MINUTES">Minutes</SelectItem>
                        <SelectItem value="HOURS">Hours</SelectItem>
                        <SelectItem value="DAYS">Days</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : (
                <>
                  {newStep.type === "EMAIL" && (
                    <div className="space-y-2">
                      <Label>Subject</Label>
                      <Input value={newStep.subject} onChange={(e) => setNewStep({ ...newStep, subject: e.target.value })} placeholder="Email Subject" />
                    </div>
                  )}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label>Message Body</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 border-[#b48c3c]/40 text-[#b48c3c] hover:bg-[#b48c3c]/10 hover:text-[#b48c3c]"
                        onClick={generateStepCopy}
                        disabled={generatingStepCopy || !activeSeq || !aiReady}
                        title={
                          aiReady
                            ? `Generate ${newStep.type === "SMS" ? "SMS" : "email"} copy with AI`
                            : "Add an AI provider key in Settings > AI Config to use AI drafting"
                        }
                      >
                        <Sparkles className={`h-4 w-4 ${generatingStepCopy ? "animate-pulse" : ""}`} />
                      </Button>
                    </div>
                    {!aiReady && (
                      <p className="text-[11px] text-amber-700 dark:text-amber-500 leading-relaxed">
                        AI drafting is off &mdash; no provider key is set for this workspace. Add one in
                        Settings &gt; AI Config, or ask your administrator to grant the platform key.
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Merge tags: <code>{`{firstName}`}</code>, <code>{`{lastName}`}</code>, <code>{`{companyName}`}</code>, <code>{`{campaignName}`}</code>, <code>{`{city}`}</code>, <code>{`{bookingLink}`}</code>. Configure AI provider in Settings &gt; AI Config.
                    </p>
                    <textarea
                      className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-25"
                      value={newStep.body}
                      onChange={(e) => setNewStep({ ...newStep, body: e.target.value })}
                      placeholder={`Enter ${newStep.type} message content...`}
                    />
                  </div>
                </>
              )}
            </div>
            <DialogFooter className="sm:justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => { setAddStepModalOpen(false); setEditingStepIndex(null); }}>
                Cancel
              </Button>
              <Button className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" onClick={confirmAddStep}>
                {editingStepIndex !== null ? "Save Changes" : "Save Step"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Enroll Leads Dialog */}
        <Dialog open={enrollModalOpen} onOpenChange={(open) => !enrolling && setEnrollModalOpen(open)}>
          <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>Enroll Leads</DialogTitle>
              <DialogDescription>
                Select leads to enroll into the "{activeSeq?.name}" campaign. They will start from step 1 immediately.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 overflow-hidden flex flex-col flex-1">
              {/* Enrollment mode: hand-pick leads or target a saved segment (SW-NUR-002) */}
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg mb-4 shrink-0">
                <button
                  type="button"
                  onClick={() => setEnrollMode("leads")}
                  disabled={enrolling}
                  className={`text-xs font-semibold py-1.5 rounded-md transition ${enrollMode === "leads" ? "bg-white dark:bg-slate-800 shadow-sm text-[#b48c3c]" : "text-muted-foreground"}`}
                >
                  Select Leads
                </button>
                <button
                  type="button"
                  onClick={() => setEnrollMode("segment")}
                  disabled={enrolling}
                  className={`text-xs font-semibold py-1.5 rounded-md transition ${enrollMode === "segment" ? "bg-white dark:bg-slate-800 shadow-sm text-[#b48c3c]" : "text-muted-foreground"}`}
                >
                  By Segment
                </button>
              </div>

              {enrollMode === "segment" ? (
                <div className="space-y-3">
                  <Label className="text-xs font-semibold">Target segment</Label>
                  {segments.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-3 border border-dashed rounded-lg">
                      No saved segments yet. Create one on the Leads page, then target it here.
                    </p>
                  ) : (
                    <Select value={selectedSegmentId} onValueChange={setSelectedSegmentId} disabled={enrolling}>
                      <SelectTrigger><SelectValue placeholder="Choose a segment" /></SelectTrigger>
                      <SelectContent>
                        {segments.map((s: any) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <p className="text-xs text-muted-foreground">
                    The segment is evaluated at enroll time — every matching lead (not already active in this campaign) is enrolled.
                  </p>
                </div>
              ) : loadingLeads ? (
                <div className="p-4 text-center text-sm text-muted-foreground animate-pulse">Loading leads...</div>
              ) : leadsForEnroll.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">No leads available.</div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_140px_140px] gap-2 mb-4">
                    <Input
                      placeholder="Search leads..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      disabled={enrolling}
                    />
                    <Select value={statusFilter} onValueChange={setStatusFilter} disabled={enrolling}>
                      <SelectTrigger className="w-35 shrink-0">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All Statuses</SelectItem>
                        {DEFAULT_LEAD_STATUSES.filter((status) => !CAMPAIGN_EXCLUDED_STATUSES.has(status)).map((status) => (
                          <SelectItem key={status} value={status}>{status}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={tagFilter} onValueChange={setTagFilter} disabled={enrolling}>
                      <SelectTrigger className="w-35 shrink-0">
                        <SelectValue placeholder="Tag" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All Tags</SelectItem>
                        {enrollLeadTags.map((tag) => (
                          <SelectItem key={tag} value={tag}>{tag}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="no-scrollbar space-y-3 overflow-y-auto pr-1">
                    {(() => {
                      const enrolledLeadIds = ((activeSeqDetail?.enrollments || []) as Array<{ leadId: string }>).map((e) => e.leadId);

                      const filteredLeads = leadsForEnroll.filter((lead) => {
                        const q = searchQuery.toLowerCase();
                        const matchesSearch = !searchQuery || (
                          lead.firstName?.toLowerCase().includes(q) ||
                          lead.lastName?.toLowerCase().includes(q) ||
                          lead.email?.toLowerCase().includes(q)
                        );
                        const matchesStatus = statusFilter === "ALL" || lead.status === statusFilter;
                        const matchesTag = tagFilter === "ALL" || lead.tags?.includes(tagFilter);
                        return matchesSearch && matchesStatus && matchesTag;
                      });

                      const selectableFiltered = filteredLeads.filter((l) => !enrolledLeadIds.includes(l.id));
                      const allSelected = selectableFiltered.length > 0 && selectableFiltered.every((l) => selectedLeadIds.includes(l.id));
                      const isFiltered = searchQuery.length > 0 || statusFilter !== "ALL" || tagFilter !== "ALL";
                      const selectAllLabel = isFiltered ? `Select All Filtered (${selectableFiltered.length})` : `Select All (${selectableFiltered.length})`;

                      return (
                        <>
                          {filteredLeads.length > 0 && (
                            <div className="flex items-center space-x-2 pb-2 mb-2 border-b">
                              <Checkbox
                                checked={allSelected}
                                disabled={enrolling || selectableFiltered.length === 0}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    const newIds = new Set(selectedLeadIds);
                                    selectableFiltered.forEach((l) => newIds.add(l.id));
                                    setSelectedLeadIds(Array.from(newIds));
                                  } else {
                                    const toRemove = new Set(selectableFiltered.map((l) => l.id));
                                    setSelectedLeadIds(selectedLeadIds.filter(id => !toRemove.has(id)));
                                  }
                                }}
                              />
                              <Label className="text-sm font-medium cursor-pointer">{selectAllLabel}</Label>
                            </div>
                          )}

                          {filteredLeads.map((lead) => {
                            const isEnrolled = enrolledLeadIds.includes(lead.id);
                            return (
                              <div key={lead.id} className={`flex items-center space-x-3 p-2 rounded-md border border-transparent ${isEnrolled ? "opacity-60 bg-slate-50 dark:bg-slate-900/50" : "hover:bg-slate-50 dark:hover:bg-slate-900 hover:border-border cursor-pointer"}`} onClick={() => {
                                if (enrolling || isEnrolled) return;
                                if (selectedLeadIds.includes(lead.id)) {
                                  setSelectedLeadIds(selectedLeadIds.filter(id => id !== lead.id));
                                } else {
                                  setSelectedLeadIds([...selectedLeadIds, lead.id]);
                                }
                              }}>
                                <Checkbox
                                  disabled={enrolling || isEnrolled}
                                  checked={isEnrolled || selectedLeadIds.includes(lead.id)}
                                  onCheckedChange={(checked) => {
                                    if (enrolling || isEnrolled) return;
                                    if (checked) {
                                      setSelectedLeadIds([...selectedLeadIds, lead.id]);
                                    } else {
                                      setSelectedLeadIds(selectedLeadIds.filter(id => id !== lead.id));
                                    }
                                  }}
                                />
                                <div className="flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="text-sm font-semibold">{lead.firstName} {lead.lastName}</p>
                                    <div className="flex items-center gap-1.5">
                                      <Badge variant="outline" className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${statusColor(lead.status || "New")}`}>
                                        {lead.status || "New"}
                                      </Badge>
                                      {isEnrolled && <span className="text-[10px] text-green-600 font-semibold bg-green-50 px-1.5 py-0.5 rounded-sm">Already Enrolled</span>}
                                    </div>
                                  </div>
                                  <p className="text-xs text-muted-foreground">{lead.email || lead.phone || "No contact info"}</p>
                                  {lead.tags && lead.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {lead.tags.map((tag) => (
                                        <Badge key={tag} variant="secondary" className="text-[9px] font-mono tracking-tight px-1.5 py-0">
                                          {tag}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}

                          {filteredLeads.length === 0 && (
                            <div className="text-center text-sm text-muted-foreground py-4">No leads match your search.</div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </>
              )}
            </div>
            <DialogFooter className="sm:justify-end gap-2 mt-4 pt-4 border-t">
              <Button variant="outline" onClick={() => setEnrollModalOpen(false)} disabled={enrolling}>
                Cancel
              </Button>
              <Button
                className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90 gap-1.5"
                onClick={confirmEnroll}
                disabled={enrolling || (enrollMode === "segment" ? !selectedSegmentId : selectedLeadIds.length === 0)}
              >
                {enrolling && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                {enrolling
                  ? "Enrolling..."
                  : enrollMode === "segment"
                    ? "Enroll Segment"
                    : `Enroll ${selectedLeadIds.length} Leads`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </PortalLayout>
    </ProtectedRoute>
  );
}
