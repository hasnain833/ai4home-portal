import { Router } from "express";
import prisma from "../lib/prisma.js";
import { processWarrantyTurn } from "../lib/warranty-orchestrator.js";

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
    });
  } catch (err) {
    console.error("Error in warranty chat:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

async function postReset(req, res) {
  try {
    const { conversationId } = req.body;
    const { companyId, homeownerId: sessionHomeownerId } = resolveActor(req);

    if (!companyId || !conversationId) {
      return res.status(400).json({ error: "companyId and conversationId are required" });
    }

    const convo = await prisma.warrantyConversation.findUnique({ where: { id: conversationId } });
    if (!convo || convo.companyId !== companyId) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    await prisma.warrantyConversation.update({
      where: { id: convo.id },
      data: {
        transcript: [],
        phase: "INTAKE",
        status: "ACTIVE",
        issueState: null,
        propertyId: null,
        homeownerId: sessionHomeownerId || null,
        ticketId: null,
        turnCount: 0,
      },
    });

    return res.json({ conversationId: convo.id, phase: "INTAKE", reset: true });
  } catch (err) {
    console.error("Error resetting warranty chat:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

export const publicWarrantyChatRouter = Router();
publicWarrantyChatRouter.post("/", postMessage);
publicWarrantyChatRouter.post("/reset", postReset);

function conversationPreview(transcript) {
  const turns = Array.isArray(transcript) ? transcript : [];
  const source = turns.find((t) => t.role === "user") || turns[turns.length - 1];
  const text = String(source?.content || "").replace(/\s+/g, " ").trim();
  return text.slice(0, 140) || null;
}

const router = Router();

router.get("/conversations", async (req, res) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const role = String(req.user?.role || "").toUpperCase();
    const where = { companyId, turnCount: { gt: 0 } };

    if (role === "HOMEOWNER") {
      where.homeownerId = req.user.id;
    } else if (req.query.homeownerId) {
      where.homeownerId = String(req.query.homeownerId);
    }

    const rows = await prisma.warrantyConversation.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        phase: true,
        status: true,
        ticketId: true,
        turnCount: true,
        createdAt: true,
        updatedAt: true,
        homeownerId: true,
        propertyId: true,
        transcript: true,
      },
    });

    return res.json({
      conversations: rows.map(({ transcript, ...row }) => ({
        ...row,
        preview: conversationPreview(transcript),
      })),
    });
  } catch (err) {
    console.error("Error listing warranty conversations:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/conversations/:id", async (req, res) => {
  try {
    const convo = await prisma.warrantyConversation.findUnique({
      where: { id: req.params.id },
    });

    if (!convo) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    if (!req.user?.companyId || convo.companyId !== req.user.companyId) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    if (String(req.user.role || "").toUpperCase() === "HOMEOWNER" && convo.homeownerId !== req.user.id) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    return res.json({
      transcript: convo.transcript,
      phase: convo.phase,
      status: convo.status,
      ticketId: convo.ticketId,
    });
  } catch (err) {
    console.error("Error fetching conversation:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", postMessage);
router.post("/reset", postReset);

export default router;
