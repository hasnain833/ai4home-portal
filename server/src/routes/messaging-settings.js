import express from "express";
import {
  getMessagingSettings,
  getCapabilities,
} from "../controllers/messaging-settings.controller.js";
import { requireAuth } from "../middlewares/auth.js";

const router = express.Router();

router.use(requireAuth);

// Read-only now: there are no tenant credentials to write, and test sends would
// bill the platform for a message nobody asked for.
router.get("/", getMessagingSettings);
router.get("/capabilities", getCapabilities);

export default router;
