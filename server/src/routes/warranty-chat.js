import { Router } from "express";
import prisma from "../lib/prisma.js";
import { processWarrantyTurn } from "../lib/warranty-orchestrator.js";
import { getWarrantySuggestions } from "../services/warranty-suggestions.service.js";

const IDLE_MINUTES = Number(process.env.WARRANTY_SESSION_IDLE_MINUTES || 30);

function isStale(convo) {
  if (!convo?.updatedAt) return false;
  return Date.now() - new Date(convo.updatedAt).getTime() > IDLE_MINUTES * 60 * 1000;
}

function resolveActor(req) {
  const session = req.user;
  const sessionCompanyId = session?.companyId || null;
  const role = String(session?.role || "").toUpperCase();

  if (!sessionCompanyId) {
    return { companyId: req.body?.companyId || null, homeownerId: null, viaSession: false };
  }

  if (role === "HOMEOWNER") {
    return { companyId: sessionCompanyId, homeownerId: session.id, viaSession: true };
  }

  return {
    companyId: sessionCompanyId,
    homeownerId: req.body?.homeownerId || null,
    viaSession: true,
  };
}

async function postMessage(req, res) {
  try {
    const { conversationId, message } = req.body;
    const actor = resolveActor(req);
    const companyId = actor.companyId;
    let homeownerId = actor.homeownerId;

    if (!companyId || !message) {
      return res.status(400).json({ error: "companyId and message are required" });
    }

    if (typeof message !== "string" || message.length > 4000) {
      return res.status(400).json({ error: "message must be a string under 4000 characters" });
    }

    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    if (homeownerId && actor.viaSession) {
      const owner = await prisma.user.findUnique({
        where: { id: homeownerId },
        select: { companyId: true },
      });
      if (!owner || owner.companyId !== companyId) homeownerId = null;
    }

    let convo = null;
    if (conversationId) {
      convo = await prisma.warrantyConversation.findUnique({ where: { id: conversationId } });
      if (convo && convo.companyId !== companyId) convo = null;

      if (convo && isStale(convo)) {
        await prisma.warrantyConversation
          .update({ where: { id: convo.id }, data: { status: "CLOSED" } })
          .catch(() => null);
        convo = null;
      }
    }

    if (!convo) {
      convo = await prisma.warrantyConversation.create({
        data: {
          companyId,
          homeownerId: homeownerId || null,
          status: "ACTIVE",
          phase: "INTAKE",
          transcript: [],
        },
      });
    } else if (homeownerId && actor.viaSession && !convo.homeownerId) {
      convo = await prisma.warrantyConversation.update({
        where: { id: convo.id },
        data: { homeownerId },
      });
    }

    const result = await processWarrantyTurn({ company, convo, newMsg: message });

    return res.json({
      conversationId: convo.id,
      reply: result.reply,
      phase: result.phase,
      // Choices for this turn, for the client to render as buttons. Empty on
      // turns that ask an open question.
      options: Array.isArray(result.options) ? result.options : [],
    });
  } catch (err) {
    console.error("Error in warranty chat:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}



async function getSuggestions(req, res) {
  try {
    const companyId = req.user?.companyId || req.query?.companyId || null;
    return res.json({ suggestions: await getWarrantySuggestions(companyId) });
  } catch (error) {
    console.error("[Warranty chat] Suggestions failed:", error);
    return res.json({ suggestions: [] });
  }
}

export const publicWarrantyChatRouter = Router();
publicWarrantyChatRouter.get("/suggestions", getSuggestions);
publicWarrantyChatRouter.post("/", postMessage);

const router = Router();

router.get("/suggestions", getSuggestions);
router.post("/", postMessage);

export default router;
