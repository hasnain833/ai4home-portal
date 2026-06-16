import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  getCalendarEvents,
  createCalendarEvent,
  getCalendarSuggestions
} from "../controllers/calendar.controller.js";

const router = Router();

router.get("/", requireAuth, getCalendarEvents);
router.post("/", requireAuth, createCalendarEvent);
router.post("/suggestions", requireAuth, getCalendarSuggestions);

export default router;
