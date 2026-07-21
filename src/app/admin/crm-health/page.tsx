"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  PlugZap,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  PauseCircle,
  Clock,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

type Health = "HEALTHY" | "DEGRADED" | "FAILING" | "DISABLED";

interface ConnectionHealth {
  companyId: string;
  companyName: string;
  salesEnabled: boolean;
  environment: string;
  instanceHost: string | null;
  isActive: boolean;
  writeBackEnabled: boolean;
  syncInterval: number;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncMessage: string | null;
  tokenExpired: boolean;
  stale: boolean;
  health: Health;
  recent: {
    runs: number;
    failures: number;
    errors: number;
    records: number;
    windowHours: number;
  };
}

const HEALTH_STYLES: Record<
  Health,
  { label: string; className: string; Icon: typeof CheckCircle2 }
> = {
  HEALTHY: {
    label: "Healthy",
    className:
      "bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400",
    Icon: CheckCircle2,
  },
  DEGRADED: {
    label: "Degraded",
    className:
      "bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-400",
    Icon: Clock,
  },
  FAILING: {
    label: "Failing",
    className:
      "bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-400",
    Icon: AlertTriangle,
  },
  DISABLED: {
    label: "Disabled",
    className:
      "bg-slate-100 text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-400",
    Icon: PauseCircle,
  },
};

function ago(iso: string | null) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function AdminCrmHealthPage() {
  const { user } = useAuth();
  const [connections, setConnections] = useState<ConnectionHealth[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/crm-health");
      if (res.ok) {
        const data = await res.json();
        setConnections(data.connections || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.isSuperAdmin) load();
  }, [user, load]);

  const counts = connections.reduce<Record<string, number>>((acc, c) => {
    acc[c.health] = (acc[c.health] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#b48c3c]/10 text-[#b48c3c]">
                <PlugZap className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-xl text-foreground">
                  CRM Connection Health
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Read-only view of every tenant&apos;s Salesforce sync.
                  Credentials are never shown, and connecting or disconnecting
                  stays with the tenant&apos;s own admin.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={load}
              className="gap-1.5">
              <RefreshCw
                className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              />{" "}
              Refresh
            </Button>
          </div>

          {!loading && connections.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {(Object.keys(HEALTH_STYLES) as Health[]).map((h) =>
                counts[h] ? (
                  <Badge key={h} className={HEALTH_STYLES[h].className}>
                    {counts[h]} {HEALTH_STYLES[h].label.toLowerCase()}
                  </Badge>
                ) : null,
              )}
            </div>
          )}
        </CardHeader>

        <CardContent className="p-4 md:p-6">
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
              Loading connection health…
            </div>
          ) : connections.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No tenant has connected a CRM yet.
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {connections.map((c) => {
                const { label, className, Icon } = HEALTH_STYLES[c.health];
                return (
                  <div
                    key={c.companyId}
                    className="rounded-xl border border-border bg-background p-4 shadow-sm">
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground">
                          {c.companyName}
                        </p>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          {c.instanceHost || "—"} · {c.environment}
                        </p>
                      </div>
                      <Badge className={`gap-1 shrink-0 ${className}`}>
                        <Icon className="h-3 w-3" /> {label}
                      </Badge>
                    </div>

                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Last sync</dt>
                        <dd className="font-medium">{ago(c.lastSyncAt)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Interval</dt>
                        <dd className="font-medium">{c.syncInterval}m</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">
                          Runs / {c.recent.windowHours}h
                        </dt>
                        <dd className="font-medium">
                          {c.recent.runs}
                          {c.recent.failures > 0 && (
                            <span className="text-red-500">
                              {" "}
                              · {c.recent.failures} failed
                            </span>
                          )}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Write-back</dt>
                        <dd className="font-medium">
                          {c.writeBackEnabled ? "On" : "Off"}
                        </dd>
                      </div>
                    </dl>

                    {(c.tokenExpired || c.stale || c.lastSyncMessage) && (
                      <div className="mt-3 space-y-1 border-t border-border pt-3 text-[11px]">
                        {c.tokenExpired && (
                          <p className="text-red-600 dark:text-red-400">
                            OAuth token has expired — the tenant needs to
                            reconnect.
                          </p>
                        )}
                        {c.stale && !c.tokenExpired && (
                          <p className="text-amber-600 dark:text-amber-400">
                            No sync in well over the configured interval.
                          </p>
                        )}
                        {c.lastSyncMessage && (
                          <p className="line-clamp-2 text-muted-foreground">
                            {c.lastSyncMessage}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
