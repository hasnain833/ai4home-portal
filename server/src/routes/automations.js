import { Router } from "express";
import { requireAuth, requireRoles, requirePermission } from "../middlewares/auth.js";
import {
  getAutomations,
  createAutomation,
  updateAutomation,
  toggleAutomation,
  deleteAutomation,
  setKillSwitch,
  getAutomationAnalytics,
} from "../controllers/automations.controller.js";

const router = Router();

// §4.12: automations are "Per permission" for a Builder Member, "No" for a
// Homeowner; the kill switch / rate caps stay admin-level.
const staff = requireRoles(["ADMIN", "STAFF"]);
const canManage = requirePermission("automations.manage");

router.get("/", requireAuth, staff, getAutomations);
router.get("/analytics", requireAuth, staff, getAutomationAnalytics);

router.post("/", requireAuth, staff, canManage, createAutomation);
router.patch("/:id", requireAuth, staff, canManage, updateAutomation);
// SW-AMK-002: activating a flow is the moment it starts messaging leads.
router.post("/:id/toggle", requireAuth, staff, canManage, toggleAutomation);
router.delete("/:id", requireAuth, staff, canManage, deleteAutomation);

// SW-AMK-004: kill switch + rate caps remain ADMIN-only — a member who can be
// denied automations.manage must not be able to pause the whole tenant either.
router.post("/kill-switch", requireAuth, requireRoles(["ADMIN"]), setKillSwitch);

export default router;
