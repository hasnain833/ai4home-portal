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
  Clock
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

export default function SequencesPage() {
  const [sequences, setSequences] = useState<any[]>([]);
  const [activeSeq, setActiveSeq] = useState<any>(null);
  const [activeSeqDetail, setActiveSeqDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Modals state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newSeqName, setNewSeqName] = useState("New Campaign");
  const [seqToDelete, setSeqToDelete] = useState<any>(null);
  const [addStepModalOpen, setAddStepModalOpen] = useState(false);
  const [newStep, setNewStep] = useState<any>({
    type: "EMAIL",
    subject: "",
    body: "",
    delayValue: "",
    delayUnit: "DAYS",
  });

  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [leadsForEnroll, setLeadsForEnroll] = useState<any[]>([]);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);

  const fetchSequences = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sales/sequences");
      if (res.ok) {
        const data = await res.json();
        setSequences(data);
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
    fetchSequences();
  }, []);

  useEffect(() => {
    if (!activeSeq) return;
    const fetchDetail = async () => {
      setLoadingDetail(true);
      try {
        const res = await fetch(`/api/sales/sequences/${activeSeq.id}`);
        if (res.ok) {
          setActiveSeqDetail(await res.json());
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingDetail(false);
      }
    };
    fetchDetail();
  }, [activeSeq]);

  const confirmCreateSequence = async () => {
    if (!newSeqName) return;
    try {
      const res = await fetch("/api/sales/sequences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newSeqName, channel: "Email & SMS" })
      });
      if (res.ok) {
        setCreateModalOpen(false);
        setNewSeqName("");
        fetchSequences();
        toast.success("Sequence created successfully.");
      } else {
        toast.error("Failed to create sequence.");
      }
    } catch (error) {
      toast.error("Error creating sequence.");
    }
  };

  const confirmDeleteSequence = async () => {
    if (!seqToDelete) return;
    try {
      const res = await fetch(`/api/sales/sequences/${seqToDelete.id}`, { method: "DELETE" });
      if (res.ok) {
        setSeqToDelete(null);
        if (activeSeq?.id === seqToDelete.id) setActiveSeq(null);
        fetchSequences();
        toast.success("Sequence deleted.");
      } else {
        toast.error("Failed to delete sequence.");
      }
    } catch (error) {
      toast.error("Error deleting sequence.");
    }
  };

  const confirmAddStep = async () => {
    if (!activeSeq || !activeSeqDetail) return;

    const newSteps = [...(activeSeqDetail.steps || []), newStep];

    try {
      const res = await fetch(`/api/sales/sequences/${activeSeq.id}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steps: newSteps })
      });
      if (res.ok) {
        setAddStepModalOpen(false);
        setNewStep({ type: "EMAIL", subject: "", body: "", delayValue: "", delayUnit: "DAYS" });
        // Refetch sequence detail
        const resDetail = await fetch(`/api/sales/sequences/${activeSeq.id}`);
        if (resDetail.ok) {
          setActiveSeqDetail(await resDetail.json());
        }
        toast.success("Step added successfully.");
      } else {
        toast.error("Failed to add step.");
      }
    } catch (error) {
      toast.error("Error adding step.");
    }
  };

  const launchSequence = async () => {
    if (!activeSeq) return;
    try {
      const res = await fetch(`/api/sales/sequences/${activeSeq.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Active" })
      });
      if (res.ok) {
        fetchSequences();
        setActiveSeq({ ...activeSeq, status: "Active" });
        toast.success("Sequence launched.");
      } else {
        toast.error("Failed to launch sequence.");
      }
    } catch (e) {
      toast.error("Error launching sequence.");
    }
  };

  const pauseSequence = async () => {
    if (!activeSeq) return;
    try {
      const res = await fetch(`/api/sales/sequences/${activeSeq.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Paused" })
      });
      if (res.ok) {
        fetchSequences();
        setActiveSeq({ ...activeSeq, status: "Paused" });
        toast.success("Sequence paused.");
      } else {
        toast.error("Failed to pause sequence.");
      }
    } catch (e) {
      toast.error("Error pausing sequence.");
    }
  };

  const openEnrollModal = async () => {
    setEnrollModalOpen(true);
    setLoadingLeads(true);
    try {
      const res = await fetch("/api/sales/leads?limit=50");
      if (res.ok) {
        const data = await res.json();
        setLeadsForEnroll(Array.isArray(data) ? data : data.leads || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingLeads(false);
    }
  };

  const confirmEnroll = async () => {
    if (!activeSeq || selectedLeadIds.length === 0) return;
    try {
      const res = await fetch(`/api/sales/sequences/${activeSeq.id}/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: selectedLeadIds })
      });
      if (res.ok) {
        setEnrollModalOpen(false);
        setSelectedLeadIds([]);
        toast.success("Leads successfully enrolled!");
        fetchSequences();
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
              <Plus className="h-4 w-4" /> Create Sequence
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Panel: List of Sequences */}
            <div className="space-y-4">
              {sequences.length === 0 && !loading && (
                <p className="text-muted-foreground text-sm py-4">No sequences found. Create one to get started.</p>
              )}
              {sequences.map((seq) => (
                <Card
                  key={seq.id}
                  onClick={() => setActiveSeq(seq)}
                  className={`cursor-pointer transition border relative overflow-hidden ${activeSeq?.id === seq.id
                    ? "border-[#b48c3c] bg-linear-to-br from-white to-[#b48c3c]/5 dark:from-slate-900 dark:to-slate-900/50"
                    : "hover:border-border"
                    }`}
                >
                  <CardHeader className="p-4 pb-2">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-bold text-[#b48c3c]">{seq.id}</span>
                        <Badge className={seq.status === "Active" ? "bg-green-50 text-green-700 border-green-200/50 dark:bg-green-950/20 dark:text-green-400" : "bg-gray-100 text-gray-700 dark:bg-gray-800"}>
                          {seq.status}
                        </Badge>
                      </div>
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSeqToDelete(seq); }} className="h-6 w-6 p-0 text-red-500 hover:bg-red-500/10">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <CardTitle className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-2 truncate">
                      {seq.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 text-xs text-muted-foreground space-y-2">
                    <div className="flex justify-between">
                      <span>Steps: <strong className="text-foreground">{seq.stepsCount}</strong></span>
                      <span>Channel: <strong className="text-foreground">{seq.channel}</strong></span>
                    </div>
                    <div className="flex justify-between border-t dark:border-slate-800 pt-2 text-[10px]">
                      <span>Active Leads: <strong className="text-foreground">{seq.activeLeads}</strong></span>
                      <span className="text-green-600 font-bold">{seq.conversionRate} conv</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Right Panel: Active Sequence Detail View */}
            <div className="lg:col-span-2 space-y-6">
              {activeSeq ? (
                <Card className="border border-border/80">
                  <CardHeader className="border-b border-border/50 bg-slate-50/50 dark:bg-slate-900/40 p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                      <CardTitle className="text-lg font-bold text-slate-800 dark:text-slate-100">{activeSeq.name}</CardTitle>
                      <CardDescription className="text-xs mt-1">Multi-step drip campaign flow settings.</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="h-8 text-xs font-semibold" onClick={openEnrollModal}>
                        <Users className="h-3.5 w-3.5 mr-1" /> Enroll Leads
                      </Button>
                      {activeSeq.status === "Draft" || activeSeq.status === "Paused" ? (
                        <Button size="sm" className="bg-green-600 text-white hover:bg-green-700 h-8 text-xs font-semibold" onClick={launchSequence}>
                          <Play className="h-3.5 w-3.5 mr-1" /> {activeSeq.status === "Paused" ? "Resume Sequence" : "Launch Sequence"}
                        </Button>
                      ) : activeSeq.status === "Active" ? (
                        <Button size="sm" variant="outline" className="h-8 text-xs font-semibold text-orange-600 hover:text-orange-700 hover:bg-orange-50 border-orange-200" onClick={pauseSequence}>
                          <Clock className="h-3.5 w-3.5 mr-1" /> Pause Sequence
                        </Button>
                      ) : null}
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
                        activeSeqDetail.steps.map((step: any, index: number) => (
                          <div key={step.id} className="relative">
                            <span className="absolute left-[-41px] top-1.5 h-6 w-6 rounded-full bg-[#b48c3c] text-white flex items-center justify-center text-[10px] font-bold">{index + 1}</span>
                            <div className="p-4 border rounded-xl bg-slate-50/40 dark:bg-slate-950/20 max-w-xl">
                              <div className="flex justify-between items-center">
                                <span className="text-xs font-bold flex items-center gap-1.5 text-slate-800 dark:text-slate-200">
                                  {step.type === "EMAIL" ? <Mail className="h-3.5 w-3.5 text-[#b48c3c]" /> : step.type === "SMS" ? <MessageSquare className="h-3.5 w-3.5 text-cyan-600" /> : <Clock className="h-3.5 w-3.5 text-slate-400" />}
                                  {step.type === "DELAY" ? "Wait Condition" : `Drip ${step.type === "EMAIL" ? "Email" : "SMS"}: "${step.subject || "No Subject"}"`}
                                </span>
                                <Badge variant="outline" className="text-[9px]">
                                  {step.delayValue ? `${step.delayValue} ${step.delayUnit || "Days"}` : "Immediate"}
                                </Badge>
                              </div>
                              {step.body && (
                                <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed whitespace-pre-line">
                                  {step.body}
                                </p>
                              )}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-10 text-muted-foreground text-sm border border-dashed rounded-lg">
                          No steps configured for this sequence.
                        </div>
                      )}
                    </div>
                    <div className="mt-8 pt-4 border-t border-border/50 flex justify-center ml-4 pl-8">
                      <Button onClick={() => setAddStepModalOpen(true)} variant="outline" size="sm" className="border-dashed hover:border-[#b48c3c] hover:text-[#b48c3c] text-muted-foreground w-full max-w-xl text-xs h-10">
                        <Plus className="h-4 w-4 mr-2" /> Add Step
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </div>
        </div>

        {/* Create Sequence Dialog */}
        <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create New Sequence</DialogTitle>
              <DialogDescription>
                Enter a name for your new sequence. You can configure the steps later.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Input
                value={newSeqName}
                onChange={(e) => setNewSeqName(e.target.value)}
                placeholder="Sequence Name"
                className="w-full"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && confirmCreateSequence()}
              />
            </div>
            <DialogFooter className="sm:justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateModalOpen(false)}>
                Cancel
              </Button>
              <Button className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" onClick={confirmCreateSequence}>
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={!!seqToDelete} onOpenChange={(open) => !open && setSeqToDelete(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete Sequence</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete the "{seqToDelete?.name}" sequence? This will also stop all active lead enrollments on this sequence. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="sm:justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setSeqToDelete(null)}>
                Cancel
              </Button>
              <Button variant="destructive" className="bg-red-500 hover:bg-red-600 text-white" onClick={confirmDeleteSequence}>
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add Step Dialog */}
        <Dialog open={addStepModalOpen} onOpenChange={setAddStepModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add Sequence Step</DialogTitle>
              <DialogDescription>
                Configure the action or delay for this step.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div className="space-y-2">
                <Label>Step Type</Label>
                <Select value={newStep.type} onValueChange={(val) => setNewStep({ ...newStep, type: val })}>
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
                  <div className="space-y-2">
                    <Label>Subject (for Email)</Label>
                    <Input value={newStep.subject} onChange={(e) => setNewStep({ ...newStep, subject: e.target.value })} placeholder="Email Subject" />
                  </div>
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
            <DialogFooter className="sm:justify-end gap-2">
              <Button variant="outline" onClick={() => setAddStepModalOpen(false)}>
                Cancel
              </Button>
              <Button className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" onClick={confirmAddStep}>
                Add Step
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
                Select leads to enroll into the "{activeSeq?.name}" sequence. They will start from step 1 immediately.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 overflow-y-auto flex-1">
              {loadingLeads ? (
                <div className="p-4 text-center text-sm text-muted-foreground animate-pulse">Loading leads...</div>
              ) : leadsForEnroll.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">No leads available.</div>
              ) : (
                <div className="space-y-3">
                  {leadsForEnroll.map((lead: any) => (
                    <div key={lead.id} className="flex items-center space-x-3 p-2 hover:bg-slate-50 dark:hover:bg-slate-900 rounded-md border border-transparent hover:border-border cursor-pointer" onClick={() => {
                      if (selectedLeadIds.includes(lead.id)) {
                        setSelectedLeadIds(selectedLeadIds.filter(id => id !== lead.id));
                      } else {
                        setSelectedLeadIds([...selectedLeadIds, lead.id]);
                      }
                    }}>
                      <Checkbox
                        checked={selectedLeadIds.includes(lead.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedLeadIds([...selectedLeadIds, lead.id]);
                          } else {
                            setSelectedLeadIds(selectedLeadIds.filter(id => id !== lead.id));
                          }
                        }}
                      />
                      <div>
                        <p className="text-sm font-semibold">{lead.firstName} {lead.lastName}</p>
                        <p className="text-xs text-muted-foreground">{lead.email || lead.phone || "No contact info"}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter className="sm:justify-end gap-2 mt-4 pt-4 border-t">
              <Button variant="outline" onClick={() => setEnrollModalOpen(false)}>
                Cancel
              </Button>
              <Button className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90" onClick={confirmEnroll} disabled={selectedLeadIds.length === 0}>
                Enroll {selectedLeadIds.length} Leads
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </PortalLayout>
    </ProtectedRoute>
  );
}
