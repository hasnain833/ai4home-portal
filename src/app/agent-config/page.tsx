"use client";

import { useState, useEffect } from "react";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Save,
  Play,
  History,
  CheckCircle2,
  Loader2,
  RefreshCw,
  AlertCircle,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Types
interface ConfigVersion {
  id: string;
  version: string;
  prompt: string;
  greeting: string;
  escalation: string;
  createdAt: string;
  isActive: boolean;
}

interface AgentConfig {
  prompt: string;
  greeting: string;
  escalation: string;
}

// Animation variants
const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4 } },
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.1 },
  },
};

const buttonVariants = {
  tap: { scale: 0.97 },
  hover: { scale: 1.02, transition: { duration: 0.2 } },
};

const cardVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 20 },
};

// Helper to generate next version number
const getNextVersion = (versions: ConfigVersion[]): string => {
  const activeVersion = versions.find((v) => v.isActive);
  if (!activeVersion) return "v1.0";
  const match = activeVersion.version.match(/v(\d+)\.(\d+)/);
  if (match) {
    const major = parseInt(match[1]);
    const minor = parseInt(match[2]);
    return `v${major}.${minor + 1}`;
  }
  return "v1.0";
};

// Simulate AI response based on current config
const generateMockResponse = (
  userMessage: string,
  config: AgentConfig,
): string => {
  const lowerMessage = userMessage.toLowerCase();
  const hasEmergency =
    lowerMessage.includes("leak") ||
    lowerMessage.includes("flood") ||
    lowerMessage.includes("emergency");
  const hasComplaint =
    lowerMessage.includes("broken") ||
    lowerMessage.includes("not working") ||
    lowerMessage.includes("issue");

  // Use the escalation message for serious issues
  if (hasEmergency) {
    return `${config.escalation} In the meantime, please turn off the main water supply if possible.`;
  }

  // Use the system prompt to guide tone
  const isAntiLitigation = config.prompt
    .toLowerCase()
    .includes("never admit liability");
  const liabilityNote = isAntiLitigation
    ? "We'll review this according to your warranty terms."
    : "Let me check how we can help.";

  if (hasComplaint) {
    return `Thank you for letting me know. ${liabilityNote} I've logged your concern and a technician will contact you within 48 hours.`;
  }

  // Use greeting for general inquiries
  return `${config.greeting.replace(/{{homeownerName}}/g, "Homeowner")} How can I assist you further?`;
};

