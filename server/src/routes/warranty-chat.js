import { Router } from "express";
import multer from "multer";
import prisma from "../lib/prisma.js";
import { handleUploadErrors } from "../middlewares/upload.js";
import { UploadRejected } from "../lib/file-security.js";
import {
  addConversationPhotos,
  removeConversationPhoto,
  listConversationPhotos,
  MAX_PHOTOS_PER_CLAIM,
} from "../services/warranty-photos.service.js";
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
    // Sent by the photo card's Done / Skip, never typed.
    const photoStepDone = req.body?.photoStepDone === true;
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

    const result = await processWarrantyTurn({ company, convo, newMsg: message, photoStepDone });

    return res.json({
      conversationId: convo.id,
      reply: result.reply,
      phase: result.phase,
      // Choices for this turn, for the client to render as buttons. Empty on
      // turns that ask an open question.
      options: Array.isArray(result.options) ? result.options : [],
      // Present on the turn the agent asks for photos; the client shows the card.
      photoRequest: result.photoRequest || null,
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

/**
 * The conversation a photo belongs to. The widget is anonymous, so the
 * unguessable conversation id is the credential — scoped to its company, still
 * open, and not yet turned into a ticket.
 */
async function photoConversation(req) {
  const conversationId = req.body?.conversationId || req.query?.conversationId || null;
  const companyId = resolveActor(req).companyId || req.query?.companyId || null;
  if (!conversationId || !companyId) return null;
  const convo = await prisma.warrantyConversation.findUnique({ where: { id: String(conversationId) } });
  if (!convo || convo.companyId !== companyId || convo.ticketId || isStale(convo)) return null;
  return convo;
}

async function uploadPhotos(req, res) {
  try {
    const convo = await photoConversation(req);
    if (!convo) return res.status(404).json({ error: "This conversation can no longer take photos." });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "No photos provided" });
    const photos = await addConversationPhotos(convo, files);
    return res.status(201).json({ photos, max: MAX_PHOTOS_PER_CLAIM });
  } catch (err) {
    if (err instanceof UploadRejected || err?.status) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    console.error("[Warranty chat] Photo upload failed:", err);
    return res.status(500).json({ error: "Could not upload the photos" });
  }
}

async function deletePhoto(req, res) {
  try {
    const convo = await photoConversation(req);
    if (!convo) return res.status(404).json({ error: "This conversation can no longer change photos." });
    const removed = await removeConversationPhoto(convo, req.params.photoId);
    if (!removed) return res.status(404).json({ error: "Photo not found" });
    return res.json({ photos: await listConversationPhotos(convo.id) });
  } catch (err) {
    console.error("[Warranty chat] Photo delete failed:", err);
    return res.status(500).json({ error: "Could not remove the photo" });
  }
}

// Phone photos are resized in the browser first; 8 MB leaves room for one that
// could not be (e.g. an unconverted HEIC), which the image check then rejects
// with a clear message rather than a size error.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: MAX_PHOTOS_PER_CLAIM },
});
const photoFiles = handleUploadErrors(upload.array("photos", MAX_PHOTOS_PER_CLAIM));

export const publicWarrantyChatRouter = Router();
publicWarrantyChatRouter.post("/photos", photoFiles, uploadPhotos);
publicWarrantyChatRouter.delete("/photos/:photoId", deletePhoto);
publicWarrantyChatRouter.get("/suggestions", getSuggestions);
publicWarrantyChatRouter.post("/", postMessage);

const router = Router();

router.get("/suggestions", getSuggestions);
router.post("/", postMessage);
router.post("/photos", photoFiles, uploadPhotos);
router.delete("/photos/:photoId", deletePhoto);

export default router;
