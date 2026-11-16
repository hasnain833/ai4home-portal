import prisma from "../lib/prisma.js";
import { adminHandler } from "../middlewares/auth.js";
import { unknownPlaceholders } from "../lib/b2b.js";
import { B2B_PHASES, b2bTouchByKey } from "../lib/b2b-nurture-playbook.js";
import { B2B_AUTO_ID, autoEnrollSoon, ensureB2BAutoCampaign, startB2BEnrollments } from "../services/b2b-auto-nurture.js";

const wrap = adminHandler("B2B nurture");
const stepsOf = (campaign) => (Array.isArray(campaign.steps) ? campaign.steps : []);

/** The 180-day workflow in the same shape as the Sales one, plus sends, opens and clicks per touch. */
export const getAutoNurture = wrap("Loading the workflow", async (_req, res) => {
  const campaign = await ensureB2BAutoCampaign();
  const steps = stepsOf(campaign);
  const [enrollments, usage] = await Promise.all([
    prisma.b2BEnrollment.findMany({ where: { campaignId: B2B_AUTO_ID }, select: { status: true, exitedReason: true, currentStep: true } }),
    prisma.messageUsage.groupBy({
      by: ["stepId"],
      where: { campaignId: B2B_AUTO_ID, source: "b2b-campaign", outcome: "sent" },
      _count: { _all: true, openedAt: true, clickedAt: true },
    }),
  ]);
  const usageByStep = new Map(usage.map((u) => [u.stepId, u._count]));

  const touches = steps
    .map((s, index) => ({ s, index, def: b2bTouchByKey[s.id] }))
    .filter(({ def }) => def)
    .map(({ s, index, def }) => {
      const u = usageByStep.get(`b2b:${index + 1}`);
      return {
        id: s.id,
        key: s.id,
        phase: def.phase,
        at: def.at,
        type: s.channel,
        theme: def.theme,
        goal: def.goal,
        subject: s.channel === "EMAIL" ? s.subject : null,
        body: s.body,
        enabled: s.enabled !== false,
        edited: (s.subject || "") !== (def.subject || "") || s.body !== def.body,
        sent: u?._all || 0,
        opened: u?.openedAt || 0,
        clicked: u?.clickedAt || 0,
      };
    });

  // An active lead is in the phase of the next touch it is waiting for.
  const inPhase = Object.fromEntries(B2B_PHASES.map((p) => [p.id, 0]));
  const count = (pred) => enrollments.filter(pred).length;
  for (const e of enrollments) {
    const phase = e.status === "ACTIVE" && b2bTouchByKey[steps[e.currentStep]?.id]?.phase;
    if (phase) inPhase[phase] += 1;
  }

  res.json({
    id: campaign.id,
    active: campaign.status === "ACTIVE",
    phases: B2B_PHASES.map((p) => ({ ...p, activeLeads: inPhase[p.id] })),
    touches,
    stats: {
      enrolled: enrollments.length,
      active: count((e) => e.status === "ACTIVE"),
      booked: count((e) => e.exitedReason === "APPOINTMENT"),
      replied: count((e) => e.exitedReason === "REPLY"),
      optedOut: count((e) => e.exitedReason === "UNSUBSCRIBE"),
      completed: count((e) => e.status === "COMPLETED"),
    },
  });
});

export const setAutoNurtureActive = wrap("Switching the workflow", async (req, res) => {
  await ensureB2BAutoCampaign();
  const active = !!req.body?.active;
  // Paused runs stop at their next send; switching back on restarts them where they were.
  await prisma.b2BCampaign.update({ where: { id: B2B_AUTO_ID }, data: { status: active ? "ACTIVE" : "PAUSED" } });
  if (active) {
    const running = await prisma.b2BEnrollment.findMany({ where: { campaignId: B2B_AUTO_ID, status: "ACTIVE" }, select: { id: true } });
    await startB2BEnrollments(running.map((e) => e.id));
    await autoEnrollSoon();
  }
  res.json({ active });
});

export const updateAutoNurtureStep = wrap("Saving the step", async (req, res) => {
  const campaign = await ensureB2BAutoCampaign();
  const steps = stepsOf(campaign);
  const index = steps.findIndex((s) => s.id === req.params.stepId);
  const def = b2bTouchByKey[req.params.stepId];
  if (index === -1 || !def) return res.status(404).json({ message: "Step not found." });

  const step = { ...steps[index] };
  const { enabled, subject, body, reset } = req.body || {};
  if (typeof enabled === "boolean") step.enabled = enabled;
  if (reset) {
    step.subject = def.subject || "";
    step.body = def.body;
  } else {
    if (body !== undefined) {
      if (!String(body).trim()) return res.status(400).json({ message: "The message cannot be empty." });
      step.body = String(body);
    }
    if (subject !== undefined && step.channel === "EMAIL") {
      if (!String(subject).trim()) return res.status(400).json({ message: "The subject cannot be empty." });
      step.subject = String(subject).slice(0, 200);
    }
    const unknown = unknownPlaceholders(`${step.subject || ""} ${step.body}`);
    if (unknown.length) {
      return res.status(400).json({ message: `${unknown.map((n) => `{{${n}}}`).join(", ")} isn't a merge field. Use {{firstName}}, {{contactName}}, {{companyName}}, {{city}} or {{bookingLink}}.` });
    }
  }

  // Edits reach leads already in the workflow from their next touch on, as in Sales.
  await prisma.b2BCampaign.update({ where: { id: B2B_AUTO_ID }, data: { steps: steps.map((s, i) => (i === index ? step : s)) } });
  res.json({
    id: step.id,
    subject: step.channel === "EMAIL" ? step.subject : null,
    body: step.body,
    enabled: step.enabled !== false,
    edited: (step.subject || "") !== (def.subject || "") || step.body !== def.body,
  });
});
