import express from "express";
import {
  getMessagingSettings,
  getCapabilities,
  saveEmailSettings,
  saveSmsSettings,
  testEmail,
  testSms,
} from "../controllers/messaging-settings.controller.js";
import { requireAuth } from "../middlewares/auth.js";

const router = express.Router();

router.use(requireAuth);

router.get("/", getMessagingSettings);
router.get("/capabilities", getCapabilities);
router.put("/email", saveEmailSettings);
router.put("/sms", saveSmsSettings);
router.post("/test-email", testEmail);
router.post("/test-sms", testSms);

export default router;
