"use client";

import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Calendar } from "lucide-react";
import { apiFetch } from "@/lib/api";

type SalesAgentAppointment = {
  id: string;
  name: string;
  email: string;
  phone: string;
  preferredTime: string;
  status: string;
  createdAt: string;
};

export default function SalesAgentAppointmentsPage() {
  const [appointments, setAppointments] = useState<SalesAgentAppointment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAppointments = async () => {
      try {
        const data = await apiFetch<SalesAgentAppointment[]>("/api/admin/sales-agent-appointments");
        setAppointments(data);
      } catch (error) {
        console.error("Failed to load appointments:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchAppointments();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Sales Agent Appointments</h1>
        <p className="text-muted-foreground mt-2">
          Appointments booked via the public Botpress Sales Agent on the website.
        </p>
      </div>

      <Card className="border border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle>Recent Bookings</CardTitle>
          <CardDescription>A list of all users who requested an appointment through the AI agent.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : appointments.length === 0 ? (
            <div className="py-12 text-center flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg bg-zinc-50 dark:bg-zinc-900/50">
              <Calendar className="h-8 w-8 mb-3 opacity-20" />
              <p>No appointments booked yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 font-medium rounded-tl-lg">Date Booked</th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Contact</th>
                    <th className="px-4 py-3 font-medium">Preferred Time</th>
                    <th className="px-4 py-3 font-medium rounded-tr-lg">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {appointments.map((apt) => (
                    <tr key={apt.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        {format(new Date(apt.createdAt), "MMM d, yyyy h:mm a")}
                      </td>
                      <td className="px-4 py-3 font-medium">{apt.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <div>{apt.email}</div>
                        <div className="text-xs">{apt.phone}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-1 rounded-md bg-[#b48c3c]/10 text-[#b48c3c] text-xs font-medium">
                          {apt.preferredTime}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-1 rounded-full bg-green-500/10 text-green-500 text-[10px] font-bold uppercase tracking-wider">
                          {apt.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
