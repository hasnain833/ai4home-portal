import prisma from "../lib/prisma.js";
import { writeAuditLog } from "../lib/audit.js";
import { adminHandler } from "../middlewares/auth.js";
import { hasLLM, aiUnavailableMessage } from "../lib/llm.js";
import { getB2BAvailability } from "../lib/b2b.js";
import { getPlatformSlots } from "../services/website-sales.js";
import { buildAgentPrompt, decideReply, messageProblem, pickSlots, retrieveKb } from "../inngest/functions/b2b-agent.js";
import { AGENT_TYPES, defaultsFor } from "../prompts/registry.js";
import { getLivePrompts, invalidateLivePrompts } from "../prompts/live.js";

const MAX_PROMPT_CHARS = 30_000;
const MAX_TEST_TURNS = 40;
const SAMPLE_TIMEZONE = "America/Chicago";
const clip = (value, n) => String(value || "").trim().slice(0, n);

const wrap = adminHandler("B2B Prompt Lab");

function normalizeDraft(body = {}) {
  const defaults = defaultsFor(AGENT_TYPES.B2B);
  return Object.fromEntries(
    Object.keys(defaults).map((key) => [key, typeof body[key] === "string" ? body[key] : defaults[key]]),
  );
}

/** The actions are enforced in code, but a prompt that never mentions them would rarely use them. */
function validateDraft({ systemTemplate, toolDescription, kbEmptyText }) {
  const errors = [];
  if (String(systemTemplate).trim().length < 200) errors.push("The prompt is too short to run the agent safely.");
  if (!String(toolDescription).trim()) errors.push("Add the booking and escalation rules.");
  if (!String(kbEmptyText).trim()) errors.push("Add what the agent does when the knowledge base finds nothing.");
  if (`${systemTemplate}${toolDescription}${kbEmptyText}`.length > MAX_PROMPT_CHARS) errors.push(`Keep the prompts under ${MAX_PROMPT_CHARS} characters.`);
  const warnings = ["reply", "book", "handoff", "not_interested"]
    .filter((action) => !`${systemTemplate} ${toolDescription}`.includes(action))
    .map((action) => `The prompt doesn't explain the "${action}" action.`);
  return { errors, warnings };
}

const who = (req) => req.user?.name || req.user?.email || null;

export const getB2BPromptLab = wrap("Loading", async (_req, res) => {
  const versions = await prisma.b2BAgentPromptVersion.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  const { meta, ...livePrompts } = await getLivePrompts(AGENT_TYPES.B2B);
  const liveRow = versions.find((v) => v.isLive) || null;
  res.json({
    defaults: defaultsFor(AGENT_TYPES.B2B),
    livePrompts,
    versions,
    currentDraft: versions.find((v) => v.isActive) || null,
    live: {
      source: meta?.source || "code-default",
      versionId: liveRow?.id || null,
      label: liveRow?.label || null,
      setLiveAt: liveRow?.setLiveAt || null,
      setLiveByName: liveRow?.setLiveByName || null,
    },
  });
});

export const saveB2BPromptVersion = wrap("Saving", async (req, res) => {
  const draft = normalizeDraft(req.body);
  const { errors, warnings } = validateDraft(draft);
  if (errors.length) return res.status(400).json({ message: errors[0], errors, warnings });
  const version = await prisma.$transaction(async (tx) => {
    await tx.b2BAgentPromptVersion.updateMany({ where: { isActive: true }, data: { isActive: false } });
    return tx.b2BAgentPromptVersion.create({
      data: {
        ...draft,
        label: clip(req.body?.label, 120) || null,
        isActive: true,
        createdById: req.user?.id || null,
        createdByName: who(req),
      },
    });
  });
  await writeAuditLog({ req, action: "b2b_agent_prompt.version_saved", targetType: "B2BAgentPromptVersion", targetId: version.id, metadata: { label: version.label, warnings } });
  res.status(201).json({ version, warnings });
});

export const setCurrentB2BVersion = wrap("Loading that version", async (req, res) => {
  const exists = await prisma.b2BAgentPromptVersion.findUnique({ where: { id: req.params.versionId } });
  if (!exists) return res.status(404).json({ message: "Version not found." });
  const version = await prisma.$transaction(async (tx) => {
    await tx.b2BAgentPromptVersion.updateMany({ where: { isActive: true }, data: { isActive: false } });
    return tx.b2BAgentPromptVersion.update({ where: { id: exists.id }, data: { isActive: true } });
  });
  res.json({ version });
});

