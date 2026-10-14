import { Router } from "express";
import { createRateLimiter } from "../middlewares/rate-limit.js";
import { publicGetBooking, publicBook, publicUnsubscribe } from "../admin/b2b.controller.js";


const router = Router();
const limit = (label) => createRateLimiter({ max: 20, windowMs: 60_000, label });

router.get("/booking/:token", limit("B2B booking"), publicGetBooking);
router.post("/booking/:token", limit("B2B booking"), publicBook);
router.post("/unsubscribe/:token", limit("B2B unsubscribe"), publicUnsubscribe);

export default router;
