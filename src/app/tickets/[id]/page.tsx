"use client";

import { useState } from "react";
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
} from "lucide-react";

const ticketData: Record<string, any> = {
  "TKT-001": {
    id: "TKT-001",
    homeowner: "Sarah Johnson",
    address: "123 Maple St",
    contact: "(555) 123-4567",
    email: "sarah@example.com",
    coeDate: "2025-06-01",
    warrantyYear: 1,
    issueType: "HVAC not cooling",
    description: "AC blowing warm air",
    diagnosis: "Low refrigerant",
    status: "open",
    priority: "high",
    createdAt: "2026-05-10T10:30:00",
    erpSyncStatus: "synced",
    transcript: [
      {
        role: "Homeowner",
        message: "My AC isn't cooling",
        timestamp: "10:30 AM",
      },
      {
        role: "Agent",
        message: "I'm sorry to hear that",
        timestamp: "10:31 AM",
      },
    ],
  },
  "TKT-002": {
    /* similar */
  },
  "TKT-003": {
    /* similar */
  },
  // Add defaults for other IDs
};

export default function TicketDetail() {
  const { id } = useParams();
  const ticket = ticketData[id as string] || ticketData["TKT-001"];
  const [status, setStatus] = useState(ticket.status);
  const [note, setNote] = useState("");
  const [updating, setUpdating] = useState(false);

  const handleUpdate = async () => {
    setUpdating(true);
    setTimeout(() => {
      setUpdating(false);
    }, 1000);
  };
  const handleAddNote = async () => {
    if (!note.trim()) return;
    setUpdating(true);
    setTimeout(() => {
      setNote("");
      setUpdating(false);
    }, 1000);
  };

  const statusColor: Record<string, string> = {
    open: "bg-blue-100",
    in_progress: "bg-yellow-100",
    resolved: "bg-green-100",
    escalated: "bg-red-100",
  };

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
            <Badge className={statusColor[status]}>{status}</Badge>
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
                    {ticket.description}
                  </p>
                  <p className="mt-2">
                    <span className="font-medium">Diagnosis:</span>{" "}
                    {ticket.diagnosis}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex gap-2">
                    <MessageSquare className="h-5 w-5" /> Conversation
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {ticket.transcript.map((msg: any, i: number) => (
                      <div
                        key={i}
                        className={`flex ${msg.role === "Agent" ? "justify-start" : "justify-end"}`}
                      >
                        <div
                          className={`max-w-[70%] rounded-lg px-4 py-2 ${msg.role === "Agent" ? "bg-muted" : "bg-primary text-primary-foreground"}`}
                        >
                          <p>{msg.message}</p>
                          <p className="text-xs opacity-70">{msg.timestamp}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex gap-2">
                    <User className="h-5 w-5" /> Homeowner
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p>
                    <span className="font-medium">Name:</span>{" "}
                    {ticket.homeowner}
                  </p>
                  <p>
                    <span className="font-medium">Contact:</span>{" "}
                    {ticket.contact}
                  </p>
                  <p>
                    <span className="font-medium">Email:</span> {ticket.email}
                  </p>
                  <p>
                    <span className="font-medium">Address:</span>{" "}
                    {ticket.address}
                  </p>
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
                    <span className="font-medium">COE Date:</span>{" "}
                    {new Date(ticket.coeDate).toLocaleDateString()}
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
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="escalated">Escalated</SelectItem>
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
                  <Badge variant="outline">{ticket.erpSyncStatus}</Badge>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
