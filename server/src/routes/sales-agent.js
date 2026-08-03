import express from "express";
import { bookAppointment } from "../controllers/sales-agent.controller.js";

const router = express.Router();

router.post("/book", bookAppointment);

export default router;
