import { Router } from "express";
import { processDemoTurn } from "../lib/warranty-demo-flow.js";
import {
  newDemoConversation,
  getDemoConversation,
  saveDemoConversation,
  clearDemoConversation,
  isDemoConversationId,
} from "../lib/warranty-session.js";

const router = Router();

function isDemoRequest(req) {
  const { companyId, conversationId } = req.body || {};
  return !companyId || isDemoConversationId(conversationId);
}

router.post("/", async (req, res, next) => {
  if (!isDemoRequest(req)) return next();

  try {
    const { conversationId, message } = req.body || {};

    if (typeof message !== "string" || !message.trim() || message.length > 4000) {
      return res.status(400).json({ error: "message must be a non-empty string under 4000 characters" });
    }

    let convo = getDemoConversation(conversationId);
    if (!convo) convo = saveDemoConversation(newDemoConversation());

    const result = await processDemoTurn({ state: convo.issueState || {}, message });

    convo.issueState = result.state;
    convo.phase = result.phase;
    convo.turnCount = (convo.turnCount || 0) + 1;
    convo.transcript = [
      ...(convo.transcript || []),
      { role: "user", content: message, at: new Date().toISOString() },
      { role: "agent", content: result.reply, at: new Date().toISOString() },
    ];
    saveDemoConversation(convo);

    return res.json({
      conversationId: convo.id,
      reply: result.reply,
      phase: result.phase,
      demo: true,
    });
  } catch (err) {
    console.error("[Warranty Demo] turn failed:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/reset", (req, res, next) => {
  if (!isDemoRequest(req)) return next();

  const { conversationId } = req.body || {};
  if (conversationId) clearDemoConversation(conversationId);
  return res.json({ reset: true, demo: true, phase: "INTAKE" });
});

export default router;
