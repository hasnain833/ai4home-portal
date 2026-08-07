import { Router } from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { verifyTwilioSignature } from "../middlewares/twilio-auth.js";
import { verifyTelnyxSignature } from "../middlewares/telnyx-auth.js";
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
router.post("/inbound", processInbound);
router.post("/unsubscribe", unsubscribeWebhook);
// Public: the "unsubscribe here" link a recipient clicks in an email (keyed by lead id).
router.post("/unsubscribe-link/:leadId", unsubscribeByLead);
router.post("/inbound/email", processBrevoInboundEmail);
router.post("/inbound/sms", verifyTwilioSignature, processTwilioInboundSms);
router.post("/inbound/sms/telnyx", verifyTelnyxSignature, processTelnyxInboundSms);

export default router;
