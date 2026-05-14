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
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  Plus,
  Trash2,
  RefreshCw,
  Plug,
  Zap,
  Database,
  MapPin,
} from "lucide-react";
import { motion } from "framer-motion";

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const fetchIntegrations = async () => {
    try {
      const res = await fetch("/api/integrations");
      const data = await res.json();
      setIntegrations(data.status ? [data] : []);
    } catch (err) {
      console.error("Error fetching integrations:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchIntegrations();
  }, []);

  const handleConnect = async () => {
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: selected, apiKey }),
      });
      if (res.ok) {
        fetchIntegrations();
        setOpen(false);
      }
    } catch (err) {
      console.error("Error connecting:", err);
    }
  };

  const handleSync = async (id: string) => {
    try {
      // Simulate sync for the whole integration or a specific ticket
      await fetch("/api/integrations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integrationId: id }),
      });
      fetchIntegrations();
    } catch (err) {
      console.error("Error syncing:", err);
    }
  };

  const getStatusBadge = (s: string) => {
    if (s === "connected")
      return <Badge className="bg-green-100 text-green-800">Connected</Badge>;
    if (s === "disconnected")
      return <Badge className="bg-gray-100 text-gray-800">Disconnected</Badge>;
    if (s === "syncing")
      return (
        <Badge className="bg-yellow-100 text-yellow-800">Syncing...</Badge>
      );
    return <Badge variant="outline">{s}</Badge>;
  };

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <PortalLayout>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-6"
        >
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-primary">Integrations</h1>
              <p className="text-muted-foreground">Connect CRM/ERP systems</p>
            </div>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Integration
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Connect a System</DialogTitle>
                  <DialogDescription>
                    Select platform and enter API key
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <Label>Platform</Label>
                  <Select onValueChange={setSelected}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Builtopia">Builtopia</SelectItem>
                      <SelectItem value="Buildertrend">Buildertrend</SelectItem>
                      <SelectItem value="Hyphen">Hyphen</SelectItem>
                    </SelectContent>
                  </Select>
                  <Label>API Key</Label>
                  <Input
                    placeholder="Enter API key"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleConnect}>Connect</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {integrations.map((i) => (
              <Card key={i.platform}>
                <CardHeader>
                  <div className="flex justify-between">
                    <div className="flex gap-3">
                      <div className="rounded-lg bg-primary/10 p-2">
                        {i.platform === "Builtopia" ? (
                          <Database className="h-6 w-6 text-primary" />
                        ) : (
                          <Zap className="h-6 w-6 text-primary" />
                        )}
                      </div>
                      <div>
                        <CardTitle>{i.platform}</CardTitle>
                        <CardDescription>ERP/CRM</CardDescription>
                      </div>
                    </div>
                    {getStatusBadge(i.status.toLowerCase())}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm">
                    <span className="text-muted-foreground">Last sync:</span>{" "}
                    {i.lastSync
                      ? new Date(i.lastSync).toLocaleString()
                      : "Never"}
                  </p>
                  <p className="text-sm">
                    <span className="text-muted-foreground">Auth:</span>{" "}
                    {i.authType}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSync(i.id)}
                    >
                      <RefreshCw className="mr-2 h-3 w-3" />
                      Sync
                    </Button>
                    <Button variant="outline" size="sm">
                      <MapPin className="mr-2 h-3 w-3" />
                      Map Fields
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="border-l-4 border-l-secondary bg-secondary/5">
            <CardHeader>
              <CardTitle className="flex gap-2">
                <Zap className="h-5 w-5 text-secondary" />
                Phase 2 Coming Soon
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">
                Webhooks, conditional field mapping, bulk sync.
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
