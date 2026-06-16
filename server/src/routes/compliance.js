import { Router } from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import {
  getSuppressions,
  addSuppression,
  deleteSuppression,
  processInbound
} from "../controllers/compliance.controller.js";

const router = Router();

router.get("/suppression", requireAuth, requireRoles(["ADMIN", "STAFF"]), getSuppressions);
router.post("/suppression", requireAuth, requireRoles(["ADMIN", "STAFF"]), addSuppression);
router.delete("/suppression", requireAuth, requireRoles(["ADMIN", "STAFF"]), deleteSuppression);

router.post("/inbound", processInbound);

export default router;
