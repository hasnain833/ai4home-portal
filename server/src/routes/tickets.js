import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  getTickets,
  createTicket,
  getTicket,
  updateTicket,
  dispatchTicket
} from "../controllers/tickets.controller.js";

const router = express.Router();

router.get("/", requireAuth, getTickets);
router.post("/", requireAuth, createTicket);
router.get("/:id", requireAuth, getTicket);
router.patch("/:id", requireAuth, updateTicket);
router.post("/:id/dispatch", requireAuth, dispatchTicket);

export default router;
