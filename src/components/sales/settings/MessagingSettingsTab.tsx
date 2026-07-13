"use client";

import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    provider: "TWILIO_SMS",
    apiKey: "", // Twilio Account SID
    apiSecret: "", // Twilio Auth Token
    senderName: "", // Twilio phone number (E.164) or Messaging Service SID
    testPhone: "",
  });

  // Webhook setup help dialogs.
  const [helpOpen, setHelpOpen] = useState<null | "email" | "sms">(null);
  const [origin, setOrigin] = useState("https://your-portal-domain");

  useEffect(() => {
    fetchSettings();
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/sales/settings/messaging", {credentials: "include"});
      if (res.ok) {
        const data = await res.json();
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
        if (data.sms) {
          setSmsConfig(prev => ({
            ...prev,
            provider: data.sms.provider || "TWILIO_SMS",
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
            <CardDescription>Configure Twilio credentials for sending and receiving SMS.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6 flex-1">
            <div className="space-y-2">
              <Label>SMS Provider</Label>
              <Input value="Twilio" disabled className="bg-slate-50 dark:bg-slate-900/40" />
            </div>

            <div className="space-y-2">
              <Label>Account SID</Label>
              <Input type="password" value={smsConfig.apiKey} onChange={e => setSmsConfig({...smsConfig, apiKey: e.target.value})} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
            </div>

            <div className="space-y-2">
              <Label>Auth Token</Label>
              <Input type="password" value={smsConfig.apiSecret} onChange={e => setSmsConfig({...smsConfig, apiSecret: e.target.value})} placeholder="••••••••" />
            </div>

            <div className="space-y-2">
              <Label>From Number / Messaging Service SID</Label>
              <Input value={smsConfig.senderName} onChange={e => setSmsConfig({...smsConfig, senderName: e.target.value})} placeholder="+15551234567 or MGxxxxxxxx" />
              <p className="text-xs text-slate-500">A Twilio phone number in E.164 format, or a Messaging Service SID (starts with &quot;MG&quot;).</p>
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
                  These let the portal receive delivery events and replies, so campaign
                  analytics and automatic unsubscribes stay accurate.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-5 pt-2 text-sm">
                <div className="space-y-2">
                  <p className="font-semibold text-slate-800 dark:text-slate-100">1. Event webhook (delivered / opened / clicked / bounced / spam)</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    In Brevo go to <strong>Transactional → Settings → Webhook</strong> (or{" "}
                    <strong>Settings → Webhooks</strong>), add a webhook, paste the URL below,
                    and enable: delivered, opened, click, hard &amp; soft bounce, spam/complaint,
                    and unsubscribe.
                  </p>
                  <WebhookUrl label="Event webhook URL" url={`${origin}/api/sales/compliance/events/email?token=<INBOUND_WEBHOOK_SECRET>`} />
                </div>
                <div className="space-y-2">
                  <p className="font-semibold text-slate-800 dark:text-slate-100">2. Inbound replies</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    In Brevo <strong>Inbound Parsing</strong>, add a route pointing to the URL
                    below. When a lead replies, they&apos;re exited from active sequences.
                  </p>
                  <WebhookUrl label="Inbound email URL" url={`${origin}/api/sales/compliance/inbound/email?token=<INBOUND_WEBHOOK_SECRET>`} />
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/40 p-3">
                  Replace <code>&lt;INBOUND_WEBHOOK_SECRET&gt;</code> with the shared webhook token
                  configured on the server (env <code>INBOUND_WEBHOOK_SECRET</code>). Ask your
                  administrator if you don&apos;t have it — the token prevents forged webhook calls.
                </p>
              </div>
            </>
          )}
          {helpOpen === "sms" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-green-600" /> Set up Twilio webhook
                </DialogTitle>
                <DialogDescription>
                  This lets the portal receive SMS replies and opt-outs (STOP), so leads are
                  exited and suppressed automatically.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-5 pt-2 text-sm">
                <div className="space-y-2">
                  <p className="font-semibold text-slate-800 dark:text-slate-100">1. Inbound messages (replies &amp; STOP)</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    In the Twilio Console go to <strong>Phone Numbers → Manage → Active numbers →
                    [your number]</strong>. Under <strong>Messaging → &quot;A message comes in&quot;</strong>,
                    set the webhook to <strong>HTTP POST</strong> with the URL below.
                  </p>
                  <WebhookUrl label="Inbound SMS URL" url={`${origin}/api/sales/compliance/inbound/sms`} />
                </div>
                <div className="space-y-2">
                  <p className="font-semibold text-slate-800 dark:text-slate-100">2. Delivery status callbacks</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    No manual setup needed — the portal attaches a status callback to every SMS it
                    sends, so delivered/failed counts update automatically.
                  </p>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/40 p-3">
                  Twilio requests are verified by signature. In production, set{" "}
                  <code>TWILIO_VALIDATE_SIGNATURE=1</code> on the server so only genuine Twilio
                  calls are accepted.
                </p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
