import { Router } from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { verifyTwilioSignature } from "../middlewares/twilio-auth.js";
import { verifyTelnyxSignature } from "../middlewares/telnyx-auth.js";
import { requireWebhookSecret } from "../middlewares/webhook-auth.js";
import { createRateLimiter } from "../middlewares/rate-limit.js";
import {
  getSuppressions,
  addSuppression,
  deleteSuppression,
  processInbound,
  unsubscribeWebhook,
  unsubscribeByLead,
  processBrevoInboundEmail,
  processTwilioInboundSms,
  processTelnyxInboundSms,
} from "../controllers/compliance.controller.js";

const router = Router();

router.get("/suppression", requireAuth, requireRoles(["ADMIN", "STAFF"]), getSuppressions);
router.post("/suppression", requireAuth, requireRoles(["ADMIN", "STAFF"]), addSuppression);
router.delete("/suppression", requireAuth, requireRoles(["ADMIN", "STAFF"]), deleteSuppression);
router.post("/inbound", requireWebhookSecret("Compliance Inbound"), processInbound);
router.post("/unsubscribe", requireWebhookSecret("Compliance Unsubscribe"), unsubscribeWebhook);
router.post("/inbound/email", requireWebhookSecret("Brevo Inbound"), processBrevoInboundEmail);

router.post(
  "/unsubscribe-link/:leadId",
  createRateLimiter({ max: 10, windowMs: 60_000, label: "Unsubscribe link" }),
  unsubscribeByLead,
);
router.post("/inbound/sms", verifyTwilioSignature, processTwilioInboundSms);
router.post("/inbound/sms/telnyx", verifyTelnyxSignature, processTelnyxInboundSms);

export default router;
