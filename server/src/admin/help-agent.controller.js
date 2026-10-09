import prisma from "../lib/prisma.js";
import { writeAuditLog } from "../lib/audit.js";
import { chat, hasLLM, aiUnavailableMessage } from "../lib/llm.js";
import { denyUnlessSuperAdmin } from "../middlewares/auth.js";
import { renderTemplate, checkTokens } from "../prompts/template.js";
import { HELP_AGENT_DEFAULT_PROMPT, HELP_PLACEHOLDERS, PLATFORM_GUIDE } from "../prompts/help-agent.js";
import { queryHelp } from "../services/vector-store.service.js";
import { SUPPORT_CONTACT_KEY, DEFAULT_SUPPORT_CONTACT } from "./platform.controller.js";

const PROMPT_KEY = "help-agent.prompt";
const MAX_TURNS = 20;
const MAX_MESSAGE_CHARS = 4000;

async function setting(key) {
  return (await prisma.platformSetting.findUnique({ where: { key } }))?.value || null;
}

async function livePrompt() {
  return (await setting(PROMPT_KEY))?.prompt || HELP_AGENT_DEFAULT_PROMPT;
}

export const getHelpAgent = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;
    const saved = (await setting(PROMPT_KEY))?.prompt || null;
    return res.json({
      prompt: saved || HELP_AGENT_DEFAULT_PROMPT,
      isDefault: !saved,
      defaultPrompt: HELP_AGENT_DEFAULT_PROMPT,
      placeholders: HELP_PLACEHOLDERS,
    });
  } catch (error) {
    console.error("[Help Agent] Load failed:", error);
    return res.status(500).json({ message: "Failed to load the Help Agent" });
  }
};

// An empty prompt, or the default itself, resets to the built-in default.
export const saveHelpAgent = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";

    if (!prompt || prompt === HELP_AGENT_DEFAULT_PROMPT.trim()) {
      await prisma.platformSetting.deleteMany({ where: { key: PROMPT_KEY } });
    } else {
      const { errors } = checkTokens(prompt, HELP_PLACEHOLDERS);
      if (errors.length) return res.status(400).json({ message: errors[0], errors });
      await prisma.platformSetting.upsert({
        where: { key: PROMPT_KEY },
        create: { key: PROMPT_KEY, value: { prompt } },
        update: { value: { prompt } },
      });
    }

    await writeAuditLog({ req, action: "help_agent.prompt_saved", targetType: "PlatformSetting", targetId: PROMPT_KEY, metadata: { reset: !prompt } });
    return res.json({ ok: true, isDefault: !prompt || prompt === HELP_AGENT_DEFAULT_PROMPT.trim() });
  } catch (error) {
    console.error("[Help Agent] Save failed:", error);
    return res.status(500).json({ message: "Failed to save the Help Agent prompt" });
  }
};

// Builder admins and staff ask; super admins can also test an unsaved prompt.
export const helpChat = async (req, res) => {
  try {
    const user = req.user;
    if (!user?.isSuperAdmin && !["ADMIN", "STAFF"].includes(String(user?.role).toUpperCase())) {
      return res.status(403).json({ message: "The Help Assistant is for builder staff." });
    }

    const messages = (Array.isArray(req.body?.messages) ? req.body.messages : [])
      .filter((m) => ["user", "assistant"].includes(m?.role) && typeof m.content === "string" && m.content.trim())
      .slice(-MAX_TURNS)
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
    while (messages.length && messages[0].role !== "user") messages.shift();
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return res.status(400).json({ message: "Ask a question first." });
    }
    if (!hasLLM()) return res.status(503).json({ message: aiUnavailableMessage() });

    const draft = user.isSuperAdmin && typeof req.body?.draftPrompt === "string" && req.body.draftPrompt.trim();
    const [template, support, company, kb] = await Promise.all([
      draft || livePrompt(),
      setting(SUPPORT_CONTACT_KEY),
      user.companyId ? prisma.company.findUnique({ where: { id: user.companyId }, select: { name: true } }) : null,
      queryHelp(messages[messages.length - 1].content, 5),
    ]);

    const kbContext = kb.results.length
      ? kb.results.map((r) => `[${r.name}]\n${r.text}`).join("\n\n---\n\n")
      : "(none matched)";
    const system = renderTemplate(template, {
      userName: user.name || user.email || "there",
      userRole: user.isSuperAdmin ? "AI4HB super admin" : String(user.role).toLowerCase(),
      companyName: company?.name || "their company",
      currentPage: String(req.body?.page || "unknown").slice(0, 200),
      supportPhone: support?.phone || DEFAULT_SUPPORT_CONTACT.phone,
      kbContext,
      portalGuide: PLATFORM_GUIDE,
    });

    const reply = await chat({ companyId: user.companyId || null, system, messages, maxTokens: 900 });
    if (!reply) return res.status(502).json({ message: "The assistant couldn't answer just now. Please try again." });

    return res.json({ reply, sources: kb.results.map((r) => r.name).filter((n, i, a) => a.indexOf(n) === i) });
  } catch (error) {
    console.error("[Help Agent] Chat failed:", error);
    return res.status(500).json({ message: "The assistant couldn't answer just now. Please try again." });
  }
};
