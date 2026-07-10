"use client";

import { useState, useEffect } from "react";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
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
  Settings,
  LogOut,
  GitBranch
} from "lucide-react";
import { toast } from "sonner";

export default function CampaignsPage() {
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
  const [newStep, setNewStep] = useState<any>({ type: "EMAIL", subject: "", body: "", delayValue: "", delayUnit: "DAYS" });

  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [leadsForEnroll, setLeadsForEnroll] = useState<any[]>([]);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  // Segment-based enrollment (SW-NUR-002)
  const [segments, setSegments] = useState<any[]>([]);
  const [enrollMode, setEnrollMode] = useState<"leads" | "segment">("leads");
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>("");

  // Campaign settings panel: exit conditions (SW-NUR-003) + version policy (SW-NUR-007)
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exitOnReply, setExitOnReply] = useState(true);
  const [exitOnAppointment, setExitOnAppointment] = useState(true);
  const [exitOnStatusChange, setExitOnStatusChange] = useState<string>("");
  const [versionPolicy, setVersionPolicy] = useState<string>("FINISH_OLD");
  const [savingSettings, setSavingSettings] = useState(false);

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

  // Initialize the settings panel from the loaded campaign. Keyed on the campaign
  // id (not the whole object) so the 3s poll doesn't overwrite in-progress edits.
  useEffect(() => {
    if (!activeSeqDetail) return;
    const ec = activeSeqDetail.exitConditions || {};
    setExitOnReply(ec.onReply !== false);
    setExitOnAppointment(ec.onAppointment !== false);
    setExitOnStatusChange(ec.onStatusChange || "");
    setVersionPolicy(activeSeqDetail.versionPolicy || "FINISH_OLD");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSeqDetail?.id]);

  const saveSettings = async () => {
    if (!activeSeq) return;
    setSavingSettings(true);
    try {
      const res = await fetch(`/api/sales/campaigns/${activeSeq.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exitConditions: {
            onReply: exitOnReply,
            onAppointment: exitOnAppointment,
            onStatusChange: exitOnStatusChange || null,
          },
          versionPolicy,
        }),
      });
      if (res.ok) {
        toast.success("Campaign settings saved.");
        setSettingsOpen(false);
        const rd = await fetch(`/api/sales/campaigns/${activeSeq.id}`);
        if (rd.ok) setActiveSeqDetail(await rd.json());
      } else {
        toast.error("Failed to save settings.");
      }
    } catch {
      toast.error("Error saving settings.");
    } finally {
      setSavingSettings(false);
    }
  };

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
      toast.error("Error deleting campaign.");
    }
  };

  const confirmAddStep = async () => {
    if (!activeSeq || !activeSeqDetail) return;

    let newSteps = [...(activeSeqDetail.steps || [])];
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
        setAddStepModalOpen(false);
        setEditingStepIndex(null);
        setNewStep({ type: "EMAIL", subject: "", body: "", delayValue: "", delayUnit: "DAYS" });
        // Refetch campaign detail and list to update steps count
        const resDetail = await fetch(`/api/sales/campaigns/${activeSeq.id}`);
        if (resDetail.ok) {
          setActiveSeqDetail(await resDetail.json());
        }
        fetchCampaigns();
        toast.success(editingStepIndex !== null ? "Step updated successfully." : "Step added successfully.");
      } else {
        toast.error("Failed to save step.");
      }
    } catch (error) {
      toast.error("Error saving step.");
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
      toast.error("Error pausing campaign.");
    }
  };

  const openEnrollModal = async () => {
    setEnrollModalOpen(true);
    setEnrollMode("leads");
    setSelectedSegmentId("");
    setLoadingLeads(true);
    try {
      const [leadsRes, segRes] = await Promise.all([
        fetch("/api/sales/leads?limit=50"),
        fetch("/api/sales/segments"),
      ]);
      if (leadsRes.ok) {
        const data = await leadsRes.json();
        setLeadsForEnroll(Array.isArray(data) ? data : data.leads || []);
      }
      if (segRes.ok) {
        const s = await segRes.json();
        setSegments(Array.isArray(s) ? s : s.segments || []);
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
        fetchCampaigns();
        const rd = await fetch(`/api/sales/campaigns/${activeSeq.id}`);
        if (rd.ok) setActiveSeqDetail(await rd.json());
      } else {
        toast.error("Failed to enroll leads.");
      }
    } catch (e) {
      toast.error("Error enrolling leads.");
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
                      <Button variant="outline" size="sm" className="h-8 text-xs font-semibold" onClick={() => setSettingsOpen(true)}>
                        <Settings className="h-3.5 w-3.5 mr-1" /> Settings
                      </Button>
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
                          // Treat a finished campaign like a running one for the step
                          // visualization so completed steps still render as done.
                          const isRunning = activeSeq.status === "Active" || activeSeq.status === "Paused" || activeSeq.status === "Completed";
                          const totalEnrollments = activeSeqDetail?.enrollments?.length || 0;
                          const completedCount = activeSeqDetail?.enrollments?.filter((e: any) => e.currentStepPosition >= step.position).length || 0;
                          const isFullyCompleted = isRunning && totalEnrollments > 0 && completedCount === totalEnrollments;

                          return (
                            <div key={step.id} className="relative">
                              <span className={`absolute left-[-41px] top-1.5 h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold ${isFullyCompleted ? "bg-green-500 text-white" : "bg-[#b48c3c] text-white"}`}>
                                {isFullyCompleted ? <CheckCircle className="h-4 w-4" /> : index + 1}
                              </span>
                              <div className={`relative p-5 border rounded-xl max-w-xl group transition-all duration-300 hover:shadow-md ${isFullyCompleted ? "bg-linear-to-br from-green-50/50 to-white border-green-200 dark:from-green-950/20 dark:to-slate-900" : "bg-linear-to-br from-white to-slate-50 border-slate-200 shadow-sm dark:from-slate-900 dark:to-slate-900/50"}`}>
                                <div className="flex justify-between items-center mb-3">
                                  <span className="text-sm font-bold flex items-center gap-2 text-slate-800 dark:text-slate-200">
                                    <div className={`p-1.5 rounded-md ${step.type === "EMAIL" ? "bg-[#b48c3c]/10" : step.type === "SMS" ? "bg-cyan-100 dark:bg-cyan-900/30" : "bg-slate-100 dark:bg-slate-800"}`}>
                                      {step.type === "EMAIL" ? <Mail className="h-4 w-4 text-[#b48c3c]" /> : step.type === "SMS" ? <MessageSquare className="h-4 w-4 text-cyan-600" /> : <Clock className="h-4 w-4 text-slate-500" />}
                                    </div>
                                    {step.type === "DELAY" ? "Wait Condition" : `${step.type === "EMAIL" ? `Email: "${step.subject || "No Subject"}"` : "SMS"}`}
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
                      <Button onClick={() => { setEditingStepIndex(null); setNewStep({ type: "EMAIL", subject: "", body: "", delayValue: "", delayUnit: "DAYS" }); setAddStepModalOpen(true); }} variant="outline" size="sm" className="border-dashed hover:border-[#b48c3c] hover:text-[#b48c3c] text-muted-foreground w-full max-w-xl text-xs h-10">
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
                  if (val === "SMS" && !defaultBody) {
                    defaultBody = "Hi {firstName}, just checking in on your recent warranty service. Let me know if you need anything! Reply STOP to unsubscribe.";
                  }
                  setNewStep({ ...newStep, type: val, body: defaultBody });
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EMAIL">Email</SelectItem>
                    <SelectItem value="SMS">SMS</SelectItem>
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
                    <Label>Message Body</Label>
                    <textarea
                      className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[100px]"
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
        <Dialog open={enrollModalOpen} onOpenChange={setEnrollModalOpen}>
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
                  className={`text-xs font-semibold py-1.5 rounded-md transition ${enrollMode === "leads" ? "bg-white dark:bg-slate-800 shadow-sm text-[#b48c3c]" : "text-muted-foreground"}`}
                >
                  Select Leads
                </button>
                <button
                  type="button"
                  onClick={() => setEnrollMode("segment")}
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
                    <Select value={selectedSegmentId} onValueChange={setSelectedSegmentId}>
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
                  <div className="flex items-center gap-2 mb-4">
                    <Input
                      placeholder="Search leads..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="flex-1"
                    />
                    {(() => {
                      const uniqueStatuses = Array.from(new Set(leadsForEnroll.map(l => l.status).filter(Boolean)));
                      return (
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                          <SelectTrigger className="w-[140px]">
                            <SelectValue placeholder="Status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ALL">All Statuses</SelectItem>
                            {uniqueStatuses.map((status: any) => (
                              <SelectItem key={status} value={status}>{status}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      );
                    })()}
                  </div>
                  <div className="space-y-3 overflow-y-auto pr-1">
                    {(() => {
                      const enrolledLeadIds = (activeSeqDetail?.enrollments || []).map((e: any) => e.leadId);

                      const filteredLeads = leadsForEnroll.filter((lead: any) => {
                        const q = searchQuery.toLowerCase();
                        const matchesSearch = !searchQuery || (
                          lead.firstName?.toLowerCase().includes(q) ||
                          lead.lastName?.toLowerCase().includes(q) ||
                          lead.email?.toLowerCase().includes(q)
                        );
                        const matchesStatus = statusFilter === "ALL" || lead.status === statusFilter;
                        return matchesSearch && matchesStatus;
                      });

                      const selectableFiltered = filteredLeads.filter((l: any) => !enrolledLeadIds.includes(l.id));
                      const allSelected = selectableFiltered.length > 0 && selectableFiltered.every((l: any) => selectedLeadIds.includes(l.id));
                      const isFiltered = searchQuery.length > 0 || statusFilter !== "ALL";
                      const selectAllLabel = isFiltered ? `Select All Filtered (${selectableFiltered.length})` : `Select All (${selectableFiltered.length})`;

                      return (
                        <>
                          {filteredLeads.length > 0 && (
                            <div className="flex items-center space-x-2 pb-2 mb-2 border-b">
                              <Checkbox
                                checked={allSelected}
                                disabled={selectableFiltered.length === 0}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    const newIds = new Set(selectedLeadIds);
                                    selectableFiltered.forEach((l: any) => newIds.add(l.id));
                                    setSelectedLeadIds(Array.from(newIds));
                                  } else {
                                    const toRemove = new Set(selectableFiltered.map((l: any) => l.id));
                                    setSelectedLeadIds(selectedLeadIds.filter(id => !toRemove.has(id)));
                                  }
                                }}
                              />
                              <Label className="text-sm font-medium cursor-pointer">{selectAllLabel}</Label>
                            </div>
                          )}

                          {filteredLeads.map((lead: any) => {
                            const isEnrolled = enrolledLeadIds.includes(lead.id);
                            return (
                              <div key={lead.id} className={`flex items-center space-x-3 p-2 rounded-md border border-transparent ${isEnrolled ? "opacity-60 bg-slate-50 dark:bg-slate-900/50" : "hover:bg-slate-50 dark:hover:bg-slate-900 hover:border-border cursor-pointer"}`} onClick={() => {
                                if (isEnrolled) return;
                                if (selectedLeadIds.includes(lead.id)) {
                                  setSelectedLeadIds(selectedLeadIds.filter(id => id !== lead.id));
                                } else {
                                  setSelectedLeadIds([...selectedLeadIds, lead.id]);
                                }
                              }}>
                                <Checkbox
                                  disabled={isEnrolled}
                                  checked={isEnrolled || selectedLeadIds.includes(lead.id)}
                                  onCheckedChange={(checked) => {
                                    if (isEnrolled) return;
                                    if (checked) {
                                      setSelectedLeadIds([...selectedLeadIds, lead.id]);
                                    } else {
                                      setSelectedLeadIds(selectedLeadIds.filter(id => id !== lead.id));
                                    }
                                  }}
                                />
                                <div className="flex-1">
                                  <div className="flex items-center justify-between">
                                    <p className="text-sm font-semibold">{lead.firstName} {lead.lastName}</p>
                                    {isEnrolled && <span className="text-[10px] text-green-600 font-semibold bg-green-50 px-1.5 py-0.5 rounded-sm">Already Enrolled</span>}
                                  </div>
                                  <p className="text-xs text-muted-foreground">{lead.email || lead.phone || "No contact info"}</p>
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
              <Button variant="outline" onClick={() => setEnrollModalOpen(false)}>
                Cancel
              </Button>
              <Button
                className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90"
                onClick={confirmEnroll}
                disabled={enrollMode === "segment" ? !selectedSegmentId : selectedLeadIds.length === 0}
              >
                {enrollMode === "segment" ? "Enroll Segment" : `Enroll ${selectedLeadIds.length} Leads`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Campaign Settings: exit conditions (SW-NUR-003) + version policy (SW-NUR-007) */}
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Settings className="h-5 w-5 text-[#b48c3c]" /> Campaign Settings</DialogTitle>
              <DialogDescription>
                Control when leads automatically exit "{activeSeq?.name}" and how edits apply to leads already mid-sequence.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-2">
              {/* Exit conditions */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                  <LogOut className="h-4 w-4 text-[#b48c3c]" /> Exit Conditions
                </div>
                <p className="text-xs text-muted-foreground -mt-1">When one of these happens, the lead stops receiving further steps.</p>

                <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900">
                  <Checkbox checked={exitOnReply} onCheckedChange={(c) => setExitOnReply(!!c)} />
                  <div>
                    <p className="text-sm font-medium">Lead replies</p>
                    <p className="text-xs text-muted-foreground">Exit when the lead replies to an email or SMS.</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900">
                  <Checkbox checked={exitOnAppointment} onCheckedChange={(c) => setExitOnAppointment(!!c)} />
                  <div>
                    <p className="text-sm font-medium">Lead books an appointment</p>
                    <p className="text-xs text-muted-foreground">Exit when the lead books a meeting.</p>
                  </div>
                </label>

                <div className="p-3 rounded-lg border space-y-2">
                  <p className="text-sm font-medium">Lead status changes to</p>
                  <Select value={exitOnStatusChange || "none"} onValueChange={(v) => setExitOnStatusChange(v === "none" ? "" : v)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="No status-based exit" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No status-based exit</SelectItem>
                      <SelectItem value="Nurturing">Nurturing</SelectItem>
                      <SelectItem value="Engaged">Engaged</SelectItem>
                      <SelectItem value="Appointment Set">Appointment Set</SelectItem>
                      <SelectItem value="Qualified">Qualified</SelectItem>
                      <SelectItem value="Closed Won">Closed Won</SelectItem>
                      <SelectItem value="Closed Lost">Closed Lost</SelectItem>
                      <SelectItem value="Unsubscribed">Unsubscribed</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Unsubscribe always exits a lead regardless of this setting.</p>
                </div>
              </div>

              {/* Version policy */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                  <GitBranch className="h-4 w-4 text-[#b48c3c]" /> Editing an Active Campaign
                </div>
                <Select value={versionPolicy} onValueChange={setVersionPolicy}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FINISH_OLD">Finish on old version (safe)</SelectItem>
                    <SelectItem value="MIGRATE">Migrate to new version</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {versionPolicy === "MIGRATE"
                    ? "Editing steps updates this campaign in place; leads already mid-sequence pick up the new steps at their next step."
                    : "Editing steps on a running campaign creates a new version (v2) as a draft; leads already enrolled finish the current steps."}
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setSettingsOpen(false)} disabled={savingSettings}>Cancel</Button>
              <Button className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" onClick={saveSettings} disabled={savingSettings}>
                {savingSettings ? "Saving…" : "Save Settings"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </PortalLayout>
    </ProtectedRoute>
  );
}
