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
  listAgents,
  AGENT_TYPES,
} from "../prompts/index.js";
import { getLivePrompts, invalidateLivePrompts } from "../prompts/live.js";

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

    const liveRow = versions.find((v) => v.isLive) || null;
    const live = await getLivePrompts(AGENT_TYPES.SALES);

    return res.json({
      defaults: PROMPT_DEFAULTS,
      placeholders: PROMPT_PLACEHOLDERS,
      agents: listAgents(),
      versions,
      // The draft to reopen the editor with — not a prompt that is running anywhere.
      currentDraft: versions.find((v) => v.isActive) || null,
      // What real leads are actually talking to right now.
      live: {
        source: live.meta.source,
        versionId: liveRow?.id || null,
        label: liveRow?.label || null,
        setLiveAt: liveRow?.setLiveAt || null,
        setLiveByName: liveRow?.setLiveByName || null,
      },
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

/**
 * Puts a saved version in front of real leads.
 *
 * This is the ONLY path by which a Prompt Lab draft reaches production, and it is
 * deliberately separate from saving. Guards, in order:
 *   - super-admin only
 *   - the version must still pass validatePromptDraft (a draft saved before a
 *     validation rule was added must not slip through)
 *   - warnings must be acknowledged explicitly via body.acknowledgeWarnings
 *   - exactly one row may be live, swapped inside a transaction
 *   - the cache in prompts/live.js is invalidated so the change is immediate
 */
export const setPromptVersionLive = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;
    const { versionId } = req.params;

    const target = await prisma.salesAgentPromptVersion.findUnique({ where: { id: versionId } });
    if (!target) return res.status(404).json({ message: "Version not found" });

    const { errors, warnings } = validatePromptDraft({
      systemTemplate: target.systemTemplate,
      toolDescription: target.toolDescription,
      kbEmptyText: target.kbEmptyText,
    });
    if (errors.length) {
      return res.status(400).json({
        message: "This version can't go live until its errors are fixed.",
        errors,
        warnings,
      });
    }
    if (warnings.length && !req.body?.acknowledgeWarnings) {
      return res.status(409).json({
        message: "This version goes live with warnings. Confirm to continue.",
        needsAcknowledgement: true,
        warnings,
      });
    }

    const previous = await prisma.salesAgentPromptVersion.findFirst({ where: { isLive: true } });

    const version = await prisma.$transaction(async (tx) => {
      await tx.salesAgentPromptVersion.updateMany({
        where: { isLive: true },
        data: { isLive: false },
      });
      return tx.salesAgentPromptVersion.update({
        where: { id: versionId },
        data: {
          isLive: true,
          setLiveAt: new Date(),
          setLiveById: req.user?.id || null,
          setLiveByName: req.user?.name || req.user?.email || null,
        },
      });
    });

    invalidateLivePrompts(AGENT_TYPES.SALES);

    await writeAuditLog({
      req,
      action: "sales_agent_prompt.set_live",
      targetType: "SalesAgentPromptVersion",
      targetId: version.id,
      metadata: {
        label: version.label,
        warnings,
        previousLiveId: previous?.id || null,
        previousLiveLabel: previous?.label || null,
      },
    });

    return res.json({ version, warnings, previousLiveId: previous?.id || null });
  } catch (error) {
    console.error("[Prompt Lab] Set live failed:", error);
    return res.status(500).json({ message: "Failed to put this version live" });
  }
};

/** Drops back to the prompts that ship in code. The always-available escape hatch. */
export const revertToCodeDefaults = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;

    const previous = await prisma.salesAgentPromptVersion.findFirst({ where: { isLive: true } });
    if (!previous) {
      return res.json({ message: "Already running the code defaults.", changed: false });
    }

    await prisma.salesAgentPromptVersion.updateMany({
      where: { isLive: true },
      data: { isLive: false },
    });

    invalidateLivePrompts(AGENT_TYPES.SALES);

    await writeAuditLog({
      req,
      action: "sales_agent_prompt.reverted_to_defaults",
      targetType: "SalesAgentPromptVersion",
      targetId: previous.id,
      metadata: { label: previous.label },
    });

    return res.json({ message: "Reverted to the code defaults.", changed: true });
  } catch (error) {
    console.error("[Prompt Lab] Revert failed:", error);
    return res.status(500).json({ message: "Failed to revert" });
  }
};

export const deletePromptVersion = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;
    const { versionId } = req.params;

    const existing = await prisma.salesAgentPromptVersion.findUnique({ where: { id: versionId } });
    if (!existing) return res.status(404).json({ message: "Version not found" });

    // Deleting the live version would silently drop the agent back to the code
    // defaults with no record of the change. Make it a deliberate revert instead.
    if (existing.isLive) {
      return res.status(409).json({
        message:
          "This version is live. Set another version live, or revert to the code defaults, before deleting it.",
      });
    }

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


/**
 * The context a lab turn runs against.
 *
 * Knowledge-base retrieval is deliberately PLATFORM-only: the lab tests the shared
 * documents a super-admin uploads here, not any one builder's private KB. Passing
 * a null companyId is what restricts it — see the scope filter in
 * services/vector-store.service.js.
 *
 * A company is still resolved, because the prompt needs a name to render and the
 * booking rules need real slots and a timezone. It supplies those and nothing else.
 */
async function resolveTestContext({ question }) {
  const company = await prisma.company.findFirst({ orderBy: { createdAt: "asc" } });

  if (!company) return { error: "No company exists to test against." };

  let kbChunks = [];
  let retrievalMethod = null;
  if (question) {
    try {
      const { method, results } = await kbQueryDetailed(null, question, 5, KB_SCOPES.scheduling);
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

/**
 * The passages retrieval returned, trimmed for transport.
 *
 * The lab shows these so a prompt can be judged against what the agent was
 * actually given — a weak answer caused by a KB gap looks identical to one caused
 * by a bad prompt until you can see the retrieved text.
 */
function describeChunks(chunks = []) {
  return chunks.map((c) => ({
    documentId: c.documentId,
    name: c.name || "",
    category: c.category || "General",
    scope: c.scope || "COMPANY",
    score: Number(c.score) || 0,
    excerpt: String(c.text || "").slice(0, 1200),
    truncated: String(c.text || "").length > 1200,
  }));
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
    const ctx = await resolveTestContext({ question: req.body?.question || "" });
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
      retrieved: describeChunks(ctx.kbChunks),
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
      retrieved: describeChunks(ctx.kbChunks),
    });
  } catch (error) {
    console.error("[Prompt Lab] Chat failed:", error);
    return res.status(500).json({ message: "The agent could not complete this turn" });
  }
};
