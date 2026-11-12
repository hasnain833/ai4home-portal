import express from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
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
router.get("/", requireAuth, requireRoles(["ADMIN"]), getIntegrations);
// POST /api/integrations
router.post("/", requireAuth, requireRoles(["ADMIN"]), testIntegration);

// Credentials
router.get("/credentials", requireAuth, requireRoles(["ADMIN"]), getCredentials);
router.post("/credentials", requireAuth, requireRoles(["ADMIN"]), saveCredentials);
router.delete("/credentials", requireAuth, requireRoles(["ADMIN"]), deleteCredentials);

// ERP sync
router.post("/sync", requireAuth, syncIntegration);

export default router;
