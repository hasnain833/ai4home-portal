import { Router } from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { verifyWebhookSecret } from "../middlewares/webhook-auth.js";
import {
  getSuppressions,
  addSuppression,
  deleteSuppression,
  processInbound,
  unsubscribeWebhook,
  processBrevoInboundEmail,
  processBrevoInboundSms,
  processBrevoEmailEvents,
  processBrevoSmsEvents,
} from "../controllers/compliance.controller.js";

const router = Router();

router.get("/suppression", requireAuth, requireRoles(["ADMIN", "STAFF"]), getSuppressions);
router.post("/suppression", requireAuth, requireRoles(["ADMIN", "STAFF"]), addSuppression);
router.delete("/suppression", requireAuth, requireRoles(["ADMIN", "STAFF"]), deleteSuppression);
router.post("/inbound", verifyWebhookSecret, processInbound);
router.post("/unsubscribe", verifyWebhookSecret, unsubscribeWebhook);
router.post("/inbound/email", verifyWebhookSecret, processBrevoInboundEmail);
router.post("/inbound/sms", verifyWebhookSecret, processBrevoInboundSms);
router.post("/events/email", verifyWebhookSecret, processBrevoEmailEvents);
router.post("/events/sms", verifyWebhookSecret, processBrevoSmsEvents);

export default router;
