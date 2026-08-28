import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  getIntegrations,
  testIntegration,
  getCredentials,
  saveCredentials,
  deleteCredentials,
  syncIntegration,
} from "../controllers/integrations.controller.js";

const router = express.Router();

// GET /api/integrations
router.get("/", requireAuth, getIntegrations);
// POST /api/integrations
router.post("/", requireAuth, testIntegration);

// Credentials
router.get("/credentials", requireAuth, getCredentials);
router.post("/credentials", requireAuth, saveCredentials);
router.delete("/credentials", requireAuth, deleteCredentials);

// ERP sync
router.post("/sync", requireAuth, syncIntegration);

export default router;
