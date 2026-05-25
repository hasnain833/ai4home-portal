"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  User,
  Calendar,
  MessageSquare,
  RefreshCcw,
  Send,
  CheckCircle,
  Loader2,
  Sparkles,
  ThumbsUp,
  Trash2,
  Bot,
  FileText,
} from "lucide-react";

export default function TicketDetail() {
  const { id } = useParams();
  const [ticket, setTicket] = useState<any>(null);
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [draftResponse, setDraftResponse] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [isProcessingDraft, setIsProcessingDraft] = useState(false);

  useEffect(() => {
    const fetchTicket = async () => {
      try {
        const response = await fetch(`/api/tickets/${id}`);
        if (response.ok) {
          const data = await response.json();
          setTicket(data);
          setStatus(data.status);
          setDraftResponse(data.draftResponse);
          setDraftText(data.draftResponse || "");
        }
      } catch (error) {
        console.error("Error fetching ticket:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchTicket();
  }, [id]);

  const handleUpdate = async () => {
    setUpdating(true);
    try {
      const response = await fetch(`/api/tickets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (response.ok) {
        setTicket((prev: any) => ({ ...prev, status }));
      }
    } catch (error) {
      console.error("Error updating ticket:", error);
    } finally {
      setUpdating(false);
    }
  };

  const handleAddNote = async () => {
    if (!note.trim()) return;
    setUpdating(true);
    // Note functionality could be added to the database too
    setTimeout(() => {
      setNote("");
      setUpdating(false);
    }, 500);
  };

  const handleApproveDraft = async () => {
    if (!draftText.trim()) return;
    setIsProcessingDraft(true);
    try {
      const response = await fetch(`/api/tickets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", draftResponse: draftText }),
      });
      if (response.ok) {
        setDraftResponse(null);
        setDraftText("");
        
        // Append approved draft locally to conversation messages
        if (ticket) {
          const newMsg = {
            id: `approved-${Date.now()}`,
            role: "assistant",
            content: draftText,
            timestamp: new Date().toISOString()
          };
          const messages = ticket.conversation?.messages || [];
          setTicket({
            ...ticket,
            draftResponse: null,
            conversation: {
              ...(ticket.conversation || {}),
              messages: [...messages, newMsg]
            }
          });
        }
      } else {
        const errorData = await response.json();
        alert(errorData.message || "Failed to approve draft.");
      }
    } catch (error) {
      console.error("Error approving draft:", error);
    } finally {
      setIsProcessingDraft(false);
    }
  };

  const handleRejectDraft = async () => {
    setIsProcessingDraft(true);
    try {
      const response = await fetch(`/api/tickets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      });
      if (response.ok) {
        setDraftResponse(null);
        setDraftText("");
        if (ticket) {
          setTicket({
            ...ticket,
            draftResponse: null
          });
        }
      } else {
        alert("Failed to reject draft.");
      }
    } catch (error) {
      console.error("Error rejecting draft:", error);
    } finally {
      setIsProcessingDraft(false);
    }
  };

  const statusColor: Record<string, string> = {
    OPEN: "bg-blue-100",
    IN_PROGRESS: "bg-yellow-100",
    RESOLVED: "bg-green-100",
    ESCALATED: "bg-red-100",
  };

  if (loading) return (
    <PortalLayout>
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    </PortalLayout>
  );

  if (!ticket) return (
    <PortalLayout>
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold">Ticket not found</h2>
        <Link href="/tickets"><Button className="mt-4">Back to Tickets</Button></Link>
      </div>
    </PortalLayout>
  );

  return (
    <ProtectedRoute allowedRoles={["admin", "staff", "homeowner"]}>
      <PortalLayout>
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Link href="/tickets">
              <Button variant="ghost">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            </Link>
            <h1 className="text-2xl font-bold">Ticket {ticket.id}</h1>
            <Badge className={statusColor[status]}>{status.replace("_", " ")}</Badge>
          </div>
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              {draftResponse && (
                <Card className="border-cyan-500/30 bg-gradient-to-br from-slate-900 to-slate-950 text-slate-100 shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-4 duration-300">
                  <div className="bg-gradient-to-r from-cyan-600/20 to-blue-600/20 px-6 py-4 flex items-center justify-between border-b border-slate-800">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-cyan-500/20 rounded-lg">
                        <Sparkles className="h-5 w-5 text-cyan-400 animate-pulse" />
                      </div>
                      <div>
                        <CardTitle className="text-base font-bold tracking-tight">Botpress Agent Reviewer</CardTitle>
                        <p className="text-[11px] text-cyan-300/80 font-medium">Pending Human-in-the-Loop Review</p>
                      </div>
                    </div>
                    <Badge className="bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 border-cyan-500/30 font-semibold tracking-wide">
                      AI DRAFT
                    </Badge>
                  </div>
                  <CardContent className="p-6 space-y-4">
                    <p className="text-xs text-slate-400 leading-relaxed">
                      The Botpress AI assistant drafted the following response based on active warranty policies and DIY diagnostics. You can edit the text inline before delivering it to the homeowner.
                    </p>
                    
                    <div className="relative">
                      <Textarea
                        value={draftText}
                        onChange={(e) => setDraftText(e.target.value)}
                        rows={6}
                        className="w-full bg-slate-950 border-slate-800 focus:border-cyan-500 focus:ring-cyan-500/20 text-slate-100 placeholder-slate-600 text-sm leading-relaxed rounded-lg resize-y p-3 transition duration-200"
                        placeholder="Type or edit the response here..."
                      />
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 pt-2">
                      <Button
                        onClick={handleApproveDraft}
                        disabled={isProcessingDraft || !draftText.trim()}
                        className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold transition duration-200 border-none shadow-md shadow-emerald-950/20 py-2.5"
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
                        className="border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white transition duration-200 py-2.5"
                      >
                        {isProcessingDraft ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="mr-2 h-4 w-4 text-red-400" />
                        )}
                        Reject
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle>Issue Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <p>
                    <span className="font-medium">Type:</span>{" "}
                    {ticket.issueType}
                  </p>
                  <p className="mt-2">
                    <span className="font-medium">Description:</span>{" "}
                    {ticket.description || "No description provided."}
                  </p>
                </CardContent>
              </Card>

              {ticket.chatSummary && (
                <Card className="border-amber-500/20 bg-gradient-to-br from-slate-900 to-slate-950 text-slate-100 shadow-lg overflow-hidden">
                  <div className="bg-gradient-to-r from-amber-600/10 to-orange-600/10 px-6 py-4 flex items-center gap-2 border-b border-slate-800">
                    <div className="p-1.5 bg-amber-500/20 rounded-lg">
                      <Sparkles className="h-5 w-5 text-amber-400" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-bold tracking-tight">Botpress Conversation Summary</CardTitle>
                      <p className="text-[10px] text-amber-300/80 font-medium">Automatically compiled handoff context</p>
                    </div>
                  </div>
                  <CardContent className="p-6">
                    <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">
                      {ticket.chatSummary}
                    </p>
                  </CardContent>
                </Card>
              )}

              {ticket.extractedInfo && (() => {
                let parsedInfo: Record<string, any> | null = null;
                try {
                  const parsed = JSON.parse(ticket.extractedInfo);
                  if (parsed && typeof parsed === "object") {
                    parsedInfo = parsed;
                  }
                } catch (e) {
                  // Fallback to null (plain text)
                }

                return (
                  <Card className="border-indigo-500/20 bg-gradient-to-br from-slate-900 to-slate-950 text-slate-100 shadow-lg overflow-hidden">
                    <div className="bg-gradient-to-r from-indigo-600/10 to-blue-600/10 px-6 py-4 flex items-center gap-2 border-b border-slate-800">
                      <div className="p-1.5 bg-indigo-500/20 rounded-lg">
                        <Bot className="h-5 w-5 text-indigo-400" />
                      </div>
                      <div>
                        <CardTitle className="text-sm font-bold tracking-tight">Extracted Diagnostic Info</CardTitle>
                        <p className="text-[10px] text-indigo-300/80 font-medium">Variables extracted by Botpress AI</p>
                      </div>
                    </div>
                    <CardContent className="p-6">
                      {parsedInfo ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {Object.entries(parsedInfo).map(([key, value]) => {
                            // Beautify key from camelCase or snake_case
                            const formattedKey = key
                              .replace(/([A-Z])/g, " $1")
                              .replace(/[_-]/g, " ")
                              .replace(/^\w/, (c) => c.toUpperCase());
                            
                            const displayValue = typeof value === "object" ? JSON.stringify(value) : String(value);

                            return (
                              <div key={key} className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/40">
                                <p className="text-xs text-slate-400 font-semibold tracking-wide uppercase">{formattedKey}</p>
                                <p className="text-sm text-slate-200 mt-1 font-medium">{displayValue}</p>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">
                          {ticket.extractedInfo}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })()}

              {ticket.kbReferences && (() => {
                let parsedRefs: string[] = [];
                try {
                  const parsed = JSON.parse(ticket.kbReferences);
                  if (Array.isArray(parsed)) {
                    parsedRefs = parsed;
                  }
                } catch (e) {}

                if (parsedRefs.length === 0) return null;

                return (
                  <Card className="border-cyan-500/20 bg-gradient-to-br from-slate-900 to-slate-950 text-slate-100 shadow-lg overflow-hidden">
                    <div className="bg-gradient-to-r from-cyan-600/10 to-teal-600/10 px-6 py-4 flex items-center gap-2 border-b border-slate-800">
                      <div className="p-1.5 bg-cyan-500/20 rounded-lg">
                        <FileText className="h-5 w-5 text-cyan-400" />
                      </div>
                      <div>
                        <CardTitle className="text-sm font-bold tracking-tight">Referenced KB Documents</CardTitle>
                        <p className="text-[10px] text-cyan-300/80 font-medium">Knowledge Base files used by AI</p>
                      </div>
                    </div>
                    <CardContent className="p-6">
                      <div className="flex flex-col gap-2">
                        {parsedRefs.map((ref, idx) => (
                          <div key={idx} className="flex items-center gap-2 bg-slate-950/60 p-3 rounded-lg border border-slate-800/40">
                            <FileText className="h-4 w-4 text-cyan-500/70" />
                            <span className="text-sm font-medium text-slate-200">{ref}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}
              <Card>
                <CardHeader>
                  <CardTitle className="flex gap-2">
                    <MessageSquare className="h-5 w-5" /> Conversation Transcript
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                    {ticket.conversation?.messages && ticket.conversation.messages.length > 0 ? (
                      ticket.conversation.messages.map((msg: any) => (
                        <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                          <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                            msg.role === 'user' 
                              ? 'bg-primary text-primary-foreground rounded-tr-none' 
                              : 'bg-muted rounded-tl-none'
                          }`}>
                            <p>{msg.content}</p>
                            <span className="text-[10px] opacity-70 block mt-1">
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground italic text-center py-4">
                        No transcript available for this ticket.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex gap-2">
                    <User className="h-5 w-5" /> Homeowner & Property
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Contact</p>
                    <p className="text-sm"><span className="font-medium">Name:</span> {ticket.homeowner?.name || "Unknown"}</p>
                    <p className="text-sm"><span className="font-medium">Email:</span> {ticket.homeowner?.email || "N/A"}</p>
                  </div>
                  <Separator />
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Property Details</p>
                    <p className="text-sm"><span className="font-medium">Address:</span> {ticket.property?.address || "N/A"}</p>
                    <p className="text-sm"><span className="font-medium">Location:</span> {ticket.property?.city}, {ticket.property?.state}</p>
                    <p className="text-sm"><span className="font-medium">COE Date:</span> {ticket.property?.coeDate ? new Date(ticket.property.coeDate).toLocaleDateString() : "N/A"}</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex gap-2">
                    <Calendar className="h-5 w-5" /> Warranty
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p>
                    <span className="font-medium">Created:</span>{" "}
                    {new Date(ticket.createdAt).toLocaleDateString()}
                  </p>
                  <p>
                    <span className="font-medium">Year:</span> Year{" "}
                    {ticket.warrantyYear}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Actions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OPEN">Open</SelectItem>
                      <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                      <SelectItem value="RESOLVED">Resolved</SelectItem>
                      <SelectItem value="ESCALATED">Escalated</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={handleUpdate}
                    disabled={updating}
                    className="w-full"
                  >
                    <RefreshCcw className="mr-2 h-4 w-4" />
                    Update
                  </Button>
                  <Separator />
                  <Textarea
                    placeholder="Internal note..."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                  />
                  <Button
                    onClick={handleAddNote}
                    disabled={updating}
                    className="w-full"
                  >
                    <Send className="mr-2 h-4 w-4" />
                    Add Note
                  </Button>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6 flex justify-between">
                  <div className="flex gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    ERP Sync
                  </div>
                  <Badge variant="outline">{ticket.erpSyncStatus || "PENDING"}</Badge>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
