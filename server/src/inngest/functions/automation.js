import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { MailService } from "../../services/mail-service.js";
import { getMessagingConfig } from "../../lib/messaging-config.js";

// ─── Condition evaluation (SW-AMK-001) ────────────────────────────────────────
function leadFieldValue(lead, field) {
  if (!lead) return undefined;
  return lead[field];
}

function evaluateCondition(lead, cond) {
  const { field, operator, value } = cond || {};
  if (!field || !operator) return true;
  const actual = leadFieldValue(lead, field);
  const op = String(operator).toUpperCase();

  switch (op) {
    case "EQUALS":
      if (typeof actual === "boolean") return actual === (value === true || value === "true");
      return String(actual ?? "") === String(value ?? "");
    case "NOT_EQUALS":
      return String(actual ?? "") !== String(value ?? "");
    case "CONTAINS":
      if (Array.isArray(actual)) return actual.includes(value); // e.g. tags
      return String(actual ?? "").toLowerCase().includes(String(value ?? "").toLowerCase());
    case "IN": {
      const arr = Array.isArray(value) ? value : String(value ?? "").split(",").map((s) => s.trim());
      return arr.includes(String(actual ?? ""));
    }
    case "IS_TRUE":
      return actual === true;
    case "IS_FALSE":
      return actual === false;
    default:
      return true;
  }
}

// All conditions must pass (AND). Empty conditions = always match.
export function evaluateConditions(lead, conditions) {
  if (!Array.isArray(conditions) || conditions.length === 0) return true;
  return conditions.every((c) => evaluateCondition(lead, c));
}

