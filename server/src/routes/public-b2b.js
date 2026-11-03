import { requireWebsiteIntakeSecret, websiteVisitorKey } from "../middlewares/website-intake-auth.js";
import { websiteIntake } from "../controllers/website-intake.controller.js";
import { websiteSales } from "../controllers/website-sales.controller.js";
import { Router } from "express";
import { websiteGuard } from "../controllers/website-guard.controller.js";
import { createRateLimiter } from "../middlewares/rate-limit.js";
import { publicGetBooking, publicBook, publicUnsubscribe } from "../admin/b2b.controller.js";


const phoneBookingLimit = createRateLimiter({ max: 3, windowMs: 600_000, keyFn: (req) => "phone:" + String(req.body?.phone || "").replace(/\D/g, "").slice(-10) });
const bookingLimit = createRateLimiter({ max: 3, windowMs: 600_000, keyFn: (req) => "email:" + String(req.body?.email || websiteVisitorKey(req)).trim().toLowerCase() });
const router = Router();
router.post("/website-guard", requireWebsiteIntakeSecret, websiteGuard);
router.post("/sales", requireWebsiteIntakeSecret,
  createRateLimiter({ max: 150, windowMs: 60_000, failClosed: true, keyFn: () => "website-sales-global" }),
  createRateLimiter({ max: 20, windowMs: 60_000, failClosed: true, keyFn: websiteVisitorKey }),
  (req, res, next) => req.body?.action === "book" ? bookingLimit(req, res, () => phoneBookingLimit(req, res, next)) : next(), websiteSales);

router.post("/intake", requireWebsiteIntakeSecret, createRateLimiter({ max: 100, windowMs: 60_000, label: "B2B intake global", failClosed: true, keyFn: () => "website" }), createRateLimiter({ max: 5, windowMs: 60_000, label: "B2B website intake", failClosed: true, keyFn: websiteVisitorKey }), websiteIntake);
const limit = (label) => createRateLimiter({ max: 20, windowMs: 60_000, label });

router.get("/booking/:token", limit("B2B booking"), publicGetBooking);
router.post("/booking/:token", limit("B2B booking"), publicBook);
router.post("/unsubscribe/:token", limit("B2B unsubscribe"), publicUnsubscribe);

export default router;
