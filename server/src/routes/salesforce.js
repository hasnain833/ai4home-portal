import { Router } from "express";
import { requireAuth, requireRoles, requireWorkspace } from "../middlewares/auth.js";
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

// `/callback` is public (Salesforce redirects the browser here); every other
// route is gated by the Sales workspace entitlement.
const sales = requireWorkspace("sales");

router.post("/connect", requireAuth, sales, requireRoles(["ADMIN"]), connectSalesforce);
router.get("/callback", salesforceCallback);
router.post("/disconnect", requireAuth, sales, requireRoles(["ADMIN"]), disconnectSalesforce);

router.get("/status", requireAuth, sales, requireRoles(["ADMIN", "STAFF"]), getSalesforceStatus);
router.patch("/status", requireAuth, sales, requireRoles(["ADMIN"]), updateSalesforceStatus);

router.get("/mappings", requireAuth, sales, requireRoles(["ADMIN", "STAFF"]), getMappings);
router.post("/mappings", requireAuth, sales, requireRoles(["ADMIN"]), saveMapping);
router.delete("/mappings", requireAuth, sales, requireRoles(["ADMIN"]), deleteMapping);

router.get("/logs", requireAuth, sales, requireRoles(["ADMIN", "STAFF"]), getLogs);
router.post("/sync", requireAuth, sales, requireRoles(["ADMIN", "STAFF"]), manualSync);
router.post("/bulk-import", requireAuth, sales, requireRoles(["ADMIN"]), bulkImport);

export default router;
