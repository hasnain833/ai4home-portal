import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import { getAnalytics } from "../controllers/reports.controller.js";

const router = express.Router();

router.get("/analytics", requireAuth, getAnalytics);

export default router;
