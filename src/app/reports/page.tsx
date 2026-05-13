"use client";

import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart3,
  Download,
  TrendingUp,
  Ticket,
  Clock,
  Zap,
} from "lucide-react";
import { motion } from "framer-motion";

export default function ReportsPage() {
  return (
    <ProtectedRoute allowedRoles={["admin", "staff"]}>
      <PortalLayout>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-6"
        >
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-primary">
                Reports & Analytics
              </h1>
              <p className="text-muted-foreground">KPI dashboards and export</p>
            </div>
            <div className="flex gap-2">
              <Select defaultValue="7d">
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="Period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="90d">Last 90 days</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline">
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
            </div>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Auto‑Resolution Rate</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">68%</div>
                <p className="text-xs text-green-600">↑ 5% from last month</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Avg Response Time</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">2.4 min</div>
                <p className="text-xs text-green-600">↓ 0.3 min</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Tokens per Claim</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">1,245</div>
                <p className="text-xs text-muted-foreground">
                  ~$0.03 per claim
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Customer Satisfaction</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">4.8/5</div>
                <p className="text-xs text-green-600">Based on 42 surveys</p>
              </CardContent>
            </Card>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Tickets by Issue Type</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>HVAC</span>
                    <span>32%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full"
                      style={{ width: "32%" }}
                    ></div>
                  </div>
                  <div className="flex justify-between">
                    <span>Plumbing</span>
                    <span>24%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full"
                      style={{ width: "24%" }}
                    ></div>
                  </div>
                  <div className="flex justify-between">
                    <span>Electrical</span>
                    <span>18%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full"
                      style={{ width: "18%" }}
                    ></div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Agent Performance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span>Auto‑resolved</span>
                    <span className="font-bold">68%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Escalated to staff</span>
                    <span className="font-bold">27%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>DIY guidance</span>
                    <span className="font-bold">42%</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          <Card className="border-l-4 border-l-secondary">
            <CardHeader>
              <CardTitle className="flex gap-2">
                <Zap className="h-5 w-5 text-secondary" />
                Phase 2 Enhanced Analytics
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">
                Coming soon: per‑agent token cost, survey‑readiness scoring,
                custom date ranges, and real‑time dashboards.
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
