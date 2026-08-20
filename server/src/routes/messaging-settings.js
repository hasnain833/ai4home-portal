import express from "express";
import {
  getMessagingSettings,
  getCapabilities,
  saveEmailSettings,
  saveSmsSettings,
  testEmail,
  testSms,
} from "../controllers/messaging-settings.controller.js";
import { requireAuth, requirePermission } from "../middlewares/auth.js";

const router = express.Router();

router.use(requireAuth);

// Reading settings is fine for any sales user — the page has to render. Every
// write is gated, so a staff member without the permission cannot change
// delivery credentials or send test messages on the tenant account.
const canManage = requirePermission("settings.manage");

router.get("/", getMessagingSettings);
router.get("/capabilities", getCapabilities);
router.put("/email", canManage, saveEmailSettings);
router.put("/sms", canManage, saveSmsSettings);
router.post("/test-email", canManage, testEmail);
router.post("/test-sms", canManage, testSms);

export default router;
