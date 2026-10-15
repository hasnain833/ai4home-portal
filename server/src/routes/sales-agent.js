import express from "express";
import { bookAppointment, sendAgentMessage } from "../controllers/sales-agent.controller.js";
import { createRateLimiter, clientKey } from "../middlewares/rate-limit.js";

const router = express.Router();

// Keyed by recipient, not IP: callers arrive from a few shared bot IPs, and the
// abuse to stop is one phone/inbox being flooded at the platform's expense.
const byRecipient = (req) =>
  String(req.body?.phone || req.body?.email || clientKey(req)).trim().toLowerCase();

const bookLimiter = createRateLimiter({ windowMs: 600_000, max: 3, label: "Sales agent booking", keyFn: byRecipient });
const messageLimiter = createRateLimiter({ windowMs: 600_000, max: 5, label: "Sales agent message", keyFn: byRecipient });

router.post("/book", bookLimiter, bookAppointment);
router.post("/message", messageLimiter, sendAgentMessage);

export default router;
