import prisma from "../lib/prisma.js";
import { writeAuditLog } from "../lib/audit.js";
import { processWarrantyTurn } from "../lib/warranty-orchestrator.js";
import { hasPlatformAi } from "../lib/ai-config.js";
import {
  WARRANTY_PLACEHOLDERS,
  validateWarrantyDraft,
  defaultsFor,
  renderTemplate,
} from "../prompts/index.js";
import { AGENT_TYPES } from "../prompts/registry.js";
import { getLivePrompts, invalidateLivePrompts } from "../prompts/live.js";

function denyUnlessSuperAdmin(req, res) {
  if (!req.user?.isSuperAdmin) {
    res.status(403).json({ message: "Unauthorized" });
    return true;
  }
  return false;
}

const MAX_TRANSCRIPT_TURNS = 40;
const PHASE_KEYS = ["INTAKE", "IDENTIFY", "DIAGNOSE", "RESOLVE"];

/** Longest passage excerpt sent to the lab. Enough to judge relevance, short enough to ship. */
const MAX_EXCERPT = 1200;

/**
 * The passages retrieval handed the agent, trimmed for transport.
 *
 * Shown in the lab so a prompt can be judged against what the agent actually
 * had: an answer weakened by a KB gap looks identical to one weakened by a bad
 * prompt until you can read the retrieved text.
 */
function describeChunks(chunks = []) {
  return (Array.isArray(chunks) ? chunks : []).map((c) => ({
    documentId: c.documentId,
    name: c.name || "",
    category: c.category || "General",
    scope: c.scope || "COMPANY",
    score: Number(c.score) || 0,
    excerpt: String(c.text || "").slice(0, MAX_EXCERPT),
    truncated: String(c.text || "").length > MAX_EXCERPT,
  }));
}

function normalizeDraft(body = {}) {
  const defaults = defaultsFor(AGENT_TYPES.WARRANTY) || {};
  const draft = {};
  for (const key of PHASE_KEYS) {
    draft[key] = typeof body[key] === "string" ? body[key] : (defaults[key] || "");
  }
  return draft;
}

export const getWarrantyPromptLab = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;

    let versions = [];
    let tableReady = true;
    try {
      versions = await prisma.warrantyAgentPromptVersion.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
      });
    } catch {
      tableReady = false;
    }

    const liveRow = versions.find((v) => v.isLive) || null;
    const live = await getLivePrompts(AGENT_TYPES.WARRANTY);

    return res.json({
      defaults: defaultsFor(AGENT_TYPES.WARRANTY),
      placeholders: WARRANTY_PLACEHOLDERS,
      versions,
      currentDraft: versions.find((v) => v.isActive) || null,
      live: {
        source: live.meta?.source || "code-default",
        versionId: liveRow?.id || null,
        label: liveRow?.label || null,
        setLiveAt: liveRow?.setLiveAt || null,
        setLiveByName: liveRow?.setLiveByName || null,
      },
      tableReady,
    });
  } catch (error) {
    console.error("[Warranty Prompt Lab] Failed to load:", error);
    return res.status(500).json({ message: "Failed to load the warranty prompt lab" });
  }
};

export const saveWarrantyPromptVersion = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;

    const draft = normalizeDraft(req.body);
    const { errors, warnings } = validateWarrantyDraft(draft);
    if (errors.length) {
      return res.status(400).json({ message: errors[0], errors, warnings });
    }

    const label =
      typeof req.body?.label === "string" && req.body.label.trim()
        ? req.body.label.trim().slice(0, 120)
        : null;
    const notes =
      typeof req.body?.notes === "string" && req.body.notes.trim()
        ? req.body.notes.trim().slice(0, 2000)
        : null;

    const version = await prisma.$transaction(async (tx) => {
      await tx.warrantyAgentPromptVersion.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
      return tx.warrantyAgentPromptVersion.create({
        data: { ...draft, label, notes, isActive: true,
          createdById: req.user?.id || null,
          createdByName: req.user?.name || req.user?.email || null },
      });
    });

    await writeAuditLog({ req, action: "warranty_agent_prompt.version_saved",
      targetType: "WarrantyAgentPromptVersion", targetId: version.id,
      metadata: { label, warnings } });

    return res.status(201).json({ version, warnings });
  } catch (error) {
    console.error("[Warranty Prompt Lab] Failed to save version:", error);
    return res.status(500).json({ message: "Failed to save this version" });
  }
};

