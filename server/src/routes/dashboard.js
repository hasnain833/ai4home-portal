import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import { getDashboardStats, getHomeownerSummary } from "../controllers/dashboard.controller.js";

const router = express.Router();

router.get("/stats", requireAuth, getDashboardStats);
router.get("/homeowner", requireAuth, getHomeownerSummary);

export default router;
