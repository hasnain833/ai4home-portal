import express from "express";
import { bookAppointment, chatDemo } from "../controllers/sales-agent.controller.js";

const router = express.Router();

router.post("/book", bookAppointment);
router.post("/chat", chatDemo);

export default router;