export const setB2BVersionLive = wrap("Setting live", async (req, res) => {
  const target = await prisma.b2BAgentPromptVersion.findUnique({ where: { id: req.params.versionId } });
  if (!target) return res.status(404).json({ message: "Version not found." });
  const { errors, warnings } = validateDraft(target);
  if (errors.length) return res.status(400).json({ message: errors[0], errors, warnings });
  if (warnings.length && !req.body?.acknowledgeWarnings) {
    return res.status(409).json({ message: "This version has warnings. Confirm to continue.", needsAcknowledgement: true, warnings });
  }
  const previous = await prisma.b2BAgentPromptVersion.findFirst({ where: { isLive: true }, select: { id: true } });
  const version = await prisma.$transaction(async (tx) => {
    await tx.b2BAgentPromptVersion.updateMany({ where: { isLive: true }, data: { isLive: false } });
    return tx.b2BAgentPromptVersion.update({
      where: { id: target.id },
      data: { isLive: true, setLiveAt: new Date(), setLiveById: req.user?.id || null, setLiveByName: who(req) },
    });
  });
  invalidateLivePrompts(AGENT_TYPES.B2B);
  await writeAuditLog({ req, action: "b2b_agent_prompt.set_live", targetType: "B2BAgentPromptVersion", targetId: version.id, metadata: { label: version.label, warnings, previousLiveId: previous?.id || null } });
  res.json({ version, warnings });
});

export const revertB2BToDefaults = wrap("Reverting", async (req, res) => {
  const previous = await prisma.b2BAgentPromptVersion.findFirst({ where: { isLive: true } });
  if (!previous) return res.json({ message: "Already running the shipped prompt.", changed: false });
  await prisma.b2BAgentPromptVersion.updateMany({ where: { isLive: true }, data: { isLive: false } });
  invalidateLivePrompts(AGENT_TYPES.B2B);
  await writeAuditLog({ req, action: "b2b_agent_prompt.reverted_to_defaults", targetType: "B2BAgentPromptVersion", targetId: previous.id, metadata: { label: previous.label } });
  res.json({ message: "Reverted to the shipped prompt.", changed: true });
});

export const deleteB2BVersion = wrap("Deleting", async (req, res) => {
  const version = await prisma.b2BAgentPromptVersion.findUnique({ where: { id: req.params.versionId } });
  if (!version) return res.status(404).json({ message: "Version not found." });
  if (version.isLive) return res.status(400).json({ message: "This version is live. Put another live first." });
  await prisma.b2BAgentPromptVersion.delete({ where: { id: version.id } });
  await writeAuditLog({ req, action: "b2b_agent_prompt.version_deleted", targetType: "B2BAgentPromptVersion", targetId: version.id, metadata: { label: version.label } });
  res.json({ success: true });
});

async function sandboxContext(body) {
  const channel = body?.channel === "SMS" ? "SMS" : "EMAIL";
  const campaignText = clip(body?.campaignText, 4000);
  const turns = (Array.isArray(body?.messages) ? body.messages : []).slice(-MAX_TEST_TURNS);
  const history = [
    ...(campaignText ? [{ actor: "CAMPAIGN", channel, subject: null, body: campaignText }] : []),
    ...turns.map((m) => ({ actor: m?.role === "agent" ? "AGENT" : "LEAD", channel, subject: null, body: String(m?.content || "").slice(0, 4000) })),
  ];
  return {
    lead: {
      companyName: clip(body?.companyName, 120) || "Ridge Homes",
      contactName: clip(body?.leadName, 120) || "Dana Cole",
      city: "Austin, TX",
      status: "CONTACTED",
    },
    channel,
    timezone: SAMPLE_TIMEZONE,
    existingMeeting: null,
    slots: pickSlots(await getPlatformSlots(await getB2BAvailability()), SAMPLE_TIMEZONE),
    history,
    kbChunks: await retrieveKb(history),
  };
}

export const previewB2BPrompt = wrap("Preview", async (req, res) => {
  const draft = normalizeDraft(req.body);
  const prompt = buildAgentPrompt(await sandboxContext(req.body), draft);
  res.json({ prompt: `${prompt}\n\n--- Booking & escalation rules ---\n${draft.toolDescription}` });
});

// Sandbox: runs the real decision step on a sample lead. Nothing is sent, booked or saved.
export const b2bPromptLabChat = wrap("Test reply", async (req, res) => {
  const prompts = normalizeDraft(req.body);
  const { errors } = validateDraft(prompts);
  if (errors.length) return res.status(400).json({ message: errors[0] });
  if (!hasLLM()) return res.status(503).json({ message: aiUnavailableMessage() });
  const ctx = await sandboxContext(req.body);
  const last = ctx.history[ctx.history.length - 1];
  if (last?.actor !== "LEAD" || !last.body.trim()) return res.status(400).json({ message: "Write a message from the lead first." });
  const decision = await decideReply(ctx, { prompts, source: "b2b-agent-lab" });
  if (!decision?.action) return res.status(502).json({ message: "The AI didn't return a reply. Try again." });
  const slot = ctx.slots.find((s) => s.iso === decision.slot_iso);
  res.json({
    action: decision.action,
    message: decision.message || "",
    summary: decision.summary || "",
    slotLabel: slot?.label || null,
    sources: [...new Set(ctx.kbChunks.map((c) => c.name))],
    // What the live agent's safety checks would do with this reply.
    blockedBecause: decision.action === "book"
      ? (slot ? null : "the AI tried to book a time that was not offered")
      : messageProblem(decision.message, ctx.channel, ctx.kbChunks),
  });
});
