import { Router } from "express";
import prisma from "../lib/prisma.js";
import { processWarrantyTurn } from "../lib/warranty-orchestrator.js";

/**
 * Two routers, because these endpoints do not share a trust level.
 *
 * The embedded widget is anonymous by nature — a homeowner on the builder's
 * website has no portal session — so sending a message has to be reachable
 * without auth. Reading a stored transcript does not: it returns another
 * person's conversation to anyone holding an ID, so it lives on the
 * authenticated portal mount only, scoped to the caller's own company.
 */

/**
 * How long a conversation may sit idle before the next message starts a fresh
 * one. This is the Timeout flow's practical equivalent: web chat has no push
 * channel to nudge an absent homeowner, so instead of resuming a claim someone
 * abandoned hours ago mid-diagnosis, the stale thread is closed and the next
 * message opens a new one.
 */
const IDLE_MINUTES = Number(process.env.WARRANTY_SESSION_IDLE_MINUTES || 30);

function isStale(convo) {
  if (!convo?.updatedAt) return false;
  return Date.now() - new Date(convo.updatedAt).getTime() > IDLE_MINUTES * 60 * 1000;
}

/**
 * Who the caller is allowed to act as.
 *
 * The two mounts establish identity in different ways, and that difference is
 * the whole point of splitting them:
 *
 *   - The embedded widget has no session, by design. A homeowner on the
 *     builder's public site is anonymous, so identity is earned inside the
 *     conversation — the agent asks for the email and looks it up. That means a
 *     `homeownerId` in the request body is worthless here and is ignored: the
 *     widget must not be able to assert an identity it never proved.
 *
 *   - The portal has a session. A signed-in homeowner IS the homeowner, so their
 *     identity comes from the session rather than the payload, and staff may act
 *     on their own company's homeowners but no one else's.
 */
function resolveActor(req) {
  const session = req.user;
  const sessionCompanyId = session?.companyId || null;
  const role = String(session?.role || "").toUpperCase();

  if (!sessionCompanyId) {
    // Anonymous widget: the company is named by the embed, identity is not.
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

/** Sends a message. Reachable by the anonymous widget; rate limited at the mount. */
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

    // A staff-supplied homeowner has to belong to the staff member's own company.
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
      // A conversation ID from another tenant is not usable here — start fresh
      // rather than letting one company's widget append to another's thread.
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

/**
 * Clears a conversation so the homeowner can start over.
 *
 * The Botpress equivalent was simply a new session. Here the row is reused so a
 * widget that has already stored the ID keeps working, and any ticket already
 * filed is deliberately left alone — resetting the chat must not orphan or
 * retract a claim the warranty team can already see.
 */
async function postReset(req, res) {
  try {
    const { conversationId } = req.body;
    const { companyId } = resolveActor(req);

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
        homeownerId: null,
        turnCount: 0,
      },
    });

    return res.json({ conversationId: convo.id, phase: "INTAKE", reset: true });
  } catch (err) {
    console.error("Error resetting warranty chat:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

/** Anonymous widget surface: send a message, start over. */
export const publicWarrantyChatRouter = Router();
publicWarrantyChatRouter.post("/", postMessage);
publicWarrantyChatRouter.post("/reset", postReset);

/** Authenticated portal surface: everything above, plus transcript reads. */
const router = Router();

router.get("/conversations/:id", async (req, res) => {
  try {
    const convo = await prisma.warrantyConversation.findUnique({
      where: { id: req.params.id },
    });

    if (!convo) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    // Staff may only read their own company's conversations.
    if (req.user?.companyId && convo.companyId !== req.user.companyId) {
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
