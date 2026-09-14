import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  listAppointments,
  createAppointment,
  updateAppointment,
} from "../controllers/ticket-appointments.controller.js";

const router = express.Router();

router.get("/", requireAuth, listAppointments);
router.post("/", requireAuth, createAppointment);
router.patch("/:id", requireAuth, updateAppointment);

export default router;
