"use client";

import { useState, useEffect } from "react";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  RefreshCw,
  Plug,
  Zap,
  Database,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Wifi,
  WifiOff,
  Save,
  Trash2,
  Eye,
  EyeOff,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface IntegrationStatus {
  platform: string;
  configured: boolean;
  environment: string | null;
  apiKeyMasked: string | null;
  isActive: boolean;
  lastUpdated: string | null;
}

interface TestResult {
  ok: boolean;
  message: string;
}

interface FormState {
  apiKey: string;
  secretKey: string;
  environment: string;
}

const PLATFORM_META: Record<string, {
  label: string;
  description: string;
  icon: React.ReactNode;
  hasSecret: boolean;
}> = {
  BUILTOPIA: {
    label: "Builtopia",
    description: "New home construction management and warranty tracking platform.",
    icon: <Database className="h-6 w-6 text-[#0F3B3D]" />,
    hasSecret: true,
  },
  BUILDERTREND: {
    label: "Buildertrend",
    description: "Cloud-based construction project management for homebuilders.",
    icon: <Zap className="h-6 w-6 text-[#0F3B3D]" />,
    hasSecret: true,
  },
  HYPHEN: {
    label: "Hyphen Solutions",
    description: "Integrated supply chain and homebuilder operations platform.",
    icon: <Plug className="h-6 w-6 text-[#0F3B3D]" />,
    hasSecret: false,
  },
};

