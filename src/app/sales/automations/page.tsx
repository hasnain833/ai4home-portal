"use client";

import { useState, useEffect, useCallback } from "react";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Play,
  Settings,
  Plus,
  Trash2,
  GitFork,
  ArrowRight,
  ShieldCheck,
  Zap,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

interface AutomationRule {
  id: string;
  name: string;
  description: string;
  trigger: {
    event: string;
    description: string;
  };
  conditions: Array<{
    field: string;
    operator: string;
    value: string;
  }>;
  actions: Array<{
    type: string;
    params: Record<string, string>;
  }>;
  isActive: boolean;
  rateLimitCount: number;
  rateLimitWindow: "HOUR" | "DAY" | "WEEK";
  cooldownPeriod: number; // in hours (loop prevention)
  lastTriggered?: string;
  totalRuns: number;
}

// No seeded rules — the automation engine (SW-AMK) backend is not built yet, so this
// list starts empty rather than showing fabricated automations with fake run counts.
const initialRules: AutomationRule[] = [];

const standardTriggers = [
  { value: "LEAD_REPLIED", label: "Prospect Replied (Email/SMS)", desc: "Triggers when a client responds to outreach." },
  { value: "CRM_INGEST", label: "Salesforce Lead Synchronized", desc: "Triggers when a record imports from CRM." },
  { value: "STATUS_CHANGE", label: "Lead Status Shifted", desc: "Triggers when sales stage changes." },
  { value: "MANUAL_CREATION", label: "Manual Contact Ingested", desc: "Triggers when contact is added in portal." },
  { value: "OUTBOUND_SMS_TRIGGERED", label: "Outbound Automated SMS queued", desc: "Intercepts outgoing SMS broadcasts." }
];

const standardActions = [
  { value: "PAUSE_CAMPAIGNS", label: "Pause Active Campaigns", params: ["reason"] },
  { value: "ENROLL_CAMPAIGN", label: "Enroll in Campaign", params: ["campaignId", "campaignName"] },
  { value: "NOTIFY_OWNER", label: "Send Agent Alert Notification", params: ["channels", "priority"] },
  { value: "UPDATE_STATUS", label: "Modify Outreach Status", params: ["newStatus"] },
  { value: "DELAY_DELIVERY", label: "Delay Delivery Until Window", params: ["resumeTime"] }
];

const fadeInUp = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } }
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 }
  }
};

