import { Router } from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import {
  getCalendarEvents,
  createCalendarEvent,
  getLibraryIdeas,
  useLibraryIdea,
  updateCalendarEvent,
  transitionCalendarEvent
} from "../controllers/calendar.controller.js";

const router = Router();

const builderOnly = requireRoles(["ADMIN", "STAFF"]);

router.get("/", requireAuth, getCalendarEvents);
router.post("/", requireAuth, builderOnly, createCalendarEvent);
// Ideas published by the AI4Home team; builders add or dismiss them (no own AI suggestions).
router.get("/library", requireAuth, builderOnly, getLibraryIdeas);
router.post("/library/:id/use", requireAuth, builderOnly, useLibraryIdea);
router.post("/library/:id/dismiss", requireAuth, builderOnly, useLibraryIdea);
router.patch("/:id/status", requireAuth, builderOnly, transitionCalendarEvent);
router.patch("/:id", requireAuth, builderOnly, updateCalendarEvent);

export default router;
