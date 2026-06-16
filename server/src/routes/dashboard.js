import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import { getDashboardStats } from "../controllers/dashboard.controller.js";

const router = express.Router();

router.get("/stats", requireAuth, getDashboardStats);

export default router;
