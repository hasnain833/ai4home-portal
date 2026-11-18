import express from "express";
import {
  getMessagingSettings,
  getCapabilities,
  submitTextingRegistration,
} from "../controllers/messaging-settings.controller.js";
import { requireAuth, requirePermission } from "../middlewares/auth.js";

const router = express.Router();

router.use(requireAuth);
router.get("/", getMessagingSettings);
router.get("/capabilities", getCapabilities);
router.post("/texting-registration", requirePermission("settings.manage"), submitTextingRegistration);

export default router;