const PLATFORMS = ["BUILTOPIA", "BUILDERTREND", "HYPHEN"];

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [forms, setForms] = useState<Record<string, FormState>>({});
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [messages, setMessages] = useState<Record<string, { type: "success" | "error"; text: string }>>({});

  const setMsg = (platform: string, type: "success" | "error", text: string) => {
    setMessages((prev) => ({ ...prev, [platform]: { type, text } }));
    setTimeout(() => setMessages((prev) => { const n = { ...prev }; delete n[platform]; return n; }), 4000);
  };

  const fetchIntegrations = async () => {
    try {
      setIsLoading(true);
      const res = await fetch("/api/integrations");
      if (!res.ok) throw new Error("Failed to load");
      const data: IntegrationStatus[] = await res.json();
      setIntegrations(data);
      // Pre-fill environment selector if already configured
      const initial: Record<string, FormState> = {};
      data.forEach((d) => {
        initial[d.platform] = {
          apiKey: "",
          secretKey: "",
          environment: d.environment ?? "sandbox",
        };
      });
      setForms(initial);
    } catch {
      // silent
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchIntegrations(); }, []);

  const updateForm = (platform: string, field: keyof FormState, value: string) => {
    setForms((prev) => ({ ...prev, [platform]: { ...prev[platform], [field]: value } }));
  };

  const handleSave = async (platform: string) => {
    const form = forms[platform];
    if (!form?.apiKey.trim()) {
      setMsg(platform, "error", "API Key is required");
      return;
    }
    setSaving(platform);
    try {
      const res = await fetch("/api/integrations/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, ...form }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg(platform, "error", data.message || "Failed to save"); return; }
      setMsg(platform, "success", "Credentials saved successfully!");
      setForms((prev) => ({ ...prev, [platform]: { ...prev[platform], apiKey: "", secretKey: "" } }));
      await fetchIntegrations();
    } catch {
      setMsg(platform, "error", "Network error. Please try again.");
    } finally {
      setSaving(null);
    }
  };

  const handleDisconnect = async (platform: string) => {
    if (!confirm(`Remove ${PLATFORM_META[platform]?.label} integration?`)) return;
    setDeleting(platform);
    try {
      const res = await fetch("/api/integrations/credentials", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      if (!res.ok) { setMsg(platform, "error", "Failed to remove"); return; }
      setMsg(platform, "success", "Integration removed.");
      setTestResults((prev) => { const n = { ...prev }; delete n[platform]; return n; });
      await fetchIntegrations();
    } catch {
      setMsg(platform, "error", "Network error.");
    } finally {
      setDeleting(null);
    }
  };

  const handleTest = async (platform: string) => {
    setTesting(platform);
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      const data = await res.json();
      setTestResults((prev) => ({ ...prev, [platform]: data }));
    } catch {
      setTestResults((prev) => ({ ...prev, [platform]: { ok: false, message: "Network error" } }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <PortalLayout>
        <div className="space-y-6 max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                <Plug className="h-8 w-8 text-[#0F3B3D]" />
                Integrations
              </h1>
              <p className="text-muted-foreground mt-1">
                Connect your ERP &amp; CRM systems. Credentials are stored securely in the database.
              </p>
            </div>
            <Button variant="outline" onClick={fetchIntegrations} disabled={isLoading} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {/* 3 Platform Cards */}
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-80 bg-muted animate-pulse rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {PLATFORMS.map((platform, index) => {
                const meta = PLATFORM_META[platform];
                const status = integrations.find((i) => i.platform === platform);
                const form = forms[platform] ?? { apiKey: "", secretKey: "", environment: "sandbox" };
                const testResult = testResults[platform];
                const isTesting = testing === platform;
                const isSaving = saving === platform;
                const isDeleting = deleting === platform;
                const msg = messages[platform];
                const isConfigured = status?.configured ?? false;

                return (
                  <motion.div
                    key={platform}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.08 }}
                    className="flex flex-col"
                  >
                    <Card className={`flex-1 border-2 transition-colors ${isConfigured ? "border-green-200" : "border-gray-200"}`}>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-[#0F3B3D]/10">{meta.icon}</div>
                            <div>
                              <CardTitle className="text-base">{meta.label}</CardTitle>
                              {isConfigured && (
                                <CardDescription className="text-xs">
                                  {status?.environment} · key: {status?.apiKeyMasked}
                                </CardDescription>
                              )}
                            </div>
                          </div>
                          {isConfigured ? (
                            <Badge className="bg-green-100 text-green-800 border-green-200 shrink-0">
                              <Wifi className="h-3 w-3 mr-1" /> Connected
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-gray-500 shrink-0">
                              <WifiOff className="h-3 w-3 mr-1" /> Not set
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{meta.description}</p>
                      </CardHeader>

                      <CardContent className="space-y-3">
                        {/* Message */}
                        <AnimatePresence>
                          {msg && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                            >
                              <Alert variant={msg.type === "error" ? "destructive" : undefined}
                                className={msg.type === "success" ? "border-green-500 bg-green-50" : ""}>
                                <AlertDescription className="text-xs">{msg.text}</AlertDescription>
                              </Alert>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {/* Test result */}
                        <AnimatePresence>
                          {testResult && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              className={`rounded-md px-3 py-2 text-xs flex items-center gap-2 ${
                                testResult.ok
                                  ? "bg-green-50 text-green-700 border border-green-200"
                                  : "bg-red-50 text-red-700 border border-red-200"
                              }`}
                            >
                              {testResult.ok
                                ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                : <XCircle className="h-3.5 w-3.5 shrink-0" />}
                              <span>{testResult.message}</span>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {/* Credential form */}
                        <div className="space-y-2 pt-1">
                          <div>
                            <Label className="text-xs">API Key {isConfigured && <span className="text-muted-foreground">(leave blank to keep existing)</span>}</Label>
                            <Input
                              type="password"
                              placeholder={isConfigured ? "Enter new key to update" : "Enter API key"}
                              value={form.apiKey}
                              onChange={(e) => updateForm(platform, "apiKey", e.target.value)}
                              className="mt-1 text-sm h-8"
                            />
                          </div>

                          {meta.hasSecret && (
                            <div>
                              <Label className="text-xs">Secret Key <span className="text-muted-foreground">(optional)</span></Label>
                              <div className="relative mt-1">
                                <Input
                                  type={showSecret[platform] ? "text" : "password"}
                                  placeholder="Enter secret key"
                                  value={form.secretKey}
                                  onChange={(e) => updateForm(platform, "secretKey", e.target.value)}
                                  className="text-sm h-8 pr-8"
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowSecret((prev) => ({ ...prev, [platform]: !prev[platform] }))}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                                >
                                  {showSecret[platform] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                </button>
                              </div>
                            </div>
                          )}

                          <div>
                            <Label className="text-xs">Environment</Label>
                            <Select
                              value={form.environment}
                              onValueChange={(v) => updateForm(platform, "environment", v)}
                            >
                              <SelectTrigger className="mt-1 h-8 text-sm">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="sandbox">Sandbox</SelectItem>
                                <SelectItem value="production">Production</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            className="flex-1 gap-1.5 text-xs bg-[#0F3B3D] hover:bg-[#0F3B3D]/90"
                            onClick={() => handleSave(platform)}
                            disabled={isSaving || !form.apiKey.trim()}
                          >
                            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                            {isConfigured ? "Update" : "Connect"}
                          </Button>

                          {isConfigured && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="flex-1 gap-1.5 text-xs"
                                onClick={() => handleTest(platform)}
                                disabled={isTesting}
                              >
                                {isTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertCircle className="h-3.5 w-3.5" />}
                                Test
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-red-500 hover:text-red-700 hover:bg-red-50 gap-1.5 text-xs"
                                onClick={() => handleDisconnect(platform)}
                                disabled={isDeleting}
                              >
                                {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                              </Button>
                            </>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
