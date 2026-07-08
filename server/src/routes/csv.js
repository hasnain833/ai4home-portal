import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  uploadCsvMiddleware,
  handleCsvUpload,
  validateCsvImport,
  getMappingTemplates,
  saveMappingTemplate,
  deleteMappingTemplate,
} from "../controllers/csv.controller.js";

const router = Router();

router.post("/upload", requireAuth, uploadCsvMiddleware, handleCsvUpload);
router.post("/validate", requireAuth, validateCsvImport);

// SW-CSV-002: reusable column-mapping templates
router.get("/templates", requireAuth, getMappingTemplates);
router.post("/templates", requireAuth, saveMappingTemplate);
router.delete("/templates/:id", requireAuth, deleteMappingTemplate);

export default router;
