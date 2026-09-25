import prisma from "../lib/prisma.js";
import { PHASES, touchByKey } from "../lib/nurture-playbook.js";
import { ensureAutoCampaign } from "../services/auto-nurture.service.js";

const withCompany = (text, name) => String(text || "").replace(/\{\{\s*companyName\s*\}\}/g, name);

async function stepOf(req) {
  const campaign = await ensureAutoCampaign(req.user.companyId);
  const step = await prisma.campaignStep.findFirst({
    where: { id: req.params.stepId, campaignId: campaign.id, playbookKey: { not: null } },
  });
  return step;
}

export const getAutoNurture = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const campaign = await ensureAutoCampaign(companyId);
    const [company, steps, enrollments] = await Promise.all([
      prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }),
      prisma.campaignStep.findMany({ where: { campaignId: campaign.id }, orderBy: { position: "asc" } }),
      prisma.campaignEnrollment.findMany({
        where: { campaignId: campaign.id },
        select: { status: true, exitedReason: true, currentStepPosition: true },
      }),
    ]);
    const name = company?.name || "your company";

    const touches = steps
      .filter((s) => s.playbookKey && touchByKey[s.playbookKey])
      .map((s) => {
        const def = touchByKey[s.playbookKey];
        return {
          id: s.id,
          key: s.playbookKey,
          phase: def.phase,
          at: def.at,
          type: s.type,
          theme: withCompany(def.theme, name),
          goal: def.goal,
          subject: s.subject,
          body: s.body,
          enabled: s.enabled,
          edited: s.subject !== def.subject || s.body !== def.body,
        };
      });

    // An active lead is in the phase of the next touch it is waiting for.
    const phaseAt = (position) =>
      touchByKey[steps.find((s) => s.position >= position && s.playbookKey)?.playbookKey]?.phase || null;
    const inPhase = Object.fromEntries(PHASES.map((p) => [p.id, 0]));
    const count = (pred) => enrollments.filter(pred).length;
    for (const e of enrollments) {
      if (e.status !== "ACTIVE") continue;
      const phase = phaseAt(e.currentStepPosition || 1);
      if (phase) inPhase[phase] += 1;
    }

    return res.json({
      id: campaign.id,
      active: campaign.status === "Active",
      phases: PHASES.map((p) => ({ ...p, activeLeads: inPhase[p.id] })),
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
  } catch (error) {
    console.error("[Auto Nurture] Load failed:", error);
    return res.status(500).json({ message: "Could not load the automatic workflow." });
  }
};

export const setAutoNurtureActive = async (req, res) => {
  try {
    const campaign = await ensureAutoCampaign(req.user.companyId);
    const active = !!req.body?.active;
    // Paused runs stop at their next send; the stalled-enrollment sweep picks
    // them back up after it is switched on again.
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: active ? "Active" : "Paused" } });
    return res.json({ active });
  } catch (error) {
    console.error("[Auto Nurture] Toggle failed:", error);
    return res.status(500).json({ message: "Could not update the workflow." });
  }
};

export const updateAutoNurtureStep = async (req, res) => {
  try {
    const step = await stepOf(req);
    if (!step) return res.status(404).json({ message: "Step not found" });

    const { enabled, subject, body, reset } = req.body || {};
    const def = touchByKey[step.playbookKey];
    const data = {};
    if (typeof enabled === "boolean") data.enabled = enabled;
    if (reset) {
      data.subject = def.subject;
      data.body = def.body;
    } else {
      if (body !== undefined) {
        if (!String(body).trim()) return res.status(400).json({ message: "The message cannot be empty." });
        data.body = String(body);
      }
      if (subject !== undefined && step.type === "EMAIL") {
        if (!String(subject).trim()) return res.status(400).json({ message: "The subject cannot be empty." });
        data.subject = String(subject).slice(0, 200);
      }
    }

    const updated = await prisma.campaignStep.update({ where: { id: step.id }, data });
    return res.json({
      id: updated.id,
      subject: updated.subject,
      body: updated.body,
      enabled: updated.enabled,
      edited: updated.subject !== def.subject || updated.body !== def.body,
    });
  } catch (error) {
    console.error("[Auto Nurture] Step update failed:", error);
    return res.status(500).json({ message: "Could not save the step." });
  }
};
