import express from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { getAnalytics } from "../controllers/reports.controller.js";

const router = express.Router();

router.get("/analytics", requireAuth, requireRoles(["ADMIN", "STAFF"]), getAnalytics);

export default router;
