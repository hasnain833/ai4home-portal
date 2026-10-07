import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type AgentMetric = {
  label: string;
  /** null = nothing to measure yet (e.g. a rate with no visits). */
  value: number | null;
  suffix?: string;
  hint: string;
};

/** The per-agent metrics the onboarding SOP reports on (Part C). */
export function AgentMetricsGrid({
  title,
  icon,
  metrics,
  action,
}: {
  title: string;
  icon: ReactNode;
  metrics: AgentMetric[];
  action?: ReactNode;
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-xl border border-border/40 bg-muted/40 p-3" title={m.hint}>
            <span className="block text-xs font-medium text-muted-foreground">{m.label}</span>
            <span className="text-xl font-bold text-foreground">
              {m.value === null ? "—" : `${m.value.toLocaleString()}${m.suffix || ""}`}
            </span>
            <span className="mt-1 block text-xs leading-snug text-muted-foreground">{m.hint}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
