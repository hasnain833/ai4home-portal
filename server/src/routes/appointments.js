import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  getAppointments,
  bookAppointment,
  getSlots,
  triggerCta
} from "../controllers/appointments.controller.js";

const router = Router();

router.get("/", requireAuth, getAppointments);
router.post("/", bookAppointment);
router.get("/slots", getSlots);
router.post("/cta-trigger", triggerCta);

export default router;
