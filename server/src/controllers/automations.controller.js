import prisma from "../lib/prisma.js";

const TRIGGER_DESCRIPTIONS = {
  LEAD_REPLIED: "Prospect responds to email or SMS",
  CRM_INGEST: "Lead is synchronized from Salesforce / imported",
  STATUS_CHANGE: "Lead status changes",
  MANUAL_CREATION: "A contact is added manually",
  APPOINTMENT_BOOKED: "An appointment is booked",
  DATE_BASED: "A date-based condition is met (evaluated daily)",
};

// Map a DB rule to the shape the builder UI expects.
function toApi(rule) {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description || "",
    trigger: { event: rule.triggerEvent, description: TRIGGER_DESCRIPTIONS[rule.triggerEvent] || "" },
    conditions: rule.conditions || [],
    actions: rule.actions || [],
    isActive: rule.isActive,
    cooldownPeriod: rule.cooldownHours,
    rateLimitCount: rule.rateLimitCount,
    rateLimitWindow: rule.rateLimitWindow,
    totalRuns: rule.runCount,
    lastTriggered: rule.lastTriggeredAt,
  };
}

// Accept both flat and nested (builder UI) shapes.
function normalizeInput(body) {
  return {
    name: body.name,
    description: body.description ?? null,
    triggerEvent: body.triggerEvent || body.trigger?.event || null,
    conditions: Array.isArray(body.conditions) ? body.conditions : [],
    actions: Array.isArray(body.actions) ? body.actions : [],
    cooldownHours: body.cooldownHours ?? body.cooldownPeriod ?? 24,
    rateLimitCount: body.rateLimitCount ?? 0,
    rateLimitWindow: body.rateLimitWindow ?? "DAY",
  };
}

// SW-AMK-002: block activation of incomplete or non-compliant rules.
function validateForActivation(rule) {
  if (!rule.triggerEvent) return "A trigger is required.";
  if (!Array.isArray(rule.actions) || rule.actions.length === 0) return "At least one action is required.";
  const sendsSms = rule.actions.some((a) => String(a.type || "").toUpperCase() === "SEND_SMS");
  if (sendsSms) {
    const hasConsentFilter = (rule.conditions || []).some(
      (c) => c.field === "smsOptIn" && String(c.value) === "true"
    );
    if (!hasConsentFilter) {
      return "An SMS action requires a condition on smsOptIn = true (consent filter).";
    }
  }
  return null;
}

