import express from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { getDashboardStats, getHomeownerSummary } from "../controllers/dashboard.controller.js";

const router = express.Router();

router.get("/stats", requireAuth, requireRoles(["ADMIN", "STAFF"]), getDashboardStats);
router.get("/homeowner", requireAuth, getHomeownerSummary);

export default router;
