import { Router } from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import {
  getSettings,
  updateSettings,
  getSlots,
  staffReschedule,
  staffCancel,
  googleConnect,
  googleCallback,
  googleDisconnect,
  publicGetBooking,
  publicBook,
  publicGetManage,
  publicReschedule,
  publicCancel,
} from "../controllers/scheduling.controller.js";

const router = Router();

// ─── Public (lead-facing, no portal session) ──────────────────────────────────
router.get("/public/lead/:leadId", publicGetBooking);
router.post("/public/book", publicBook);
router.get("/public/manage/:token", publicGetManage);
router.post("/public/reschedule", publicReschedule);
router.post("/public/cancel", publicCancel);

// ─── Google OAuth (callback is public; Google redirects the browser here) ──────
router.get("/google/callback", googleCallback);
router.get("/google/connect", requireAuth, requireRoles(["ADMIN", "STAFF"]), googleConnect);
router.post("/google/disconnect", requireAuth, requireRoles(["ADMIN", "STAFF"]), googleDisconnect);

// ─── Availability settings + slots + management (staff) ───────────────────────
router.get("/settings", requireAuth, requireRoles(["ADMIN", "STAFF"]), getSettings);
router.put("/settings", requireAuth, requireRoles(["ADMIN", "STAFF"]), updateSettings);
router.get("/slots", requireAuth, requireRoles(["ADMIN", "STAFF"]), getSlots);
router.post("/reschedule", requireAuth, requireRoles(["ADMIN", "STAFF"]), staffReschedule);
router.post("/cancel", requireAuth, requireRoles(["ADMIN", "STAFF"]), staffCancel);

export default router;
