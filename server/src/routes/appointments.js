import { Router } from "express";
import { requireRoles } from "../middlewares/auth.js";
import {
  getAppointments,
  bookAppointment,
  getSlots,
  triggerCta
} from "../controllers/appointments.controller.js";

const router = Router();

router.get("/", getAppointments);
router.post("/", requireRoles(["ADMIN", "STAFF"]), bookAppointment);
router.get("/slots", requireRoles(["ADMIN", "STAFF"]), getSlots);
router.post("/cta-trigger", requireRoles(["ADMIN", "STAFF"]), triggerCta);

export default router;
