import { Router } from "express";
import { requireRoles } from "../middlewares/auth.js";
import {
  getAppointments,
  bookAppointment,
  getSlots,
  triggerCta,
  getAvailableAppointmentStaff,
  assignAppointmentStaff,
} from "../controllers/appointments.controller.js";

const router = Router();

router.get("/", getAppointments);
router.post("/", requireRoles(["ADMIN", "STAFF"]), bookAppointment);
router.get("/slots", requireRoles(["ADMIN", "STAFF"]), getSlots);
router.post("/cta-trigger", requireRoles(["ADMIN", "STAFF"]), triggerCta);
router.get("/:id/available-staff", requireRoles(["ADMIN", "STAFF"]), getAvailableAppointmentStaff);
router.patch("/:id/assign", requireRoles(["ADMIN", "STAFF"]), assignAppointmentStaff);

export default router;