export const getAutomations = async (req, res) => {
  try {
    const [rules, company] = await Promise.all([
      prisma.marketingRule.findMany({ where: { companyId: req.user.companyId }, orderBy: { createdAt: "desc" } }),
      prisma.company.findUnique({ where: { id: req.user.companyId }, select: { automationsKillSwitch: true, automationDailyCap: true } }),
    ]);
    return res.json({
      rules: rules.map(toApi),
      killSwitch: company?.automationsKillSwitch || false,
      dailyCap: company?.automationDailyCap ?? 1000,
    });
  } catch (error) {
    console.error("[Automations List] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const createAutomation = async (req, res) => {
  try {
    const input = normalizeInput(req.body);
    if (!input.name || !input.triggerEvent) {
      return res.status(400).json({ message: "Name and trigger are required." });
    }
    const rule = await prisma.marketingRule.create({
      data: {
        companyId: req.user.companyId,
        name: input.name,
        description: input.description,
        triggerEvent: input.triggerEvent,
        conditions: input.conditions,
        actions: input.actions,
        cooldownHours: input.cooldownHours,
        rateLimitCount: input.rateLimitCount,
        rateLimitWindow: input.rateLimitWindow,
        isActive: false,
        createdById: req.user.id || null,
      },
    });
    return res.status(201).json(toApi(rule));
  } catch (error) {
    console.error("[Automation Create] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateAutomation = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.marketingRule.findFirst({ where: { id, companyId: req.user.companyId } });
    if (!existing) return res.status(404).json({ message: "Automation not found" });

    const input = normalizeInput({ ...existing, triggerEvent: existing.triggerEvent, cooldownPeriod: existing.cooldownHours, ...req.body });

    // If the rule is active (or being activated), keep it compliant.
    const willBeActive = req.body.isActive !== undefined ? !!req.body.isActive : existing.isActive;
    if (willBeActive) {
      const err = validateForActivation(input);
      if (err) return res.status(400).json({ message: err });
    }

    const rule = await prisma.marketingRule.update({
      where: { id },
      data: {
        name: input.name ?? existing.name,
        description: input.description,
        triggerEvent: input.triggerEvent,
        conditions: input.conditions,
        actions: input.actions,
        cooldownHours: input.cooldownHours,
        rateLimitCount: input.rateLimitCount,
        rateLimitWindow: input.rateLimitWindow,
        ...(req.body.isActive !== undefined ? { isActive: !!req.body.isActive } : {}),
      },
    });
    return res.json(toApi(rule));
  } catch (error) {
    console.error("[Automation Update] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Toggle active/paused (SW-AMK-002 validation on activate).
export const toggleAutomation = async (req, res) => {
  try {
    const { id } = req.params;
    const rule = await prisma.marketingRule.findFirst({ where: { id, companyId: req.user.companyId } });
    if (!rule) return res.status(404).json({ message: "Automation not found" });

    const nextActive = req.body.isActive !== undefined ? !!req.body.isActive : !rule.isActive;
    if (nextActive) {
      const err = validateForActivation(rule);
      if (err) return res.status(400).json({ message: err });
    }
    const updated = await prisma.marketingRule.update({ where: { id }, data: { isActive: nextActive } });
    return res.json(toApi(updated));
  } catch (error) {
    console.error("[Automation Toggle] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteAutomation = async (req, res) => {
  try {
    const { id } = req.params;
    const rule = await prisma.marketingRule.findFirst({ where: { id, companyId: req.user.companyId } });
    if (!rule) return res.status(404).json({ message: "Automation not found" });
    await prisma.marketingRule.delete({ where: { id } });
    return res.json({ success: true });
  } catch (error) {
    console.error("[Automation Delete] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// SW-AMK-004: kill switch + daily cap.
export const setKillSwitch = async (req, res) => {
  try {
    const { killSwitch, dailyCap } = req.body;
    const updated = await prisma.company.update({
      where: { id: req.user.companyId },
      data: {
        ...(killSwitch !== undefined ? { automationsKillSwitch: !!killSwitch } : {}),
        ...(dailyCap !== undefined ? { automationDailyCap: parseInt(dailyCap, 10) || 1000 } : {}),
      },
      select: { automationsKillSwitch: true, automationDailyCap: true },
    });
    return res.json({ killSwitch: updated.automationsKillSwitch, dailyCap: updated.automationDailyCap });
  } catch (error) {
    console.error("[Automation KillSwitch] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// SW-AMK-005: aggregate analytics.
export const getAutomationAnalytics = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const [totalRuns, matchedRuns, recentRuns] = await Promise.all([
      prisma.marketingRuleRun.count({ where: { companyId } }),
      prisma.marketingRuleRun.count({ where: { companyId, matched: true } }),
      prisma.marketingRuleRun.findMany({
        where: { companyId, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { rule: { select: { name: true } } },
      }),
    ]);
    return res.json({
      totalRuns,
      matchedRuns,
      recent: recentRuns.map((r) => ({
        id: r.id,
        rule: r.rule?.name || "(deleted)",
        triggerEvent: r.triggerEvent,
        matched: r.matched,
        outcome: r.outcome,
        actionsTaken: r.actionsTaken,
        createdAt: r.createdAt,
      })),
    });
  } catch (error) {
    console.error("[Automation Analytics] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
