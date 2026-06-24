import { Router } from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import {
  getSuppressions,
  addSuppression,
  deleteSuppression,
  processInbound,
  unsubscribeWebhook,
  processBrevoInboundEmail
} from "../controllers/compliance.controller.js";

const router = Router();

router.get("/suppression", requireAuth, requireRoles(["ADMIN", "STAFF"]), getSuppressions);
router.post("/suppression", requireAuth, requireRoles(["ADMIN", "STAFF"]), addSuppression);
router.delete("/suppression", requireAuth, requireRoles(["ADMIN", "STAFF"]), deleteSuppression);

router.post("/inbound", processInbound);
router.post("/unsubscribe", unsubscribeWebhook);
router.post("/inbound/email", processBrevoInboundEmail);

export default router;