export default function AutomationsPage() {
  const [rules, setRules] = useState<AutomationRule[]>(initialRules);
  const [killSwitch, setKillSwitch] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [selectedRule, setSelectedRule] = useState<AutomationRule | null>(null);

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch("/api/sales/automations");
      if (res.ok) {
        const data = await res.json();
        setRules(Array.isArray(data.rules) ? data.rules : []);
        setKillSwitch(!!data.killSwitch);
      }
    } catch {
      // surfaced on actions
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const toggleKillSwitch = async () => {
    try {
      const res = await fetch("/api/sales/automations/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ killSwitch: !killSwitch }),
      });
      if (res.ok) {
        const data = await res.json();
        setKillSwitch(!!data.killSwitch);
        toast.success(data.killSwitch ? "All automations paused (kill switch ON)." : "Kill switch OFF — automations resumed.");
      } else {
        toast.error("Could not update the kill switch.");
      }
    } catch {
      toast.error("Network error.");
    }
  };

  // Form State
  const [ruleName, setRuleName] = useState("");
  const [ruleDescription, setRuleDescription] = useState("");
  const [ruleTrigger, setRuleTrigger] = useState("LEAD_REPLIED");
  const [ruleConditions, setRuleConditions] = useState<AutomationRule["conditions"]>([]);
  const [ruleActions, setRuleActions] = useState<AutomationRule["actions"]>([]);
  const [ruleRateLimitCount, setRuleRateLimitCount] = useState(1);
  const [ruleRateLimitWindow, setRuleRateLimitWindow] = useState<"HOUR" | "DAY" | "WEEK">("DAY");
  const [ruleCooldown, setRuleCooldown] = useState(24);

  const handleOpenRuleModal = (rule?: AutomationRule) => {
    if (rule) {
      setSelectedRule(rule);
      setRuleName(rule.name);
      setRuleDescription(rule.description);
      setRuleTrigger(rule.trigger.event);
      setRuleConditions(rule.conditions);
      setRuleActions(rule.actions);
      setRuleRateLimitCount(rule.rateLimitCount);
      setRuleRateLimitWindow(rule.rateLimitWindow);
      setRuleCooldown(rule.cooldownPeriod);
    } else {
      setSelectedRule(null);
      setRuleName("");
      setRuleDescription("");
      setRuleTrigger("LEAD_REPLIED");
      setRuleConditions([{ field: "status", operator: "EQUALS", value: "Nurturing" }]);
      setRuleActions([{ type: "PAUSE_CAMPAIGNS", params: { reason: "User Replied" } }]);
      setRuleRateLimitCount(1);
      setRuleRateLimitWindow("DAY");
      setRuleCooldown(24);
    }
    setRuleModalOpen(true);
  };

  const handleSaveRule = async () => {
    if (!ruleName.trim()) {
      toast.error("Automation rule name is required.");
      return;
    }
    if (saving) return;
    setSaving(true);

    const payload = {
      name: ruleName,
      description: ruleDescription,
      triggerEvent: ruleTrigger,
      conditions: ruleConditions,
      actions: ruleActions,
      rateLimitCount: ruleRateLimitCount,
      rateLimitWindow: ruleRateLimitWindow,
      cooldownHours: ruleCooldown,
    };

    try {
      const res = selectedRule
        ? await fetch(`/api/sales/automations/${selectedRule.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/sales/automations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message || "Failed to save automation.");
        return;
      }
      toast.success(selectedRule ? "Automation updated." : "Automation created (inactive — activate it when ready).");
      setRuleModalOpen(false);
      fetchRules();
    } catch {
      toast.error("Network error while saving.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRule = async (id: string) => {
    if (!confirm("Delete this automation rule? This will stop it from running.")) return;
    try {
      const res = await fetch(`/api/sales/automations/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Automation deleted.");
        setRuleModalOpen(false);
        fetchRules();
      } else {
        toast.error("Could not delete the automation.");
      }
    } catch {
      toast.error("Network error.");
    }
  };

  const toggleRuleActive = async (id: string) => {
    const rule = rules.find((r) => r.id === id);
    try {
      const res = await fetch(`/api/sales/automations/${id}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: rule ? !rule.isActive : true }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message || "Could not update the automation.");
        return;
      }
      fetchRules();
    } catch {
      toast.error("Network error.");
    }
  };

  const addConditionRow = () => {
    setRuleConditions(prev => [...prev, { field: "status", operator: "EQUALS", value: "New" }]);
  };

  const removeConditionRow = (idx: number) => {
    setRuleConditions(prev => prev.filter((_, i) => i !== idx));
  };

  const handleConditionChange = (idx: number, key: string, val: string) => {
    setRuleConditions(prev =>
      prev.map((c, i) => (i === idx ? { ...c, [key]: val } : c))
    );
  };

  const addActionRow = () => {
    setRuleActions(prev => [...prev, { type: "NOTIFY_OWNER", params: { channels: "SMS" } }]);
  };

  const removeActionRow = (idx: number) => {
    setRuleActions(prev => prev.filter((_, i) => i !== idx));
  };

  const handleActionChange = (idx: number, type: string) => {
    const matched = standardActions.find(a => a.value === type);
    const params: Record<string, string> = {};
    matched?.params.forEach(p => {
      params[p] = "";
    });
    setRuleActions(prev =>
      prev.map((a, i) => (i === idx ? { type, params } : a))
    );
  };

  const handleActionParamChange = (actionIdx: number, paramKey: string, val: string) => {
    setRuleActions(prev =>
      prev.map((a, i) => {
        if (i === actionIdx) {
          return {
            ...a,
            params: {
              ...a.params,
              [paramKey]: val
            }
          };
        }
        return a;
      })
    );
  };

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <PortalLayout workspace="sales">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="space-y-6 max-w-7xl mx-auto"
        >
          {/* Header */}
          <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
                Workflow Automation Builder
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                Configure automated rules (Trigger → Condition → Action) to coordinate campaign enrollment and Salesforce routing.
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <Button
                variant="outline"
                onClick={toggleKillSwitch}
                className={`gap-2 h-9 text-xs font-semibold ${killSwitch ? "border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20" : "text-muted-foreground"}`}
                title="Instantly pause or resume ALL automations for your account"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                {killSwitch ? "Automations Paused — Resume" : "Kill Switch"}
              </Button>
              <Button onClick={() => handleOpenRuleModal()} className="bg-[#b48c3c] text-white hover:bg-[#b48c3c]/90 gap-2 h-9 border-none">
                <Plus className="h-4 w-4" /> Create Automation Rule
              </Button>
            </div>
          </motion.div>

          {killSwitch && (
            <motion.div variants={fadeInUp} className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900/40 px-4 py-3 text-sm text-red-700 dark:text-red-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              The kill switch is ON — no automations will run for your account until you turn it off.
            </motion.div>
          )}

          {/* Compliance & Safeguard Banner */}
          <motion.div variants={fadeInUp}>
            <Card className="bg-[#0F3B3D]/5 border border-l-4 border-l-[#b48c3c]/80 text-[#0F3B3D] dark:text-[#a0c5c7]">
              <CardContent className="py-4 flex flex-col sm:flex-row items-start gap-3">
                <ShieldCheck className="h-5 w-5 text-[#b48c3c] shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-xs">Automated Compliance Guardrails Active</h4>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
                    Every automation automatically respects quiet hours (9:00 PM to 8:00 AM recipient timezone) and checks suppression lists before executing text messages. Loop-prevention cooling thresholds block recursive execution chains.
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* List of Rules */}
          <motion.div variants={fadeInUp} className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Visual Canvas Representation */}
            <div className="lg:col-span-2 space-y-4">
              {rules.map((rule) => (
                <Card key={rule.id} className={`overflow-hidden border transition-all ${rule.isActive ? "border-border shadow-xs" : "border-dashed opacity-75 bg-slate-50/20"
                  }`}>
                  <CardHeader className="pb-3 border-b border-border/40 bg-slate-50/50 dark:bg-slate-900/35">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-muted-foreground">{rule.id}</span>
                        <CardTitle className="text-sm font-bold text-slate-800 dark:text-slate-100">{rule.name}</CardTitle>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className={`text-[10px] font-semibold ${rule.isActive ? "border-green-300 text-green-700 bg-green-50/30" : "border-gray-300 text-gray-500"
                          }`}>
                          {rule.isActive ? "Active Monitoring" : "Paused"}
                        </Badge>

                        {/* Custom Switch Toggle */}
                        <button
                          onClick={() => toggleRuleActive(rule.id)}
                          className={`w-9 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-colors outline-hidden ${rule.isActive ? "bg-green-600" : "bg-slate-300"
                            }`}
                        >
                          <div className={`bg-white w-4 h-4 rounded-full shadow-xs transform transition-transform ${rule.isActive ? "translate-x-4" : "translate-x-0"
                            }`} />
                        </button>
                      </div>
                    </div>
                    <CardDescription className="text-xs mt-1 leading-relaxed">
                      {rule.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 space-y-4">

                    {/* Visual T-C-A steps cards */}
                    <div className="grid grid-cols-1 md:grid-cols-11 items-center gap-2 text-xs">

                      {/* Trigger Block */}
                      <div className="md:col-span-3 p-3 bg-indigo-50/50 dark:bg-indigo-950/10 border border-indigo-200/50 rounded-xl">
                        <p className="text-[10px] font-mono uppercase font-bold text-indigo-500 flex items-center gap-1">
                          <Zap className="h-3 w-3" /> Trigger Event
                        </p>
                        <p className="font-bold text-slate-800 dark:text-slate-200 mt-1">{rule.trigger.event}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{rule.trigger.description}</p>
                      </div>

                      <div className="md:col-span-1 flex justify-center text-slate-400">
                        <ArrowRight className="h-4 w-4 rotate-90 md:rotate-0" />
                      </div>

                      {/* Condition Block */}
                      <div className="md:col-span-3 p-3 bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200/50 rounded-xl">
                        <p className="text-[10px] font-mono uppercase font-bold text-amber-500 flex items-center gap-1">
                          <GitFork className="h-3 w-3" /> Filter Conditions
                        </p>
                        {rule.conditions.length > 0 ? (
                          <div className="space-y-1 mt-1 font-semibold text-slate-800 dark:text-slate-200">
                            {rule.conditions.map((cond, i) => (
                              <p key={i} className="text-[11px]">
                                {cond.field} <span className="text-amber-600 font-mono text-[9px]">{cond.operator}</span> "{cond.value}"
                              </p>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[10px] text-muted-foreground mt-1">Execute unconditionally</p>
                        )}
                      </div>

                      <div className="md:col-span-1 flex justify-center text-slate-400">
                        <ArrowRight className="h-4 w-4 rotate-90 md:rotate-0" />
                      </div>

                      {/* Action Block */}
                      <div className="md:col-span-3 p-3 bg-green-50/50 dark:bg-green-950/10 border border-green-200/50 rounded-xl">
                        <p className="text-[10px] font-mono uppercase font-bold text-green-500 flex items-center gap-1">
                          <Play className="h-3 w-3" /> Actions ( {rule.actions.length} )
                        </p>
                        <div className="mt-1 space-y-1 font-bold">
                          {rule.actions.map((act, i) => (
                            <div key={i} className="text-[11px] text-slate-800 dark:text-slate-200">
                              • {act.type}
                              {Object.keys(act.params).length > 0 && (
                                <span className="block text-[9px] font-mono text-slate-400 font-medium pl-2">
                                  {JSON.stringify(act.params).replace(/[{}"]/g, "")}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                    </div>

                    {/* Footer Limits */}
                    <div className="flex flex-wrap justify-between items-center pt-3 border-t border-dashed border-border/80 text-[10px] text-muted-foreground">
                      <div className="flex gap-4">
                        <p className="flex items-center gap-1">
                          <ShieldCheck className="h-3 w-3 text-[#b48c3c]" /> Limit: <strong>{rule.rateLimitCount} run/{rule.rateLimitWindow}</strong>
                        </p>
                        <p className="flex items-center gap-1">
                          <Clock className="h-3 w-3 text-[#0F3B3D]" /> Cooldown: <strong>{rule.cooldownPeriod}h</strong>
                        </p>
                        {rule.lastTriggered && (
                          <p className="text-slate-400">Last run: {rule.lastTriggered}</p>
                        )}
                      </div>
                      <div className="flex gap-2 items-center">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">Runs: {rule.totalRuns}</span>
                        <Button variant="ghost" size="sm" onClick={() => handleOpenRuleModal(rule)} className="h-7 px-2 text-[#b48c3c] hover:bg-[#b48c3c]/10 text-xs">
                          Edit Rule
                        </Button>
                      </div>
                    </div>

                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Sidebar Guidelines */}
            <div className="space-y-6">

              {/* Trigger list helper */}
              <Card className="border border-border/80 shadow-xs">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Zap className="h-4.5 w-4.5 text-indigo-500" />
                    Available Inbound Webhooks
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3.5 text-xs">
                  {standardTriggers.map((t) => (
                    <div key={t.value} className="space-y-1">
                      <p className="font-bold text-slate-800 dark:text-slate-200 flex justify-between">
                        <span>{t.label}</span>
                        <span className="font-mono text-[9px] text-[#b48c3c]">{t.value}</span>
                      </p>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">{t.desc}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Loop prevention advice */}
              <Card className="border border-border/60">
                <CardContent className="p-4 space-y-2.5">
                  <div className="flex items-center gap-2 text-amber-600 font-bold text-xs">
                    <AlertTriangle className="h-4 w-4" />
                    Loop-Prevention Safe Mode
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Recursive loops (e.g. Rule A modifies status $\rightarrow$ triggers Rule B $\rightarrow$ Rule B modifies status $\rightarrow$ triggers Rule A) are detected automatically. The engine blocks execution when a single contact trips the same rule more than 5 times in 10 minutes.
                  </p>
                </CardContent>
              </Card>

            </div>

          </motion.div>
        </motion.div>

        {/* Rule Editor Modal */}
        <Dialog open={ruleModalOpen} onOpenChange={setRuleModalOpen}>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto pr-2">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-[#b48c3c]" />
                {selectedRule ? `Modify Rule: ${selectedRule.id}` : "Configure Automation Rule"}
              </DialogTitle>
              <DialogDescription>
                Define the trigger, conditions, and sequential actions. Saving applies monitoring immediately.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="ruleName" className="font-semibold text-xs">Rule Name *</Label>
                <Input
                  id="ruleName"
                  placeholder="e.g. Lead Status Shifted to Engaged Alert"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ruleDesc" className="font-semibold text-xs">Rule Description</Label>
                <Input
                  id="ruleDesc"
                  placeholder="Explain what this automation manages..."
                  value={ruleDescription}
                  onChange={(e) => setRuleDescription(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ruleTriggerSelect" className="font-semibold text-xs">Event Trigger *</Label>
                <Select value={ruleTrigger} onValueChange={setRuleTrigger}>
                  <SelectTrigger id="ruleTriggerSelect"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {standardTriggers.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Conditions Section */}
              <div className="space-y-2 border-t pt-3 border-border/80">
                <div className="flex justify-between items-center">
                  <Label className="font-bold text-xs text-amber-600 flex items-center gap-1">
                    <GitFork className="h-3.5 w-3.5" /> Filter Conditions (AND matched)
                  </Label>
                  <Button type="button" variant="outline" size="sm" onClick={addConditionRow} className="h-7 text-xs gap-1 border-dashed">
                    <Plus className="h-3 w-3" /> Add Filter
                  </Button>
                </div>

                <div className="space-y-2">
                  {ruleConditions.map((cond, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <Select value={cond.field} onValueChange={(val) => handleConditionChange(idx, "field", val)}>
                        <SelectTrigger className="w-1/3 h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="status">Lead Status</SelectItem>
                          <SelectItem value="tags">Tags List</SelectItem>
                          <SelectItem value="emailOptIn">Email Opt-in</SelectItem>
                          <SelectItem value="smsOptIn">SMS Opt-in</SelectItem>
                          <SelectItem value="localTime">Local Time (HH:MM)</SelectItem>
                        </SelectContent>
                      </Select>

                      <Select value={cond.operator} onValueChange={(val) => handleConditionChange(idx, "operator", val)}>
                        <SelectTrigger className="w-1/4 h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="EQUALS">Equals</SelectItem>
                          <SelectItem value="CONTAINS">Contains</SelectItem>
                          <SelectItem value="NOT_EQUALS">Not Equals</SelectItem>
                          <SelectItem value="NOT_IN_WINDOW">Outside Window</SelectItem>
                        </SelectContent>
                      </Select>

                      <Input
                        placeholder="Value..."
                        value={cond.value}
                        onChange={(e) => handleConditionChange(idx, "value", e.target.value)}
                        className="w-1/3 h-8 text-xs"
                      />

                      <Button variant="ghost" size="icon" onClick={() => removeConditionRow(idx)} className="h-8 w-8 text-red-500 hover:bg-red-500/10">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  {ruleConditions.length === 0 && (
                    <p className="text-[11px] text-muted-foreground italic py-1 pl-1">No filter criteria specified. Rule executes for all triggers.</p>
                  )}
                </div>
              </div>

              {/* Actions Section */}
              <div className="space-y-2 border-t pt-3 border-border/80">
                <div className="flex justify-between items-center">
                  <Label className="font-bold text-xs text-green-600 flex items-center gap-1">
                    <Play className="h-3.5 w-3.5" /> Ordered Pipeline Actions
                  </Label>
                  <Button type="button" variant="outline" size="sm" onClick={addActionRow} className="h-7 text-xs gap-1 border-dashed">
                    <Plus className="h-3 w-3" /> Add Action
                  </Button>
                </div>

                <div className="space-y-3">
                  {ruleActions.map((act, idx) => (
                    <div key={idx} className="p-3 border rounded-xl bg-slate-50 dark:bg-slate-900/40 relative">
                      <button
                        onClick={() => removeActionRow(idx)}
                        className="absolute right-2 top-2 text-red-500 hover:bg-red-500/10 p-1 rounded"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>

                      <div className="grid grid-cols-2 gap-3 items-center">
                        <div className="space-y-1">
                          <Label className="text-[10px] text-slate-400 font-bold">Action Type</Label>
                          <Select value={act.type} onValueChange={(val) => handleActionChange(idx, val)}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {standardActions.map(a => (
                                <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1">
                          {Object.keys(act.params).map((paramKey) => (
                            <div key={paramKey} className="space-y-1">
                              <Label className="text-[10px] text-slate-400 font-bold uppercase">{paramKey}</Label>
                              <Input
                                placeholder={`Enter ${paramKey}...`}
                                value={act.params[paramKey] || ""}
                                onChange={(e) => handleActionParamChange(idx, paramKey, e.target.value)}
                                className="h-8 text-xs"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                  {ruleActions.length === 0 && (
                    <p className="text-[11px] text-red-500 italic py-1 pl-1">! You must configure at least one action.</p>
                  )}
                </div>
              </div>

              {/* Loop Safeguards Section */}
              <div className="space-y-2 border-t pt-3 border-border/80">
                <Label className="font-bold text-xs text-[#b48c3c] flex items-center gap-1 mb-1">
                  <ShieldCheck className="h-3.5 w-3.5" /> Rule Rate Limits & Cooldowns
                </Label>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Execution Cap</Label>
                    <Input
                      type="number"
                      value={ruleRateLimitCount}
                      min={1}
                      onChange={(e) => setRuleRateLimitCount(parseInt(e.target.value) || 1)}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Per Window</Label>
                    <Select value={ruleRateLimitWindow} onValueChange={(val: any) => setRuleRateLimitWindow(val)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="HOUR">Hour</SelectItem>
                        <SelectItem value="DAY">Day</SelectItem>
                        <SelectItem value="WEEK">Week</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Cooldown Period (Hours)</Label>
                    <Input
                      type="number"
                      value={ruleCooldown}
                      min={0}
                      onChange={(e) => setRuleCooldown(parseInt(e.target.value) || 0)}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              </div>

            </div>

            <DialogFooter className="pt-4 border-t">
              {selectedRule && (
                <Button type="button" variant="ghost" className="text-red-500 mr-auto hover:bg-red-500/10" onClick={() => handleDeleteRule(selectedRule.id)}>
                  Delete Rule
                </Button>
              )}
              <Button type="button" variant="ghost" onClick={() => setRuleModalOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveRule} className="bg-[#0F3B3D] text-white">
                {selectedRule ? "Update Automation" : "Launch Automation"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PortalLayout>
    </ProtectedRoute>
  );
}
