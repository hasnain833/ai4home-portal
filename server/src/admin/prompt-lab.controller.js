import prisma from "../lib/prisma.js";
import { writeAuditLog } from "../lib/audit.js";
import {
  buildDraftPromptForTesting,
  runDraftTurnForTesting,
} from "../inngest/functions/appointment.js";
import { queryDetailed as kbQueryDetailed } from "../services/vector-store.service.js";
import { KB_SCOPES } from "../lib/sales-ai.js";
import { getAvailableSlots, getAvailabilitySetting } from "../services/scheduling-service.js";
import { hasPlatformAi } from "../lib/ai-config.js";
import {
  PROMPT_DEFAULTS,
  PROMPT_PLACEHOLDERS,
  validatePromptDraft,
} from "../lib/sales-agent-prompt.js";

function denyUnlessSuperAdmin(req, res) {
  if (!req.user?.isSuperAdmin) {
    res.status(403).json({ message: "Unauthorized" });
    return true;
  }
  return false;
}

const MAX_TRANSCRIPT_TURNS = 40;

function normalizeDraft(body = {}) {
  return {
    systemTemplate: typeof body.systemTemplate === "string" ? body.systemTemplate : PROMPT_DEFAULTS.systemTemplate,
    toolDescription:
      typeof body.toolDescription === "string" ? body.toolDescription : PROMPT_DEFAULTS.toolDescription,
    kbEmptyText: typeof body.kbEmptyText === "string" ? body.kbEmptyText : PROMPT_DEFAULTS.kbEmptyText,
  };
}

export const getPromptLab = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;

    let versions = [];
    let tableReady = true;
    try {
      versions = await prisma.salesAgentPromptVersion.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
      });
    } catch {
      tableReady = false;
    }

    return res.json({
      defaults: PROMPT_DEFAULTS,
      placeholders: PROMPT_PLACEHOLDERS,
      versions,
      // The draft to reopen the editor with — not a prompt that is running anywhere.
      currentDraft: versions.find((v) => v.isActive) || null,
      tableReady,
    });
  } catch (error) {
    console.error("[Prompt Lab] Failed to load:", error);
    return res.status(500).json({ message: "Failed to load the prompt lab" });
  }
};

export const savePromptVersion = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;

    const draft = normalizeDraft(req.body);
    const { errors, warnings } = validatePromptDraft(draft);
    if (errors.length) {
      return res.status(400).json({ message: errors[0], errors, warnings });
    }

    const label = typeof req.body?.label === "string" && req.body.label.trim() ? req.body.label.trim().slice(0, 120) : null;
    const notes = typeof req.body?.notes === "string" && req.body.notes.trim() ? req.body.notes.trim().slice(0, 2000) : null;

    const version = await prisma.$transaction(async (tx) => {
      await tx.salesAgentPromptVersion.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
      return tx.salesAgentPromptVersion.create({
        data: {
          ...draft,
          label,
          notes,
          isActive: true,
          createdById: req.user?.id || null,
          createdByName: req.user?.name || req.user?.email || null,
        },
      });
    });

    await writeAuditLog({
      req,
      action: "sales_agent_prompt.version_saved",
      targetType: "SalesAgentPromptVersion",
      targetId: version.id,
      metadata: { label, warnings },
    });

    return res.status(201).json({ version, warnings });
  } catch (error) {
    console.error("[Prompt Lab] Failed to save version:", error);
    return res.status(500).json({ message: "Failed to save this version" });
  }
};

/**
 * Marks which saved draft the lab opens by default. `isActive` is a lab bookmark,
 * not a deploy switch — no live agent reads this row.
 */
export const setCurrentPromptVersion = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;
    const { versionId } = req.params;

    const exists = await prisma.salesAgentPromptVersion.findUnique({ where: { id: versionId } });
    if (!exists) return res.status(404).json({ message: "Version not found" });

    const version = await prisma.$transaction(async (tx) => {
      await tx.salesAgentPromptVersion.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
      return tx.salesAgentPromptVersion.update({
        where: { id: versionId },
        data: { isActive: true },
      });
    });

    await writeAuditLog({
      req,
      action: "sales_agent_prompt.version_set_current",
      targetType: "SalesAgentPromptVersion",
      targetId: version.id,
      metadata: { label: version.label },
    });

    return res.json({ version });
  } catch (error) {
    console.error("[Prompt Lab] Failed to activate version:", error);
    return res.status(500).json({ message: "Failed to activate this version" });
  }
};

export const deletePromptVersion = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;
    const { versionId } = req.params;

    const existing = await prisma.salesAgentPromptVersion.findUnique({ where: { id: versionId } });
    if (!existing) return res.status(404).json({ message: "Version not found" });

    await prisma.salesAgentPromptVersion.delete({ where: { id: versionId } });

    await writeAuditLog({
      req,
      action: "sales_agent_prompt.version_deleted",
      targetType: "SalesAgentPromptVersion",
      targetId: versionId,
      metadata: { label: existing.label },
    });

    return res.json({ message: "Version deleted" });
  } catch (error) {
    console.error("[Prompt Lab] Failed to delete version:", error);
    return res.status(500).json({ message: "Failed to delete this version" });
  }
};


