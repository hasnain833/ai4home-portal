import { Router } from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import {
  connectSalesforce,
  salesforceCallback,
  disconnectSalesforce,
  getSalesforceStatus,
  updateSalesforceStatus,
  getMappings,
  saveMapping,
  deleteMapping,
  getLogs,
  manualSync,
  bulkImport
} from "../controllers/salesforce.controller.js";

const router = Router();

router.post("/connect", requireAuth, requireRoles(["ADMIN"]), connectSalesforce);
router.get("/callback", salesforceCallback);
router.post("/disconnect", requireAuth, requireRoles(["ADMIN"]), disconnectSalesforce);

router.get("/status", requireAuth, requireRoles(["ADMIN", "STAFF"]), getSalesforceStatus);
router.patch("/status", requireAuth, requireRoles(["ADMIN"]), updateSalesforceStatus);

router.get("/mappings", requireAuth, requireRoles(["ADMIN", "STAFF"]), getMappings);
router.post("/mappings", requireAuth, requireRoles(["ADMIN"]), saveMapping);
router.delete("/mappings", requireAuth, requireRoles(["ADMIN"]), deleteMapping);

router.get("/logs", requireAuth, requireRoles(["ADMIN", "STAFF"]), getLogs);
router.post("/sync", requireAuth, requireRoles(["ADMIN", "STAFF"]), manualSync);
router.post("/bulk-import", requireAuth, requireRoles(["ADMIN"]), bulkImport);

export default router;
