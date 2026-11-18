"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mail, MessageSquare, Sparkles } from "lucide-react";
import { useMessagingCapabilities } from "@/lib/use-messaging-capabilities";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { SmsRegistrationFields, emptySmsRegistration, type SmsRegistration } from "@/components/sms/SmsRegistrationFields";

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
  textingNumber: {
    status: "NONE" | "PENDING" | "APPROVED" | "REJECTED";
    number: string | null;
    rejectReason: string | null;
    registration: SmsRegistration | null;
  };
  usageThisMonth: UsageRow[];
}

const TEXTING_STATUS: Record<MessagingSettings["textingNumber"]["status"], { badge: string; className: string; body: string }> = {
  APPROVED: {
    badge: "Active",
    className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    body: "Your texts go out from your own registered number, and replies to it come straight to you. A STOP sent to this number only affects your texts.",
  },
  PENDING: {
    badge: "Awaiting carrier approval",
    className: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    body: "We've registered your business with the US carriers. Approval usually takes a few days, sometimes up to 2–3 weeks. Until then your texts keep going out from the shared platform number.",
  },
  REJECTED: {
    badge: "Needs attention",
    className: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
    body: "The carriers didn't approve the registration. Correct the details below and resubmit. Until then your texts keep going out from the shared platform number.",
  },
  NONE: {
    badge: "Not registered yet",
    className: "bg-zinc-500/15 text-zinc-500 dark:text-zinc-400",
    body: "US carriers require every business that texts to register its own number. Register with your legal name, EIN and address, and we'll get you a local number at no cost to you. Until then your texts go out from the shared platform number.",
  },
};

const formatPhone = (e164: string) => {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
};

const CHANNELS: { key: string; label: string; unit: string; icon: typeof Mail }[] = [
  { key: "EMAIL", label: "Emails", unit: "sent", icon: Mail },
  { key: "SMS", label: "SMS", unit: "segments", icon: MessageSquare },
  { key: "AI", label: "AI", unit: "tokens", icon: Sparkles },
];

export default function MessagingSettingsTab() {
  const [settings, setSettings] = useState<MessagingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const { emailConfigured, smsConfigured, smsProvider } = useMessagingCapabilities();
  const [form, setForm] = useState<SmsRegistration | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submitRegistration = async () => {
    if (!form) return;
    setSubmitting(true);
    try {
      const textingNumber = await api.post<MessagingSettings["textingNumber"]>("/api/sales/settings/messaging/texting-registration", form);
      setSettings((s) => (s ? { ...s, textingNumber } : s));
      setForm(null);
      toast.success("Submitted. Carriers usually answer within a few days; we'll switch your texts over as soon as they approve.");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await api.get<typeof settings>("/api/sales/settings/messaging");
        if (!cancelled) setSettings(data);
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

      {settings?.textingNumber && (() => {
        const t = settings.textingNumber;
        const view = TEXTING_STATUS[t.status] ?? TEXTING_STATUS.NONE;
        return (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle className="text-base">Your texting number</CardTitle>
              <Badge variant="outline" className={`border-0 ${view.className}`}>
                {view.badge}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {t.number && <p className="font-mono text-lg font-semibold">{formatPhone(t.number)}</p>}
              <p className="text-muted-foreground">{view.body}</p>
              {t.rejectReason && (
                <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                  Carrier feedback: {t.rejectReason}
                </p>
              )}
              {(t.status === "NONE" || t.status === "REJECTED") && (
                <Button
                  className="bg-[#0F3B3D] text-white hover:bg-[#0F3B3D]/90"
                  onClick={() => setForm({ ...emptySmsRegistration({ name: settings.sender.name }), ...t.registration })}
                >
                  {t.status === "REJECTED" ? "Fix & resubmit" : "Register for my own number"}
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })()}

      <Dialog open={!!form} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {form && (
            <>
              <DialogHeader>
                <DialogTitle>Register for your own texting number</DialogTitle>
                <DialogDescription>
                  Carriers check these details against IRS records, so enter them exactly as registered. Approval usually takes a few days,
                  sometimes 2–3 weeks. There&apos;s no cost to you.
                </DialogDescription>
              </DialogHeader>
              <SmsRegistrationFields value={form} onChange={setForm} />
              <DialogFooter>
                <Button variant="outline" onClick={() => setForm(null)}>
                  Cancel
                </Button>
                <Button className="bg-[#0F3B3D] text-white hover:bg-[#0F3B3D]/90" disabled={submitting} onClick={submitRegistration}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit to carriers"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

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