async function resolveTestContext({ companyId, question }) {
  const company = companyId
    ? await prisma.company.findUnique({ where: { id: companyId } })
    : await prisma.company.findFirst({ orderBy: { createdAt: "asc" } });

  if (!company) return { error: "No company exists to test against." };

  let kbChunks = [];
  let retrievalMethod = null;
  if (question) {
    try {
      const { method, results } = await kbQueryDetailed(company.id, question, 5, KB_SCOPES.scheduling);
      kbChunks = results || [];
      retrievalMethod = method || null;
    } catch (e) {
      console.warn("[Prompt Lab] KB retrieval failed:", e.message);
    }
  }

  const setting = await getAvailabilitySetting(company.id).catch(() => null);
  const timezone = setting?.timezone || "America/Los_Angeles";

  let slots = [];
  try {
    const found = await getAvailableSlots({
      companyId: company.id,
      agentId: null,
      days: 14,
      limit: 8,
      displayTz: timezone,
    });
    slots = (found || []).map((x) => ({ iso: x.iso, label: x.label }));
  } catch (e) {
    console.warn("[Prompt Lab] Slot lookup failed:", e.message);
  }

  return {
    company,
    kbChunks,
    retrievalMethod,
    timezone,
    slots,
    channel: "WEBCHAT",
  };
}

function mockLead(company, firstName) {
  return {
    id: "prompt-lab-lead",
    companyId: company.id,
    company,
    firstName: (typeof firstName === "string" && firstName.trim()) || "Guest",
    lastName: "Tester",
    email: "prompt-lab@example.com",
  };
}

/** Renders the prompt exactly as the agent would see it — no model call. */
export const previewPrompt = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;

    const draft = normalizeDraft(req.body?.draft || req.body);
    const ctx = await resolveTestContext({
      companyId: req.body?.companyId,
      question: req.body?.question || "",
    });
    if (ctx.error) return res.status(400).json({ message: ctx.error });

    const { system, tool, slotList } = buildDraftPromptForTesting(
      {
        lead: mockLead(ctx.company, req.body?.leadFirstName),
        company: ctx.company,
        channel: ctx.channel,
        slots: ctx.slots,
        timezone: ctx.timezone,
        kbChunks: ctx.kbChunks,
        retrievalMethod: ctx.retrievalMethod,
      },
      draft,
    );

    return res.json({
      system,
      toolDescription: tool.description,
      context: {
        companyId: ctx.company.id,
        companyName: ctx.company.name,
        channel: ctx.channel,
        timezone: ctx.timezone,
        slotCount: ctx.slots.length,
        slotList,
        kbChunkCount: ctx.kbChunks.length,
        retrievalMethod: ctx.retrievalMethod,
      },
      validation: validatePromptDraft(draft),
    });
  } catch (error) {
    console.error("[Prompt Lab] Preview failed:", error);
    return res.status(500).json({ message: "Failed to render this prompt" });
  }
};

export const promptLabChat = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;

    const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(-MAX_TRANSCRIPT_TURNS) : [];
    if (!messages.length) {
      return res.status(400).json({ message: "Send at least one message to test with." });
    }

    const draft = normalizeDraft(req.body?.draft || {});
    const { errors } = validatePromptDraft(draft);
    if (errors.length) {
      return res.status(400).json({ message: errors[0], errors });
    }

    const ctx = await resolveTestContext({
      companyId: req.body?.companyId,
      question: messages[messages.length - 1]?.content || "",
    });
    if (ctx.error) return res.status(400).json({ message: ctx.error });

    if (!(await hasPlatformAi())) {
      return res.status(503).json({
        message: "No platform AI key is set. Add one under Admin → AI Keys and the lab will use it.",
      });
    }

    const startedAt = Date.now();
    const response = await runDraftTurnForTesting(
      {
        lead: mockLead(ctx.company, req.body?.leadFirstName),
        company: ctx.company,
        channel: ctx.channel,
        transcript: messages,
        slots: ctx.slots,
        timezone: ctx.timezone,
        kbChunks: ctx.kbChunks,
        retrievalMethod: ctx.retrievalMethod,
      },
      draft,
    );

    return res.json({
      action: response.action,
      message: response.message,
      slot_iso: response.slot_iso || null,
      location_type: response.location_type || null,
      used_kb: response.used_kb ?? null,
      handoff_reason: response.handoff_reason || null,
      optout_request: response.optout_request ?? false,
      diagnostics: {
        companyName: ctx.company.name,
        timezone: ctx.timezone,
        kbChunkCount: ctx.kbChunks.length,
        retrievalMethod: ctx.retrievalMethod,
        slotCount: ctx.slots.length,
        latencyMs: Date.now() - startedAt,
        characters: (response.message || "").length,
      },
    });
  } catch (error) {
    console.error("[Prompt Lab] Chat failed:", error);
    return res.status(500).json({ message: "The agent could not complete this turn" });
  }
};
