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
} from "lucide-react";

export default function TicketDetail() {
  const { id } = useParams();
  const [ticket, setTicket] = useState<any>(null);
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const fetchTicket = async () => {
      try {
        const response = await fetch(`/api/tickets/${id}`);
        if (response.ok) {
          const data = await response.json();
          setTicket(data);
          setStatus(data.status);
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
