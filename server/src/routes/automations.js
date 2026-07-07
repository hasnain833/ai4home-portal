import { Router } from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
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

router.get("/", requireAuth, requireRoles(["ADMIN", "STAFF"]), getAutomations);
router.get("/analytics", requireAuth, requireRoles(["ADMIN", "STAFF"]), getAutomationAnalytics);
router.post("/", requireAuth, requireRoles(["ADMIN", "STAFF"]), createAutomation);
router.post("/kill-switch", requireAuth, requireRoles(["ADMIN"]), setKillSwitch);
router.patch("/:id", requireAuth, requireRoles(["ADMIN", "STAFF"]), updateAutomation);
router.post("/:id/toggle", requireAuth, requireRoles(["ADMIN", "STAFF"]), toggleAutomation);
router.delete("/:id", requireAuth, requireRoles(["ADMIN", "STAFF"]), deleteAutomation);

export default router;