export const setCurrentWarrantyVersion = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;
    const { versionId } = req.params;

    const exists = await prisma.warrantyAgentPromptVersion.findUnique({ where: { id: versionId } });
    if (!exists) return res.status(404).json({ message: "Version not found" });

    const version = await prisma.$transaction(async (tx) => {
      await tx.warrantyAgentPromptVersion.updateMany({ where: { isActive: true }, data: { isActive: false } });
      return tx.warrantyAgentPromptVersion.update({ where: { id: versionId }, data: { isActive: true } });
    });

    await writeAuditLog({ req, action: "warranty_agent_prompt.version_set_current",
      targetType: "WarrantyAgentPromptVersion", targetId: version.id,
      metadata: { label: version.label } });

    return res.json({ version });
  } catch (error) {
    console.error("[Warranty Prompt Lab] Failed to activate version:", error);
    return res.status(500).json({ message: "Failed to activate this version" });
  }
};

export const setWarrantyVersionLive = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;
    const { versionId } = req.params;

    const target = await prisma.warrantyAgentPromptVersion.findUnique({ where: { id: versionId } });
    if (!target) return res.status(404).json({ message: "Version not found" });

    const { errors, warnings } = validateWarrantyDraft({
      INTAKE: target.INTAKE, IDENTIFY: target.IDENTIFY,
      DIAGNOSE: target.DIAGNOSE, RESOLVE: target.RESOLVE,
    });
    if (errors.length) return res.status(400).json({ message: "This version can'\''t go live until its errors are fixed.", errors, warnings });
    if (warnings.length && !req.body?.acknowledgeWarnings) {
      return res.status(409).json({ message: "This version goes live with warnings. Confirm to continue.",
        needsAcknowledgement: true, warnings });
    }

    const previous = await prisma.warrantyAgentPromptVersion.findFirst({ where: { isLive: true } });
    const version = await prisma.$transaction(async (tx) => {
      await tx.warrantyAgentPromptVersion.updateMany({ where: { isLive: true }, data: { isLive: false } });
      return tx.warrantyAgentPromptVersion.update({ where: { id: versionId },
        data: { isLive: true, setLiveAt: new Date(),
          setLiveById: req.user?.id || null,
          setLiveByName: req.user?.name || req.user?.email || null } });
    });

    invalidateLivePrompts(AGENT_TYPES.WARRANTY);

    await writeAuditLog({ req, action: "warranty_agent_prompt.set_live",
      targetType: "WarrantyAgentPromptVersion", targetId: version.id,
      metadata: { label: version.label, warnings, previousLiveId: previous?.id || null } });

    return res.json({ version, warnings, previousLiveId: previous?.id || null });
  } catch (error) {
    console.error("[Warranty Prompt Lab] Set live failed:", error);
    return res.status(500).json({ message: "Failed to put this version live" });
  }
};

export const revertWarrantyToDefaults = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;

    const previous = await prisma.warrantyAgentPromptVersion.findFirst({ where: { isLive: true } });
    if (!previous) return res.json({ message: "Already running the code defaults.", changed: false });

    await prisma.warrantyAgentPromptVersion.updateMany({ where: { isLive: true }, data: { isLive: false } });
    invalidateLivePrompts(AGENT_TYPES.WARRANTY);

    await writeAuditLog({ req, action: "warranty_agent_prompt.reverted_to_defaults",
      targetType: "WarrantyAgentPromptVersion", targetId: previous.id,
      metadata: { label: previous.label } });

    return res.json({ message: "Reverted to the code defaults.", changed: true });
  } catch (error) {
    console.error("[Warranty Prompt Lab] Revert failed:", error);
    return res.status(500).json({ message: "Failed to revert" });
  }
};

