import { Router } from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { getDashboardStats, exportDashboardCsv, getAgentPerformance } from "../controllers/sales-dashboard.controller.js";

const router = Router();

router.get("/", requireAuth, getDashboardStats);
router.get("/agent-performance", requireAuth, requireRoles(["ADMIN", "STAFF"]), getAgentPerformance);
// The CSV exporters are company-wide by construction, so they must not be
// reachable by a homeowner, whose view is limited to their own leads.
router.get("/export", requireAuth, requireRoles(["ADMIN", "STAFF"]), exportDashboardCsv);

export default router;
