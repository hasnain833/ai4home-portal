import { Router } from "express";
import { requireAuth, requirePermission } from "../middlewares/auth.js";
import {
  uploadCsvMiddleware,
  handleCsvUpload,
  validateCsvImport,
  getMappingTemplates,
  saveMappingTemplate,
  deleteMappingTemplate,
} from "../controllers/csv.controller.js";

const router = Router();

// §4.12: CSV upload is "Per permission" for a Builder Member. Admins and
// homeowners pass automatically (homeowners are capped by SW-CSV-006 inside the
// controller); staff need the grant.
const canImport = requirePermission("csv.upload");

router.post("/upload", requireAuth, canImport, uploadCsvMiddleware, handleCsvUpload);
router.post("/validate", requireAuth, canImport, validateCsvImport);

// SW-CSV-002: reusable column-mapping templates. Reading them is harmless — the
// grant gates writing, which is what changes what other imports will do.
router.get("/templates", requireAuth, getMappingTemplates);
router.post("/templates", requireAuth, canImport, saveMappingTemplate);
router.delete("/templates/:id", requireAuth, canImport, deleteMappingTemplate);

export default router;
