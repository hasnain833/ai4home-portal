"use client";

import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Mail, MessageSquare, Save } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

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
    provider: "BREVO_SMS",
    apiKey: "",
    apiSecret: "",
    senderName: "",
    testPhone: "",
  });

  useEffect(() => {
    fetchSettings();
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
            provider: data.sms.provider || "BREVO_SMS",
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
            <div className="flex items-center space-x-2">
              <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-lg">
                <Mail className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <CardTitle>Email SMTP Configuration</CardTitle>
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
            <div className="flex items-center space-x-2">
              <div className="bg-green-100 dark:bg-green-900/30 p-2 rounded-lg">
                <MessageSquare className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <CardTitle>SMS API Configuration</CardTitle>
            </div>
            <CardDescription>Configure credentials for sending outbound SMS.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6 flex-1">
            <div className="space-y-2">
              <Label>SMS Provider</Label>
              <Input value="Brevo" disabled className="bg-slate-50 dark:bg-slate-900/40" />
            </div>

            <div className="space-y-2">
              <Label>API Key</Label>
              <Input type="password" value={smsConfig.apiKey} onChange={e => setSmsConfig({...smsConfig, apiKey: e.target.value})} placeholder="••••••••" />
            </div>

            <div className="space-y-2">
              <Label>Sender Name</Label>
              <Input value={smsConfig.senderName} onChange={e => setSmsConfig({...smsConfig, senderName: e.target.value})} placeholder="YourCompany" />
              <p className="text-xs text-slate-500">Alphanumeric sender ID, up to 11 characters.</p>
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
    </div>
  );
}
