import express from "express";
import { bookAppointment, sendAgentMessage } from "../controllers/sales-agent.controller.js";

const router = express.Router();

router.post("/book", bookAppointment);
router.post("/message", sendAgentMessage);

export default router;
