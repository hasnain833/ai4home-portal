import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  getTickets,
  createTicket,
  getTicket,
  updateTicket
} from "../controllers/tickets.controller.js";

const router = express.Router();

router.get("/", requireAuth, getTickets);
router.post("/", requireAuth, createTicket);
router.get("/:id", requireAuth, getTicket);
router.patch("/:id", requireAuth, updateTicket);

export default router;
