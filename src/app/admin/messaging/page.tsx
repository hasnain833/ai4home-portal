"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, RefreshCw, Mail, MessageSquare, Sparkles, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface ChannelUsage {
  units: number;
  costMicros: number;
}

interface TenantSpend {
  companyId: string | null;
  name: string;
  costMicros: number;
  channels: Record<string, ChannelUsage>;
}

interface ChannelRow {
  channel: string;
  outcome: string;
  units: number;
  costMicros: number;
}

type Pricing = Record<string, number>;

// Where each number comes from. None of these providers expose a per-unit price
// the app can read back, so they are set from the plan or invoice by hand.
const PRICING_FIELDS: { key: string; label: string; help: string }[] = [
  {
    key: "EMAIL",
    label: "Email (per email)",
    help: "Brevo bills per plan, not per email — divide your monthly cost by the emails it includes.",
  },
  {
    key: "TWILIO_SMS",
    label: "Twilio (per segment)",
    help: "Twilio US long-code list price is $0.0079. Check your own rate on the Twilio pricing page.",
  },
  {
    key: "TELNYX_SMS",
    label: "Telnyx (per segment)",
    help: "Telnyx US long-code list price is $0.004. Volume commitments lower this.",
  },
  {
    key: "FAILED_SEND",
    label: "Rejected send",
    help: "Rejected before reaching a carrier, so normally free. Raise it only if your provider bills for these.",
  },
];

interface SpendData {
  monthToDate: { tenants: TenantSpend[]; totalCostMicros: number };
  byChannel: ChannelRow[];
  monthly: { month: string; costMicros: number }[];
  pricing: Pricing;
  providers: {
    sms: { active: string | null; available: string[]; all: string[] };
    email: { configured: boolean; sendingAddress: string };
  };
}