export default function AgentConfigPage() {
  // Configuration state
  const [prompt, setPrompt] = useState("");
  const [greeting, setGreeting] = useState("");
  const [escalation, setEscalation] = useState("");

  // UI state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<
    "prompt" | "greeting" | "escalation" | null
  >(null);
  const [toastMessage, setToastMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const [testMessage, setTestMessage] = useState("");
  const [testResponse, setTestResponse] = useState("");
  const [testing, setTesting] = useState(false);
  const [versions, setVersions] = useState<ConfigVersion[]>([]);
  const [activeTab, setActiveTab] = useState("prompt");

  // Load from API on mount
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/agent-config");
        if (response.ok) {
          const data: any[] = await response.json();
          const configs: ConfigVersion[] = data.map(d => ({
            id: d.id,
            version: d.version,
            prompt: d.systemPrompt,
            greeting: d.greetingMessage,
            escalation: d.escalationMessage,
            createdAt: d.createdAt,
            isActive: d.isActive
          }));
          setVersions(configs);
          const active = configs.find((v) => v.isActive);
          if (active) {
            setPrompt(active.prompt);
            setGreeting(active.greeting);
            setEscalation(active.escalation);
          }
        }
      } catch (error) {
        console.error("Failed to load agent config:", error);
        showToast("error", "Failed to load configuration");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // Show toast notification
  const showToast = (type: "success" | "error" | "info", text: string) => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Save a specific configuration
  const handleSave = async (type: "prompt" | "greeting" | "escalation") => {
    setSaving(type);
    try {
      const response = await fetch("/api/agent-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: prompt,
          greetingMessage: greeting,
          escalationMessage: escalation,
        }),
      });

      if (response.ok) {
        const d = await response.json();
        const newVersion: ConfigVersion = {
          id: d.id,
          version: d.version,
          prompt: d.systemPrompt,
          greeting: d.greetingMessage,
          escalation: d.escalationMessage,
          createdAt: d.createdAt,
          isActive: d.isActive
        };

        // Deactivate previous active versions and add new one
        setVersions(prev => {
          const updated = prev.map(v => ({ ...v, isActive: false }));
          return [newVersion, ...updated];
        });
        showToast("success", `Configuration saved as ${newVersion.version}`);
      } else {
        showToast("error", "Failed to save configuration");
      }
    } catch (error) {
      showToast("error", "Error saving to database");
    } finally {
      setSaving(null);
    }
  };

  // Rollback to a specific version
  const handleRollback = async (version: ConfigVersion) => {
    // In this demo, rollback just updates the UI and saves it as a new version
    setPrompt(version.prompt);
    setGreeting(version.greeting);
    setEscalation(version.escalation);

    showToast("info", "Settings loaded from history. Click Save to activate.");
  };

  // Test the agent with current config
  const handleTest = async () => {
    if (!testMessage.trim()) {
      showToast("error", "Please enter a test message");
      return;
    }
    setTesting(true);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const response = generateMockResponse(testMessage, {
      prompt,
      greeting,
      escalation,
    });
    setTestResponse(response);
    setTesting(false);
  };

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <PortalLayout>
        {/* Toast Notifications */}
        <AnimatePresence>
          {toastMessage && (
            <motion.div
              initial={{ opacity: 0, y: -50, x: "-50%" }}
              animate={{ opacity: 1, y: 0, x: "-50%" }}
              exit={{ opacity: 0, y: -50, x: "-50%" }}
              className={`fixed top-20 left-1/2 transform -translate-x-1/2 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 ${toastMessage.type === "success"
                ? "bg-green-50 dark:bg-green-900/80 text-green-800 dark:text-green-200 border border-green-200"
                : toastMessage.type === "error"
                  ? "bg-red-50 dark:bg-red-900/80 text-red-800 dark:text-red-200 border border-red-200"
                  : "bg-blue-50 dark:bg-blue-900/80 text-blue-800 dark:text-blue-200 border border-blue-200"
                }`}
            >
              {toastMessage.type === "success" && (
                <CheckCircle2 className="h-5 w-5" />
              )}
              {toastMessage.type === "error" && (
                <AlertCircle className="h-5 w-5" />
              )}
              {toastMessage.type === "info" && (
                <RefreshCw className="h-5 w-5" />
              )}
              <span className="text-sm font-medium">{toastMessage.text}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="space-y-6 p-4 sm:p-6 md:p-8 max-w-5xl mx-auto"
        >
          {/* Header */}
          <motion.div variants={fadeInUp}>
            <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
              Agent Configuration
            </h1>
            <p className="text-muted-foreground text-sm md:text-base mt-1">
              Customize agent behavior, prompts, and manage version history
            </p>
          </motion.div>

          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2 md:grid-cols-5 gap-2 bg-muted/50 p-1">
              <TabsTrigger value="prompt">System Prompt</TabsTrigger>
              <TabsTrigger value="greeting">Greeting</TabsTrigger>
              <TabsTrigger value="escalation">Escalation</TabsTrigger>
              <TabsTrigger value="test">Test Mode</TabsTrigger>
              <TabsTrigger value="versions">Versions</TabsTrigger>
            </TabsList>

            {/* System Prompt Tab */}
            <TabsContent value="prompt" className="mt-6">
              <motion.div variants={fadeInUp}>
                <Card className="shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-primary" />
                      System Prompt
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Controls the agent's core behavior, tone, and rules. Use{" "}
                      {"{{companyName}}"} as a variable.
                    </p>
                    <Textarea
                      rows={8}
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      className="font-mono text-sm"
                      placeholder="Enter system prompt..."
                    />
                    <div className="flex justify-end">
                      <motion.div
                        variants={buttonVariants}
                        whileTap="tap"
                        whileHover="hover"
                      >
                        <Button
                          onClick={() => handleSave("prompt")}
                          disabled={saving === "prompt"}
                        >
                          {saving === "prompt" ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="mr-2 h-4 w-4" />
                          )}
                          Save Prompt
                        </Button>
                      </motion.div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </TabsContent>

            {/* Greeting Tab */}
            <TabsContent value="greeting" className="mt-6">
              <motion.div variants={fadeInUp}>
                <Card className="shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-primary" />
                      Initial Greeting
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      The first message sent to a homeowner. Use{" "}
                      {"{{homeownerName}}"} as a variable.
                    </p>
                    <Textarea
                      rows={4}
                      value={greeting}
                      onChange={(e) => setGreeting(e.target.value)}
                      className="font-mono text-sm"
                    />
                    <div className="flex justify-end">
                      <motion.div
                        variants={buttonVariants}
                        whileTap="tap"
                        whileHover="hover"
                      >
                        <Button
                          onClick={() => handleSave("greeting")}
                          disabled={saving === "greeting"}
                        >
                          {saving === "greeting" ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="mr-2 h-4 w-4" />
                          )}
                          Save Greeting
                        </Button>
                      </motion.div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </TabsContent>

            {/* Escalation Tab */}
            <TabsContent value="escalation" className="mt-6">
              <motion.div variants={fadeInUp}>
                <Card className="shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-primary" />
                      Escalation Message
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Used when the agent cannot resolve an issue or when a
                      human is needed.
                    </p>
                    <Textarea
                      rows={4}
                      value={escalation}
                      onChange={(e) => setEscalation(e.target.value)}
                      className="font-mono text-sm"
                    />
                    <div className="flex justify-end">
                      <motion.div
                        variants={buttonVariants}
                        whileTap="tap"
                        whileHover="hover"
                      >
                        <Button
                          onClick={() => handleSave("escalation")}
                          disabled={saving === "escalation"}
                        >
                          {saving === "escalation" ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="mr-2 h-4 w-4" />
                          )}
                          Save Escalation
                        </Button>
                      </motion.div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </TabsContent>

            {/* Test Mode Tab */}
            <TabsContent value="test" className="mt-6">
              <motion.div variants={fadeInUp}>
                <Card className="shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Play className="h-5 w-5 text-primary" />
                      Test Agent
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>Simulate Homeowner Message</Label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="e.g., My dishwasher is leaking"
                          value={testMessage}
                          onChange={(e) => setTestMessage(e.target.value)}
                          className="flex-1"
                          onKeyDown={(e) => e.key === "Enter" && handleTest()}
                        />
                        <motion.div
                          variants={buttonVariants}
                          whileTap="tap"
                          whileHover="hover"
                        >
                          <Button onClick={handleTest} disabled={testing}>
                            {testing ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Play className="mr-2 h-4 w-4" />
                            )}
                            Test
                          </Button>
                        </motion.div>
                      </div>
                    </div>
                    <AnimatePresence>
                      {testResponse && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                        >
                          <Card className="bg-primary/5 border-primary/20">
                            <CardContent className="pt-4">
                              <p className="font-semibold flex items-center gap-2 mb-2">
                                <Sparkles className="h-4 w-4 text-primary" />
                                Agent Response:
                              </p>
                              <p className="text-sm leading-relaxed">
                                {testResponse}
                              </p>
                            </CardContent>
                          </Card>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground">
                      <p className="font-medium mb-1">ℹ️ Test Mode Notes</p>
                      <p>
                        This simulation uses your current saved prompts and will
                        reflect anti‑litigation rules, greeting, and escalation
                        logic.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </TabsContent>

            {/* Versions Tab */}
            <TabsContent value="versions" className="mt-6">
              <motion.div variants={fadeInUp}>
                <Card className="shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <History className="h-5 w-5 text-primary" />
                      Version History
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <AnimatePresence mode="popLayout">
                      {versions.length === 0 ? (
                        <p className="text-center text-muted-foreground py-8">
                          No versions available
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {versions
                            .sort(
                              (a, b) =>
                                new Date(b.createdAt).getTime() -
                                new Date(a.createdAt).getTime(),
                            )
                            .map((version, idx) => (
                              <motion.div
                                key={version.id}
                                variants={cardVariants}
                                initial="hidden"
                                animate="visible"
                                exit="exit"
                                layout
                                className={`flex justify-between items-center p-4 rounded-lg border transition-all ${version.isActive
                                  ? "border-primary/50 bg-primary/5 shadow-sm"
                                  : "border-border hover:bg-muted/20"
                                  }`}
                              >
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="font-semibold">
                                      {version.version}
                                    </p>
                                    {version.isActive && (
                                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30">
                                        Active
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    Saved:{" "}
                                    {new Date(
                                      version.createdAt,
                                    ).toLocaleString()}
                                  </p>
                                  <p className="text-xs text-muted-foreground line-clamp-1 mt-1">
                                    Prompt: {version.prompt.substring(0, 60)}...
                                  </p>
                                </div>
                                {!version.isActive && (
                                  <motion.div
                                    variants={buttonVariants}
                                    whileTap="tap"
                                    whileHover="hover"
                                  >
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleRollback(version)}
                                      className="gap-1"
                                    >
                                      <RotateCcw className="h-3 w-3" />
                                      Rollback
                                    </Button>
                                  </motion.div>
                                )}
                              </motion.div>
                            ))}
                        </div>
                      )}
                    </AnimatePresence>
                  </CardContent>
                </Card>
              </motion.div>
            </TabsContent>
          </Tabs>
        </motion.div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
