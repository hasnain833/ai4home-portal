import { Router } from "express";
import {
  requireAuth,
  requireRoles,
  requireWorkspace,
} from "../middlewares/auth.js";
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

router.get("/public/lead/:leadId", publicGetBooking);
router.post("/public/book", publicBook);
router.get("/public/manage/:token", publicGetManage);
router.post("/public/reschedule", publicReschedule);
router.post("/public/cancel", publicCancel);

router.get("/google/callback", googleCallback);
router.get(
  "/google/connect",
  requireAuth,
  requireWorkspace("sales"),
  requireRoles(["ADMIN", "STAFF"]),
  googleConnect,
);
router.post(
  "/google/disconnect",
  requireAuth,
  requireWorkspace("sales"),
  requireRoles(["ADMIN", "STAFF"]),
  googleDisconnect,
);

const OWN_AVAILABILITY = ["ADMIN", "STAFF", "HOMEOWNER"];

router.get(
  "/settings",
  requireAuth,
  requireWorkspace("sales"),
  requireRoles(OWN_AVAILABILITY),
  getSettings,
);
router.put(
  "/settings",
  requireAuth,
  requireWorkspace("sales"),
  requireRoles(["ADMIN", "STAFF"]),
  updateSettings,
);
router.get(
  "/slots",
  requireAuth,
  requireWorkspace("sales"),
  requireRoles(OWN_AVAILABILITY),
  getSlots,
);
router.post(
  "/reschedule",
  requireAuth,
  requireWorkspace("sales"),
  requireRoles(OWN_AVAILABILITY),
  staffReschedule,
);
router.post(
  "/cancel",
  requireAuth,
  requireWorkspace("sales"),
  requireRoles(OWN_AVAILABILITY),
  staffCancel,
);

export default router;
