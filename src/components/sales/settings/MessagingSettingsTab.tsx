"use client";

import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Mail, MessageSquare, Save, HelpCircle, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

// A copy-able webhook URL row used inside the help dialogs.
function WebhookUrl({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — select the URL and copy manually.");
    }
  };
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{label}</p>
      <div className="flex items-stretch gap-2">
        <code className="flex-1 min-w-0 break-all rounded-md border bg-slate-50 dark:bg-slate-900/40 px-2.5 py-2 text-[11px] font-mono text-slate-700 dark:text-slate-300">
          {url}
        </code>
        <Button type="button" variant="outline" size="sm" className="shrink-0 h-auto px-2" onClick={copy}>
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

type SmsProvider = "TWILIO_SMS" | "TELNYX_SMS";

interface SmsCredentials {
  apiKey: string;
  apiSecret: string;
  senderName: string;
}

const EMPTY_SMS_CREDENTIALS: SmsCredentials = { apiKey: "", apiSecret: "", senderName: "" };

// The Integration row stores generic credentials (apiKey / secretKey / senderName);
// each provider just labels them differently.
const SMS_PROVIDERS: Record<
  SmsProvider,
  {
    label: string;
    description: string;
    keyLabel: string;
    keyPlaceholder: string;
    secretLabel: string;
    secretPlaceholder: string;
    secretHint: string;
    senderLabel: string;
    senderPlaceholder: string;
    senderHint: string;
  }
> = {
  TWILIO_SMS: {
    label: "Twilio",
    description: "Configure Twilio credentials for sending and receiving SMS.",
    keyLabel: "Account SID",
    keyPlaceholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    secretLabel: "Auth Token",
    secretPlaceholder: "••••••••",
    secretHint: "Also used to verify inbound webhook signatures.",
    senderLabel: "From Number / Messaging Service SID",
    senderPlaceholder: "+15551234567 or MGxxxxxxxx",
    senderHint: 'A Twilio phone number in E.164 format, or a Messaging Service SID (starts with "MG").',
  },
  TELNYX_SMS: {
    label: "Telnyx",
    description: "Configure Telnyx credentials for sending and receiving SMS.",
    keyLabel: "API Key",
    keyPlaceholder: "KEYxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    secretLabel: "Public Key",
    secretPlaceholder: "Base64 public key from Telnyx",
    secretHint: "From Telnyx → Account Settings → Keys & Credentials → Public Key. Required to verify inbound webhooks.",
    senderLabel: "From Number / Messaging Profile ID",
    senderPlaceholder: "+15551234567 or a profile UUID",
    senderHint: "A Telnyx number in E.164 format, or a Messaging Profile ID (UUID) to send from its number pool.",
  },
};

