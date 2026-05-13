"use client";

import { useState } from "react";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Save, Play, History, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";

export default function AgentConfigPage() {
  const [prompt, setPrompt] = useState(
    `You are a warranty care agent for {{companyName}}. Greet the homeowner warmly. Never admit liability. Use survey-positive language.`,
  );
  const [greeting, setGreeting] = useState(
    `Hello {{homeownerName}}! Congratulations on your new home. How can I help with your warranty today?`,
  );
  const [escalation, setEscalation] = useState(
    `I'm connecting you with a warranty specialist. They'll have all your details.`,
  );
  const [testMessage, setTestMessage] = useState("");
  const [testResponse, setTestResponse] = useState("");

  const handleTest = () => {
    setTestResponse(
      "Thank you for reaching out. I see your issue and will escalate this to our team. (This is a test response – your actual agent would reply here.)",
    );
  };

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <PortalLayout>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-6"
        >
          <div>
            <h1 className="text-3xl font-bold text-primary">
              Agent Configuration
            </h1>
            <p className="text-muted-foreground">
              Customize agent behavior and prompts
            </p>
          </div>
          <Tabs defaultValue="prompt" className="w-full">
            <TabsList>
              <TabsTrigger value="prompt">System Prompt</TabsTrigger>
              <TabsTrigger value="greeting">Greeting</TabsTrigger>
              <TabsTrigger value="escalation">Escalation</TabsTrigger>
              <TabsTrigger value="test">Test Mode</TabsTrigger>
              <TabsTrigger value="versions">Versions</TabsTrigger>
            </TabsList>
            <TabsContent value="prompt" className="space-y-4 mt-4">
              <Label>System Prompt (anti‑litigation, survey‑positive)</Label>
              <Textarea
                rows={8}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
              <div className="flex justify-end">
                <Button>
                  <Save className="mr-2 h-4 w-4" />
                  Save Prompt
                </Button>
              </div>
            </TabsContent>
            <TabsContent value="greeting" className="space-y-4 mt-4">
              <Label>Initial Greeting</Label>
              <Textarea
                rows={4}
                value={greeting}
                onChange={(e) => setGreeting(e.target.value)}
              />
              <Button>
                <Save className="mr-2 h-4 w-4" />
                Save
              </Button>
            </TabsContent>
            <TabsContent value="escalation" className="space-y-4 mt-4">
              <Label>Escalation Message</Label>
              <Textarea
                rows={4}
                value={escalation}
                onChange={(e) => setEscalation(e.target.value)}
              />
              <Button>
                <Save className="mr-2 h-4 w-4" />
                Save
              </Button>
            </TabsContent>
            <TabsContent value="test" className="space-y-4 mt-4">
              <Label>Simulate Homeowner Message</Label>
              <Input
                placeholder="e.g., My dishwasher is leaking"
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
              />
              <Button onClick={handleTest}>
                <Play className="mr-2 h-4 w-4" />
                Test Agent
              </Button>
              {testResponse && (
                <Card className="mt-4 bg-muted">
                  <CardContent className="pt-4">
                    <p className="font-semibold">Agent Response:</p>
                    <p>{testResponse}</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
            <TabsContent value="versions" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Version History</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-2 border rounded">
                      <div>
                        <p className="font-medium">v1.2 - Production</p>
                        <p className="text-xs text-muted-foreground">
                          Saved May 10, 2026
                        </p>
                      </div>
                      <Badge variant="default">Active</Badge>
                    </div>
                    <div className="flex justify-between items-center p-2 border rounded">
                      <div>
                        <p className="font-medium">v1.1</p>
                        <p className="text-xs text-muted-foreground">
                          Saved May 5, 2026
                        </p>
                      </div>
                      <Button variant="ghost" size="sm">
                        Rollback
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </motion.div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
