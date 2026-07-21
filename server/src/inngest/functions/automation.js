import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { MailService } from "../../services/mail-service.js";
import { MessagingService } from "../../services/messaging-service.js";
import { getMessagingConfig } from "../../lib/messaging-config.js";
import { deadLetterJob } from "../../lib/dead-letter.js";
import { renderMergeFields, leadMergeVars } from "../../lib/utils.js";


export function mergeFields(template, lead, html = false) {
  return renderMergeFields(template, leadMergeVars(lead), {
    html,
    blankUnknown: true,
  });
}

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
    // Date-based operators (SW-AMK date triggers). `value` = number of days.
    case "OLDER_THAN_DAYS": {
      const d = actual ? new Date(actual) : null;
      if (!d || isNaN(d.getTime())) return false;
      return d.getTime() < Date.now() - Number(value) * 86400000;
    }
    case "NEWER_THAN_DAYS": {
      const d = actual ? new Date(actual) : null;
      if (!d || isNaN(d.getTime())) return false;
      return d.getTime() > Date.now() - Number(value) * 86400000;
    }
    default:
      return true;
  }
}

// All conditions must pass (AND). Empty conditions = always match.
export function evaluateConditions(lead, conditions) {
  if (!Array.isArray(conditions) || conditions.length === 0) return true;
  return conditions.every((c) => evaluateCondition(lead, c));
}

export async function executeAction(action, lead, ctx = {}) {
  const type = String(action?.type || "").toUpperCase();
  const params = action?.params || {};
  const budget = ctx.sendBudget;

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
          <p>An automation flagged <strong>${escapeHtml(lead.firstName)} ${escapeHtml(lead.lastName)}</strong> (${escapeHtml(lead.email || lead.phone || "no contact")}).</p>
          <p>${escapeHtml(params.message || "Please review this lead in the Sales workspace.")}</p>
        </div>`,
        smtpConfig,
      });
      return { type, notified: to };
    }

    case "SEND_EMAIL": {
      if (!lead.email) return { type, skipped: "no email" };
      const optInRequired = lead.company?.complianceOptInRequired ?? true;
      if (optInRequired && !lead.emailOptIn) return { type, skipped: "no email opt-in" };
      if (budget && budget.remaining <= 0) return { type, skipped: "daily cap reached" };
      const subject = mergeFields(params.subject || "A quick note", lead, false);
      const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">${mergeFields(params.body || "", lead, true)}</div>`;
      const { smtpConfig } = await getMessagingConfig(lead.companyId);
      const r = await MessagingService.sendEmail({ companyId: lead.companyId, to: lead.email, subject, html, smtpConfig });
      if (r && (r.blocked || r.success === false)) return { type, skipped: r.reason || "send blocked" };
      if (budget) budget.remaining -= 1;
      return { type, sent: true, to: lead.email };
    }

    case "SEND_SMS": {
      if (!lead.phone) return { type, skipped: "no phone" };
      if (!lead.smsOptIn) return { type, skipped: "no sms opt-in" };
      if (budget && budget.remaining <= 0) return { type, skipped: "daily cap reached" };
      const body = mergeFields(params.body || "", lead, false);
      if (!body.trim()) return { type, skipped: "empty body" };
      const { smsConfig } = await getMessagingConfig(lead.companyId);
      const r = await MessagingService.sendSms({ companyId: lead.companyId, to: lead.phone, body, smsConfig });
      if (r && r.blocked) return { type, skipped: r.reason || "send blocked" };
      if (budget) budget.remaining -= 1;
      return { type, sent: true, to: lead.phone };
    }
    case "CREATE_TASK": {
      const title = mergeFields(params.title || params.message || "Follow up with lead", lead, false);
      const dueInDays = Number(params.dueInDays);
      const dueAt = Number.isFinite(dueInDays) && dueInDays > 0
        ? new Date(Date.now() + dueInDays * 86400000)
        : null;
      await prisma.leadTimeline.create({
        data: {
          leadId: lead.id,
          type: "TASK",
          description: title,
          metadata: { createdByAutomation: true, dueAt, assignedTo: lead.ownerId || null },
        },
      });
      return { type, task: true };
    }

    case "DRAFT_ANNOUNCEMENT": {
      const ann = await prisma.announcement.create({
        data: {
          companyId: lead.companyId,
          title: params.title || "Automation-drafted announcement",
          subject: params.subject || params.title || "News update",
          body: params.body || "",
          channel: params.channel || "EMAIL",
          status: "Draft",
        },
      });
      return { type, announcementId: ann.id };
    }

    default:
      return { type: type || "UNKNOWN", skipped: "unsupported action" };
  }
}

export function countSentActions(runs) {
  let n = 0;
  for (const r of runs || []) {
    const acts = Array.isArray(r.actionsTaken) ? r.actionsTaken : [];
    for (const a of acts) if (a && a.sent === true) n += 1;
  }
  return n;
}

export async function evaluateRulesForTrigger({ companyId, leadId, triggerEvent }) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { automationsKillSwitch: true, automationDailyCap: true },
  });
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

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const cap = company.automationDailyCap ?? 1000;
  const todaysRuns = await prisma.marketingRuleRun.findMany({
    where: { companyId, matched: true, createdAt: { gte: startOfDay } },
    select: { actionsTaken: true },
    take: 10000,
  });
  const sendBudget = { remaining: Math.max(0, cap - countSentActions(todaysRuns)) };

  let executed = 0;
  for (const rule of rules) {
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
          actionsTaken.push(await executeAction(action, lead, { sendBudget }));
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
    onFailure: async ({ event, error }) =>
      deadLetterJob({ functionId: "run-automation-rules", event, error }),
  },
  async ({ event, step }) => {
    const { companyId, leadId, event: triggerEvent } = event.data;
    return await step.run("evaluate-rules", async () =>
      evaluateRulesForTrigger({ companyId, leadId, triggerEvent })
    );
  }
);

export const automationDateTriggers = inngest.createFunction(
  { id: "automation-date-based-triggers", triggers: [{ cron: "0 13 * * *" }] },
  async ({ step }) => {
    return await step.run("scan-date-rules", async () => {
      const rules = await prisma.marketingRule.findMany({
        where: { triggerEvent: "DATE_BASED", isActive: true },
      });
      let enqueued = 0;
      for (const rule of rules) {
        const company = await prisma.company.findUnique({
          where: { id: rule.companyId },
          select: { automationsKillSwitch: true },
        });
        if (!company || company.automationsKillSwitch) continue;

        const leads = await prisma.lead.findMany({
          where: { companyId: rule.companyId, archived: false },
          take: 2000,
        });
        for (const lead of leads) {
          if (!evaluateConditions(lead, rule.conditions)) continue;
          await inngest.send({
            name: "automation.trigger",
            data: { companyId: rule.companyId, leadId: lead.id, event: "DATE_BASED", context: { ruleId: rule.id } },
          });
          enqueued += 1;
        }
      }
      return { status: "done", rules: rules.length, enqueued };
    });
  }
);