export default function MessagingSettingsTab() {
  const [loading, setLoading] = useState(true);
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingSms, setSavingSms] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [testingSms, setTestingSms] = useState(false);

  const [emailConfig, setEmailConfig] = useState({
    smtpHost: "",
    smtpPort: "587",
    smtpUser: "",
    smtpPass: "",
    senderEmail: "",
    senderName: "",
    testEmail: "",
  });

  const [smsConfig, setSmsConfig] = useState({
    provider: "TWILIO_SMS" as SmsProvider,
    apiKey: "", // Twilio Account SID / Telnyx API Key / Brevo API Key
    apiSecret: "", // Twilio Auth Token / Telnyx Public Key / unused for Brevo
    senderName: "", // Sender number, Messaging Service SID, profile id, or sender name
    testPhone: "",
  });

  // Credentials are not portable between providers, so each keeps its own set.
  // Switching the dropdown parks what is on screen and restores the other
  // provider's — looking at Telnyx must never cost you your saved Twilio setup.
  const [smsDrafts, setSmsDrafts] = useState<Record<SmsProvider, SmsCredentials>>(() => ({
    TWILIO_SMS: { ...EMPTY_SMS_CREDENTIALS },
    TELNYX_SMS: { ...EMPTY_SMS_CREDENTIALS },
  }));

  const handleProviderChange = (next: SmsProvider) => {
    if (next === smsConfig.provider) return;
    const parked: SmsCredentials = {
      apiKey: smsConfig.apiKey,
      apiSecret: smsConfig.apiSecret,
      senderName: smsConfig.senderName,
    };
    setSmsDrafts((drafts) => ({ ...drafts, [smsConfig.provider]: parked }));
    const restored = smsDrafts[next] ?? EMPTY_SMS_CREDENTIALS;
    setSmsConfig((config) => ({ ...config, provider: next, ...restored }));
  };

  const smsMeta = SMS_PROVIDERS[smsConfig.provider] ?? SMS_PROVIDERS.TWILIO_SMS;

  // Webhook setup help dialogs.
  const [helpOpen, setHelpOpen] = useState<null | "email" | "sms">(null);
  const [origin, setOrigin] = useState("https://your-portal-domain");
  const [companyId, setCompanyId] = useState("");

  useEffect(() => {
    fetchSettings();
    if (process.env.NEXT_PUBLIC_URL) {
      setOrigin(process.env.NEXT_PUBLIC_URL);
    } else if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/sales/settings/messaging", {credentials: "include"});
      if (res.ok) {
        const data = await res.json();
        if (data.companyId) setCompanyId(data.companyId);
        if (data.email) {
          setEmailConfig(prev => ({
            ...prev,
            smtpHost: data.email.smtpHost || "",
            smtpPort: data.email.smtpPort?.toString() || "587",
            smtpUser: data.email.smtpUser || "",
            smtpPass: data.email.smtpPass || "",
            senderEmail: data.email.senderEmail || "",
            senderName: data.email.senderName || "",
          }));
        }
        // Seed a draft per saved provider so switching back restores it without
        // another round trip.
        const saved: { provider: SmsProvider; apiKey?: string; apiSecret?: string; senderName?: string }[] =
          data.smsProviders || (data.sms ? [data.sms] : []);
        if (saved.length) {
          setSmsDrafts(drafts => {
            const next = { ...drafts };
            for (const row of saved) {
              if (!row?.provider || !(row.provider in next)) continue;
              next[row.provider] = {
                apiKey: row.apiKey || "",
                apiSecret: row.apiSecret || "",
                senderName: row.senderName || "",
              };
            }
            return next;
          });
        }
        if (data.sms) {
          setSmsConfig(prev => ({
            ...prev,
            provider: (data.sms.provider as SmsProvider) || "TWILIO_SMS",
            apiKey: data.sms.apiKey || "",
            apiSecret: data.sms.apiSecret || "",
            senderName: data.sms.senderName || "",
          }));
        }
      }
    } catch (error) {
      console.error("Error fetching messaging settings:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveEmail = async () => {
    setSavingEmail(true);
    try {
      const res = await fetch("/api/sales/settings/messaging/email", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(emailConfig),
        credentials: "include"
      });
      if (!res.ok) throw new Error("Failed to save email settings");
      toast.success("Email settings saved successfully");
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSavingEmail(false);
    }
  };

  const handleSaveSms = async () => {
    setSavingSms(true);
    try {
      const res = await fetch("/api/sales/settings/messaging/sms", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(smsConfig),
        credentials: "include"
      });
      if (!res.ok) throw new Error("Failed to save SMS settings");
      // Keep this provider's draft in step with what was just persisted.
      setSmsDrafts(drafts => ({
        ...drafts,
        [smsConfig.provider]: {
          apiKey: smsConfig.apiKey,
          apiSecret: smsConfig.apiSecret,
          senderName: smsConfig.senderName,
        },
      }));
      toast.success("SMS settings saved successfully");
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSavingSms(false);
    }
  };

  const handleTestEmail = async () => {
    if (!emailConfig.testEmail) {
      toast.error("Please enter a test email address");
      return;
    }
    setTestingEmail(true);
    try {
      const res = await fetch("/api/sales/settings/messaging/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: emailConfig.testEmail, config: emailConfig }),
        credentials: "include"
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to send test email");
      toast.success("Test email sent successfully!");
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setTestingEmail(false);
    }
  };

  const handleTestSms = async () => {
    if (!smsConfig.testPhone) {
      toast.error("Please enter a test phone number");
      return;
    }
    setTestingSms(true);
    try {
      const res = await fetch("/api/sales/settings/messaging/test-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: smsConfig.testPhone, config: smsConfig }),
        credentials: "include"
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to send test SMS");
      toast.success("Test SMS sent successfully!");
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setTestingSms(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-[#b48c3c]" /></div>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Email Settings */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <Card className="border-slate-200/60 dark:border-slate-800/60 shadow-lg shadow-slate-200/20 dark:shadow-slate-900/20 h-full flex flex-col">
          <CardHeader className="bg-slate-50/50 dark:bg-slate-900/20 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-lg">
                  <Mail className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <CardTitle>Email SMTP Configuration</CardTitle>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-xs text-muted-foreground shrink-0"
                onClick={() => setHelpOpen("email")}
              >
                <HelpCircle className="h-4 w-4" /> Webhook setup
              </Button>
            </div>
            <CardDescription>Configure SMTP credentials for sending outbound emails.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6 flex-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>SMTP Host</Label>
                <Input value={emailConfig.smtpHost} onChange={e => setEmailConfig({...emailConfig, smtpHost: e.target.value})} placeholder="smtp-relay.brevo.com" />
              </div>
              <div className="space-y-2">
                <Label>SMTP Port</Label>
                <Input value={emailConfig.smtpPort} onChange={e => setEmailConfig({...emailConfig, smtpPort: e.target.value})} placeholder="587" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>SMTP Username</Label>
                <Input value={emailConfig.smtpUser} onChange={e => setEmailConfig({...emailConfig, smtpUser: e.target.value})} placeholder="username@domain.com" />
              </div>
              <div className="space-y-2">
                <Label>SMTP Password</Label>
                <Input type="password" value={emailConfig.smtpPass} onChange={e => setEmailConfig({...emailConfig, smtpPass: e.target.value})} placeholder="••••••••" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Sender Email</Label>
                <Input value={emailConfig.senderEmail} onChange={e => setEmailConfig({...emailConfig, senderEmail: e.target.value})} placeholder="noreply@yourcompany.com" />
              </div>
              <div className="space-y-2">
                <Label>Sender Name</Label>
                <Input value={emailConfig.senderName} onChange={e => setEmailConfig({...emailConfig, senderName: e.target.value})} placeholder="Your Company" />
              </div>
            </div>

            <div className="pt-4 mt-4 border-t border-slate-100 dark:border-slate-800">
              <Label className="mb-2 block">Test Configuration</Label>
              <div className="flex gap-2">
                <Input value={emailConfig.testEmail} onChange={e => setEmailConfig({...emailConfig, testEmail: e.target.value})} placeholder="Enter test email address" />
                <Button variant="outline" onClick={handleTestEmail} disabled={testingEmail}>
                  {testingEmail ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}
                  Test
                </Button>
              </div>
            </div>
          </CardContent>
          <CardFooter className="bg-slate-50/50 dark:bg-slate-900/20 border-t border-slate-100 dark:border-slate-800 flex justify-end p-4">
            <Button onClick={handleSaveEmail} disabled={savingEmail} className="bg-[#0F3B3D] hover:bg-[#0F3B3D]/90">
              {savingEmail ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save Configuration
            </Button>
          </CardFooter>
        </Card>
      </motion.div>

      {/* SMS Settings */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 }}>
        <Card className="border-slate-200/60 dark:border-slate-800/60 shadow-lg shadow-slate-200/20 dark:shadow-slate-900/20 h-full flex flex-col">
          <CardHeader className="bg-slate-50/50 dark:bg-slate-900/20 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <div className="bg-green-100 dark:bg-green-900/30 p-2 rounded-lg">
                  <MessageSquare className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                <CardTitle>SMS API Configuration</CardTitle>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-xs text-muted-foreground shrink-0"
                onClick={() => setHelpOpen("sms")}
              >
                <HelpCircle className="h-4 w-4" /> Webhook setup
              </Button>
            </div>
            <CardDescription>{smsMeta.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6 flex-1">
            <div className="space-y-2">
              <Label>SMS Provider</Label>
              <Select
                value={smsConfig.provider}
                onValueChange={(value) => handleProviderChange(value as SmsProvider)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SMS_PROVIDERS) as SmsProvider[]).map((key) => (
                    <SelectItem key={key} value={key}>{SMS_PROVIDERS[key].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{smsMeta.keyLabel}</Label>
              <Input type="password" value={smsConfig.apiKey} onChange={e => setSmsConfig({...smsConfig, apiKey: e.target.value})} placeholder={smsMeta.keyPlaceholder} />
            </div>

            <div className="space-y-2">
              <Label>{smsMeta.secretLabel}</Label>
              <Input type="password" value={smsConfig.apiSecret} onChange={e => setSmsConfig({...smsConfig, apiSecret: e.target.value})} placeholder={smsMeta.secretPlaceholder} />
              <p className="text-xs text-slate-500">{smsMeta.secretHint}</p>
            </div>

            <div className="space-y-2">
              <Label>{smsMeta.senderLabel}</Label>
              <Input value={smsConfig.senderName} onChange={e => setSmsConfig({...smsConfig, senderName: e.target.value})} placeholder={smsMeta.senderPlaceholder} />
              <p className="text-xs text-slate-500">{smsMeta.senderHint}</p>
            </div>

            <div className="pt-4 mt-4 border-t border-slate-100 dark:border-slate-800">
              <Label className="mb-2 block">Test Configuration</Label>
              <div className="flex gap-2">
                <Input value={smsConfig.testPhone} onChange={e => setSmsConfig({...smsConfig, testPhone: e.target.value})} placeholder="+1234567890" />
                <Button variant="outline" onClick={handleTestSms} disabled={testingSms}>
                  {testingSms ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MessageSquare className="h-4 w-4 mr-2" />}
                  Test
                </Button>
              </div>
            </div>
          </CardContent>
          <CardFooter className="bg-slate-50/50 dark:bg-slate-900/20 border-t border-slate-100 dark:border-slate-800 flex justify-end p-4">
            <Button onClick={handleSaveSms} disabled={savingSms} className="bg-[#0F3B3D] hover:bg-[#0F3B3D]/90">
              {savingSms ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save Configuration
            </Button>
          </CardFooter>
        </Card>
      </motion.div>

      {/* Webhook setup help */}
      <Dialog open={helpOpen !== null} onOpenChange={(open) => !open && setHelpOpen(null)}>
        <DialogContent className="sm:max-w-2xl">
          {helpOpen === "email" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-blue-600" /> Set up Brevo webhooks
                </DialogTitle>
                <DialogDescription>
                  This lets the portal receive replies, so leads are exited from active
                  sequences automatically.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-5 pt-2 text-sm">
                <div className="space-y-2">
                  <p className="font-semibold text-slate-800 dark:text-slate-100">Inbound replies</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    In Brevo <strong>Inbound Parsing</strong>, add a route pointing to the URL
                    below. When a lead replies, they&apos;re exited from active sequences.
                  </p>
                  <WebhookUrl label="Inbound email URL" url={`${origin}/api/sales/compliance/inbound/email${companyId ? `?companyId=${companyId}` : ""}`} />
                </div>
              </div>
            </>
          )}
          {helpOpen === "sms" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-green-600" /> Set up {smsMeta.label} webhook
                </DialogTitle>
                <DialogDescription>
                  This lets the portal receive SMS replies and opt-outs (STOP), so leads are
                  exited and suppressed automatically.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-5 pt-2 text-sm">
                {smsConfig.provider === "TWILIO_SMS" && (
                  <div className="space-y-2">
                    <p className="font-semibold text-slate-800 dark:text-slate-100">Inbound messages (replies &amp; STOP)</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      In the Twilio Console go to <strong>Phone Numbers → Manage → Active numbers →
                      [your number]</strong>. Under <strong>Messaging → &quot;A message comes in&quot;</strong>,
                      set the webhook to <strong>HTTP POST</strong> with the URL below.
                    </p>
                    <WebhookUrl label="Inbound SMS URL" url={`${origin}/api/sales/compliance/inbound/sms${companyId ? `?companyId=${companyId}` : ""}`} />
                  </div>
                )}

                {smsConfig.provider === "TELNYX_SMS" && (
                  <div className="space-y-2">
                    <p className="font-semibold text-slate-800 dark:text-slate-100">Inbound messages (replies &amp; STOP)</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      In the Telnyx Portal go to <strong>Messaging → Messaging Profiles →
                      [your profile] → Outbound/Inbound Webhooks</strong>. Set the
                      <strong> Webhook URL</strong> to the URL below (API version <strong>V2</strong>),
                      then make sure your number is assigned to that profile.
                    </p>
                    <WebhookUrl label="Inbound SMS URL" url={`${origin}/api/sales/compliance/inbound/sms/telnyx${companyId ? `?companyId=${companyId}` : ""}`} />
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Telnyx signs every webhook, so the <strong>Public Key</strong> field above must be
                      filled in or inbound messages will be rejected. STOP/HELP auto-replies are sent by
                      Telnyx itself.
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <p className="font-semibold text-slate-800 dark:text-slate-100">Delivery status</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    No manual setup needed — the portal attaches a status callback to every SMS it
                    sends, so delivered/failed counts update automatically.
                  </p>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
