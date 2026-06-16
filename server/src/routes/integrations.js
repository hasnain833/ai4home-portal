import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  getIntegrations,
  testIntegration,
  getCredentials,
  saveCredentials,
  deleteCredentials,
  syncIntegration,
  botpressTicket,
  botpressSync
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

// Botpress endpoints
router.post("/botpress/ticket", botpressTicket);
router.post("/botpress/sync", botpressSync);

export default router;
