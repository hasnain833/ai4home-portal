"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mail, MessageSquare, Sparkles } from "lucide-react";
import { useMessagingCapabilities } from "@/lib/use-messaging-capabilities";

interface UsageRow {
  channel: string;
  units: number;
  costMicros: number;
}

interface MessagingSettings {
  sender: {
    name: string | null;
    replyTo: string | null;
    sendingAddress: string;
  };
  usageThisMonth: UsageRow[];
}

const CHANNELS: { key: string; label: string; unit: string; icon: typeof Mail }[] = [
  { key: "EMAIL", label: "Emails", unit: "sent", icon: Mail },
  { key: "SMS", label: "SMS", unit: "segments", icon: MessageSquare },
  { key: "AI", label: "AI", unit: "tokens", icon: Sparkles },
];

export default function MessagingSettingsTab() {
  const [settings, setSettings] = useState<MessagingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const { emailConfigured, smsConfigured, smsProvider } = useMessagingCapabilities();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/sales/messaging-settings");
        if (!cancelled && res.ok) setSettings(await res.json());
      } catch (error) {
        console.error("Failed to load messaging settings:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const usageFor = (channel: string) =>
    settings?.usageThisMonth.find((r) => r.channel === channel);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How your messages appear</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Email and SMS are sent and paid for by the platform — there is nothing
            to configure here. Your company name and contact details come from your
            company profile.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                Recipients see
              </p>
              <p className="font-medium mt-1">
                {settings?.sender.name || "Your company name"}
              </p>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                {settings?.sender.sendingAddress}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                Replies go to
              </p>
              <p className="font-medium mt-1">
                {settings?.sender.replyTo || (
                  <span className="text-amber-600">
                    Not set — add an email on your company profile
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Badge variant={emailConfigured ? "secondary" : "destructive"}>
              Email {emailConfigured ? "available" : "unavailable"}
            </Badge>
            <Badge variant={smsConfigured ? "secondary" : "destructive"}>
              SMS {smsConfigured ? "available" : "unavailable"}
              {smsProvider ? ` · ${smsProvider.replace("_SMS", "")}` : ""}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage this month</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            {CHANNELS.map(({ key, label, unit, icon: Icon }) => {
              const row = usageFor(key);
              return (
                <div key={key} className="rounded-xl border p-4 dark:border-gray-800">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                    <Icon className="h-4 w-4" />
                    {label}
                  </div>
                  <p className="text-2xl font-bold mt-2">
                    {(row?.units || 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{unit}</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
