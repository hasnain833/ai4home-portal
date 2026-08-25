import { Router } from "express";
import prisma from "../lib/prisma.js";
import { processWarrantyTurn } from "../lib/warranty-orchestrator.js";

const router = Router();

// Retrieve conversation history
router.get("/conversations/:id", async (req, res) => {
  try {
    const convo = await prisma.warrantyConversation.findUnique({
      where: { id: req.params.id },
    });
    
    if (!convo) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    
    return res.json({ transcript: convo.transcript, phase: convo.phase, status: convo.status });
  } catch (err) {
    console.error("Error fetching conversation:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Chat endpoint
router.post("/", async (req, res) => {
  try {
    const { companyId, conversationId, message, homeownerId } = req.body;

    if (!companyId || !message) {
      return res.status(400).json({ error: "companyId and message are required" });
    }

    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    let convo;
    if (conversationId) {
      convo = await prisma.warrantyConversation.findUnique({ where: { id: conversationId } });
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
    }

    // Process turn via Orchestrator
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
});

export default router;