// ─── Action execution (SW-AMK-001) ────────────────────────────────────────────
export async function executeAction(action, lead) {
  const type = String(action?.type || "").toUpperCase();
  const params = action?.params || {};

  switch (type) {
    case "PAUSE_CAMPAIGNS": {
      const r = await prisma.campaignEnrollment.updateMany({
        where: { leadId: lead.id, status: "ACTIVE" },
        data: { status: "PAUSED" },
      });
      return { type, paused: r.count };
    }

    case "ENROLL_CAMPAIGN": {
      const campaignId = params.campaignId;
      if (!campaignId) return { type, error: "missing campaignId" };
      const campaign = await prisma.campaign.findFirst({
        where: { id: campaignId, companyId: lead.companyId },
      });
      if (!campaign) return { type, error: "campaign not found" };

      const existing = await prisma.campaignEnrollment.findUnique({
        where: { leadId_campaignId: { leadId: lead.id, campaignId } },
      });
      if (existing && (existing.status === "ACTIVE" || existing.status === "PAUSED")) {
        return { type, skipped: "already enrolled" };
      }
      const enrollment = await prisma.campaignEnrollment.upsert({
        where: { leadId_campaignId: { leadId: lead.id, campaignId } },
        create: { leadId: lead.id, campaignId, status: "ACTIVE", currentStepPosition: 1 },
        update: { status: "ACTIVE", currentStepPosition: 1, exitedReason: null },
      });
      if (campaign.status === "Active") {
        await inngest.send({
          name: "campaign.enrollment.started",
          data: { leadId: lead.id, campaignId, enrollmentId: enrollment.id },
        });
      }
      return { type, enrolled: campaignId };
    }

    case "UPDATE_STATUS": {
      const newStatus = params.newStatus || params.status;
      if (!newStatus) return { type, error: "missing status" };
      // Direct DB write (NOT via the leads controller) so this does not re-emit a
      // STATUS_CHANGE trigger — prevents automation loops (SW-AMK-003).
      await prisma.lead.update({ where: { id: lead.id }, data: { status: newStatus } });
      return { type, status: newStatus };
    }

    case "UPDATE_TAGS": {
      const toAdd = Array.isArray(params.tags)
        ? params.tags
        : String(params.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
      if (!toAdd.length) return { type, error: "missing tags" };
      const merged = Array.from(new Set([...(lead.tags || []), ...toAdd]));
      await prisma.lead.update({ where: { id: lead.id }, data: { tags: merged } });
      return { type, tags: merged };
    }

    case "NOTIFY_OWNER": {
      const owner = lead.ownerId
        ? await prisma.user.findUnique({ where: { id: lead.ownerId }, select: { email: true, name: true } })
        : null;
      const to = owner?.email || lead.company?.email;
      if (!to) return { type, skipped: "no owner/company email" };
      const { smtpConfig } = await getMessagingConfig(lead.companyId);
      await MailService.sendEmail({
        to,
        subject: `[Automation] Follow up: ${lead.firstName} ${lead.lastName}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <p>An automation flagged <strong>${lead.firstName} ${lead.lastName}</strong> (${lead.email || lead.phone || "no contact"}).</p>
          <p>${params.message || "Please review this lead in the Sales workspace."}</p>
        </div>`,
        smtpConfig,
      });
      return { type, notified: to };
    }

    default:
      return { type: type || "UNKNOWN", skipped: "unsupported action" };
  }
}

// ─── Engine core (SW-AMK-003 execution semantics) ─────────────────────────────
// Extracted so it can be unit/integration tested without the Inngest runtime.
export async function evaluateRulesForTrigger({ companyId, leadId, triggerEvent }) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { automationsKillSwitch: true },
  });
  // SW-AMK-004: kill switch pauses ALL automations for the tenant.
  if (!company || company.automationsKillSwitch) {
    return { status: "skipped", reason: "kill-switch-or-no-company" };
  }

  const rules = await prisma.marketingRule.findMany({
    where: { companyId, triggerEvent, isActive: true },
  });
  if (rules.length === 0) return { status: "no-rules", triggerEvent };

  const lead = leadId
    ? await prisma.lead.findUnique({ where: { id: leadId }, include: { company: true } })
    : null;

  let executed = 0;
  for (const rule of rules) {
    // SW-AMK-003: loop prevention — skip if this rule already ran for this lead
    // within its cooldown window.
    if (leadId) {
      const since = new Date(Date.now() - (rule.cooldownHours || 24) * 3600 * 1000);
      const recent = await prisma.marketingRuleRun.findFirst({
        where: { ruleId: rule.id, leadId, matched: true, createdAt: { gte: since } },
      });
      if (recent) {
        await prisma.marketingRuleRun.create({
          data: { ruleId: rule.id, companyId, leadId, triggerEvent, matched: false, outcome: "SKIPPED_COOLDOWN" },
        });
        continue;
      }
    }

    // Conditions
    if (!evaluateConditions(lead, rule.conditions)) {
      await prisma.marketingRuleRun.create({
        data: { ruleId: rule.id, companyId, leadId, triggerEvent, matched: false, outcome: "SKIPPED_CONDITIONS" },
      });
      continue;
    }

    // Actions
    const actionsTaken = [];
    let outcome = "MATCHED";
    try {
      if (lead) {
        for (const action of rule.actions || []) {
          actionsTaken.push(await executeAction(action, lead));
        }
      }
    } catch (e) {
      outcome = "ERROR";
      actionsTaken.push({ error: e?.message || String(e) });
    }

    await prisma.marketingRuleRun.create({
      data: { ruleId: rule.id, companyId, leadId, triggerEvent, matched: true, actionsTaken, outcome },
    });
    await prisma.marketingRule.update({
      where: { id: rule.id },
      data: { runCount: { increment: 1 }, lastTriggeredAt: new Date() },
    });
    executed += 1;
  }

  return { status: "done", triggerEvent, rulesEvaluated: rules.length, executed };
}

export const runAutomationRules = inngest.createFunction(
  {
    id: "run-automation-rules",
    concurrency: [{ key: "event.data.companyId", limit: 5 }],
    triggers: [{ event: "automation.trigger" }],
  },
  async ({ event, step }) => {
    const { companyId, leadId, event: triggerEvent } = event.data;
    return await step.run("evaluate-rules", async () =>
      evaluateRulesForTrigger({ companyId, leadId, triggerEvent })
    );
  }
);
