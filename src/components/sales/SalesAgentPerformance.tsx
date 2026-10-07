"use client";

import { useState } from "react";
import { Bot } from "lucide-react";
import { AgentMetricsGrid } from "@/components/reports/AgentMetricsGrid";
import { useQuery } from "@/lib/use-query";

type Period = "7d" | "30d" | "90d";

type Performance = {
  interactions: number;
  nurturedTouches: number;
  bookedAppointments: number;
  newLeads: number;
  successRate: number | null;
};

/** Sales Agent metrics from the onboarding SOP (Part C). */
export default function SalesAgentPerformance() {
  const [period, setPeriod] = useState<Period>("30d");
  const { data } = useQuery<Performance>(`/api/sales/dashboard/agent-performance?period=${period}`);

  const metrics = [
    { label: "Interactions", value: data?.interactions ?? null, hint: "Conversations where the lead replied to the AI" },
    { label: "Nurtured touches", value: data?.nurturedTouches ?? null, hint: "Campaign messages sent" },
    { label: "Booked appointments", value: data?.bookedAppointments ?? null, hint: "Appointments booked" },
    { label: "New leads", value: data?.newLeads ?? null, hint: "Leads that came in" },
    {
      label: "Success rate",
      value: data?.successRate ?? null,
      suffix: "%",
      hint: "New leads that booked an appointment",
    },
  ];

  return (
    <AgentMetricsGrid
      title="Sales Agent performance"
      icon={<Bot className="h-5 w-5 text-primary" />}
      metrics={metrics}
      action={
        <div className="flex gap-1 rounded-lg bg-muted p-0.5">
          {(["7d", "30d", "90d"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                period === p ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {p.replace("d", " days")}
            </button>
          ))}
        </div>
      }
    />
  );
}
