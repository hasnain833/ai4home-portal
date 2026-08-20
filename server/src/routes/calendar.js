import { Router } from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import {
  getCalendarEvents,
  createCalendarEvent,
  getCalendarSuggestions,
  updateCalendarEvent,
  transitionCalendarEvent
} from "../controllers/calendar.controller.js";

const router = Router();

// SRS 4.12: a homeowner may VIEW their own calendar items — reads are already
// scoped by ownerScope() in the controller. Creating items, generating AI
// suggestions and approving or rescheduling are builder actions.
const builderOnly = requireRoles(["ADMIN", "STAFF"]);

router.get("/", requireAuth, getCalendarEvents);
router.post("/", requireAuth, builderOnly, createCalendarEvent);
router.post("/suggestions", requireAuth, builderOnly, getCalendarSuggestions);
router.patch("/:id/status", requireAuth, builderOnly, transitionCalendarEvent);
router.patch("/:id", requireAuth, builderOnly, updateCalendarEvent);

export default router;