export const deleteWarrantyVersion = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;
    const { versionId } = req.params;

    const existing = await prisma.warrantyAgentPromptVersion.findUnique({ where: { id: versionId } });
    if (!existing) return res.status(404).json({ message: "Version not found" });

    if (existing.isLive) {
      return res.status(409).json({ message: "This version is live. Set another version live, or revert to the code defaults, before deleting it." });
    }

    await prisma.warrantyAgentPromptVersion.delete({ where: { id: versionId } });
    await writeAuditLog({ req, action: "warranty_agent_prompt.version_deleted",
      targetType: "WarrantyAgentPromptVersion", targetId: versionId,
      metadata: { label: existing.label } });

    return res.json({ message: "Version deleted" });
  } catch (error) {
    console.error("[Warranty Prompt Lab] Failed to delete version:", error);
    return res.status(500).json({ message: "Failed to delete this version" });
  }
};

export const warrantyPromptLabChat = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;

    const messages = Array.isArray(req.body?.messages)
      ? req.body.messages.slice(-MAX_TRANSCRIPT_TURNS) : [];
    if (!messages.length) return res.status(400).json({ message: "Send at least one message to test with." });

    const draft = normalizeDraft(req.body?.draft || {});
    const { errors } = validateWarrantyDraft(draft);
    if (errors.length) return res.status(400).json({ message: errors[0], errors });

    if (!(await hasPlatformAi())) {
      return res.status(503).json({ message: "No platform AI key is set. Add one under Admin -> AI Keys." });
    }

    // A company is still needed for the agent's own name and for the AI key, but
    // sandboxMode pins retrieval to the PLATFORM tier, so this company's private
    // documents do not colour the answers. See processWarrantyTurn.
    const company = await prisma.company.findFirst({ orderBy: { createdAt: "asc" } });
    if (!company) return res.status(400).json({ message: "No company exists to test against." });

    const phase = String(req.body?.phase || "INTAKE").toUpperCase();
    const convo = {
      id: "prompt-lab-sandbox",
      companyId: company.id,
      homeownerId: null,
      propertyId: null,
      phase,
      status: "ACTIVE",
      issueState: req.body?.issueState || {},
      transcript: messages.slice(0, -1),
      turnCount: messages.length,
      ticketId: null,
      updatedAt: new Date(),
    };

    const lastMsg = messages[messages.length - 1]?.content || "";
    const startedAt = Date.now();

    const result = await processWarrantyTurn({
      company, convo, newMsg: lastMsg, sandboxMode: true, draftPrompts: draft,
    });

    return res.json({
      reply: result.reply,
      phase: result.phase,
      latencyMs: Date.now() - startedAt,
      retrieved: describeChunks(result.kbHits),
      // Choices now travel beside the reply rather than numbered into it, so the
      // lab has to render them too — otherwise a property question looks like a
      // question with its answers missing.
      options: Array.isArray(result.options) ? result.options : [],
    });
  } catch (error) {
    console.error("[Warranty Prompt Lab] Chat failed:", error);
    return res.status(500).json({ message: "The warranty agent could not complete this turn" });
  }
};

export const previewWarrantyPrompt = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;

    const draft = normalizeDraft(req.body?.draft || req.body);
    const phase = String(req.body?.phase || "INTAKE").toUpperCase();

    const company = await prisma.company.findFirst({ orderBy: { createdAt: "asc" } });
    if (!company) return res.status(400).json({ message: "No company exists to preview against." });

    const rendered = renderTemplate(draft[phase] || "", {
      companyName: company.name,
      issueState: "{}",
      kbContext: "[KB context would appear here]",
      coverageStatus: "UNKNOWN",
    });

    return res.json({ phase, rendered, companyName: company.name, validation: validateWarrantyDraft(draft) });
  } catch (error) {
    console.error("[Warranty Prompt Lab] Preview failed:", error);
    return res.status(500).json({ message: "Failed to render this prompt" });
  }
};