// Costs are stored in millionths of a dollar to keep the ledger integer-only.
const money = (micros: number) =>
  `$${(micros / 1_000_000).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const CHANNEL_META: Record<string, { label: string; icon: typeof Mail }> = {
  EMAIL: { label: "Email", icon: Mail },
  SMS: { label: "SMS", icon: MessageSquare },
  AI: { label: "AI", icon: Sparkles },
};

const UNIT_LABEL: Record<string, string> = {
  EMAIL: "emails",
  SMS: "segments",
  AI: "tokens",
};

export default function AdminMessagingPage() {
  const [data, setData] = useState<SpendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [rates, setRates] = useState<Pricing | null>(null);
  const [savingRates, setSavingRates] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/messaging/spend");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.message || "Failed to load messaging spend");
        return;
      }
      setData(body);
      setRates(body.pricing);
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const switchProvider = async (provider: string) => {
    setSwitching(true);
    try {
      const res = await fetch("/api/admin/messaging/sms-provider", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.message || "Could not switch provider");
        return;
      }
      toast.success(`SMS now sending via ${provider.replace("_SMS", "")}`);
      await load();
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setSwitching(false);
    }
  };

  const saveRates = async () => {
    if (!rates) return;
    setSavingRates(true);
    try {
      const res = await fetch("/api/admin/messaging/pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pricing: rates }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.message || "Could not save rates");
        return;
      }
      toast.success("Rates updated");
      await load();
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setSavingRates(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!data) return null;

  const totals = data.byChannel.reduce<Record<string, ChannelUsage>>((acc, row) => {
    const bucket = acc[row.channel] || { units: 0, costMicros: 0 };
    acc[row.channel] = {
      units: bucket.units + row.units,
      costMicros: bucket.costMicros + row.costMicros,
    };
    return acc;
  }, {});

  const failed = data.byChannel.filter((r) => r.outcome === "failed" && r.units > 0);

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Platform Messaging</h1>
          <p className="text-muted-foreground text-sm mt-1">
            What the platform is spending on email, SMS and AI across every tenant.
          </p>
        </div>
        <Button variant="outline" onClick={load} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Channel totals */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        {["EMAIL", "SMS", "AI"].map((channel) => {
          const meta = CHANNEL_META[channel];
          const Icon = meta.icon;
          const t = totals[channel] || { units: 0, costMicros: 0 };
          return (
            <Card key={channel}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-muted-foreground text-xs font-semibold uppercase">
                  <Icon className="h-4 w-4" />
                  {meta.label}
                </div>
                <p className="text-2xl font-bold mt-2">{money(t.costMicros)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t.units.toLocaleString()} {UNIT_LABEL[channel]} · last 6 months
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {failed.length > 0 && (
        <Card className="border-amber-300 dark:border-amber-900/60">
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold">Failed sends are still billed by some providers.</p>
              <p className="text-muted-foreground mt-0.5">
                {failed
                  .map((r) => `${r.units.toLocaleString()} ${UNIT_LABEL[r.channel]} (${CHANNEL_META[r.channel]?.label || r.channel})`)
                  .join(", ")}{" "}
                failed in the last 6 months, costing {money(failed.reduce((s, r) => s + r.costMicros, 0))}.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Providers */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Providers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">SMS</p>
            <div className="flex flex-wrap gap-2">
              {data.providers.sms.all.map((provider) => {
                const isActive = data.providers.sms.active === provider;
                const isAvailable = data.providers.sms.available.includes(provider);
                return (
                  <Button
                    key={provider}
                    variant={isActive ? "default" : "outline"}
                    size="sm"
                    disabled={switching || isActive || !isAvailable}
                    onClick={() => switchProvider(provider)}
                    className="gap-2"
                  >
                    {switching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {provider.replace("_SMS", "")}
                    {isActive && <Badge variant="secondary" className="ml-1">Active</Badge>}
                    {!isAvailable && (
                      <span className="text-xs opacity-70">no credentials</span>
                    )}
                  </Button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Credentials are read from the environment. This only chooses which of
              them is used, and takes effect within 30 seconds.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">Email</p>
            {data.providers.email.configured ? (
              <p className="text-sm">
                Sending as{" "}
                <span className="font-mono">{data.providers.email.sendingAddress}</span>
              </p>
            ) : (
              <p className="text-sm text-amber-600">
                No platform SMTP credentials are set — no email can be sent.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Rates */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            What each unit costs you, in millionths of a dollar — 1250 is $0.00125.
            These start at each provider&apos;s published list price; correct them from
            your own invoices, since neither Brevo nor Telnyx exposes a per-unit
            rate this page could read automatically. Every figure above is derived
            from these, and changing one affects new sends only, not spend already
            recorded.
          </p>
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            {rates &&
              PRICING_FIELDS.map(({ key, label, help }) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`rate-${key}`} className="text-xs font-semibold">
                    {label}
                  </Label>
                  <Input
                    id={`rate-${key}`}
                    type="number"
                    min="0"
                    value={rates[key] ?? 0}
                    onChange={(e) =>
                      setRates((r) => ({ ...(r || {}), [key]: Number(e.target.value) }))
                    }
                  />
                  <p className="text-[11px] font-medium">
                    ${((rates[key] ?? 0) / 1_000_000).toFixed(6)}
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-snug">{help}</p>
                </div>
              ))}
          </div>
          <Button onClick={saveRates} disabled={savingRates} className="gap-2">
            {savingRates && <Loader2 className="h-4 w-4 animate-spin" />}
            Save rates
          </Button>
        </CardContent>
      </Card>

      {/* Per-tenant spend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Spend this month
            <span className="ml-2 text-muted-foreground font-normal">
              {money(data.monthToDate.totalCostMicros)} total
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {data.monthToDate.tenants.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">
              Nothing sent yet this month.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>SMS</TableHead>
                  <TableHead>AI</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.monthToDate.tenants.map((t) => (
                  <TableRow key={t.companyId || "unattributed"}>
                    <TableCell className="font-semibold">{t.name}</TableCell>
                    {["EMAIL", "SMS", "AI"].map((c) => (
                      <TableCell key={c} className="text-muted-foreground text-sm">
                        {t.channels[c]
                          ? `${money(t.channels[c].costMicros)} · ${t.channels[c].units.toLocaleString()}`
                          : "—"}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-semibold">
                      {money(t.costMicros)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
