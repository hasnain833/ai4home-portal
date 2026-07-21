import { Router } from "express";
import multer from "multer";
import { requireAuth, requireRoles, requirePermission } from "../middlewares/auth.js";
import {
  getSalesKB,
  addSalesKBDocument,
  uploadSalesKBDocument,
  deleteSalesKBDocument,
  searchSalesKB,
  getBrandProfile,
  updateBrandProfile,
  reindexSalesKB,
  getBrandProfileVersions,
  rollbackBrandProfileVersion,
  previewAiOutput,
  getKbRetrievalStatus,
} from "../controllers/kb.controller.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const staff = requireRoles(["ADMIN", "STAFF"]);
const canManage = requirePermission("kb.manage");

router.get("/", requireAuth, getSalesKB);
router.post("/search", requireAuth, searchSalesKB);
router.get("/retrieval-status", requireAuth, getKbRetrievalStatus);

router.post("/", requireAuth, staff, canManage, addSalesKBDocument);
router.post("/upload", requireAuth, staff, canManage, upload.single("file"), uploadSalesKBDocument);
router.delete("/:id", requireAuth, staff, canManage, deleteSalesKBDocument);

router.get("/brand-profile", requireAuth, getBrandProfile);
router.put("/brand-profile", requireAuth, staff, canManage, updateBrandProfile);

router.get("/brand-profile/versions", requireAuth, staff, canManage, getBrandProfileVersions);
router.post("/brand-profile/versions/:version/rollback", requireAuth, staff, canManage, rollbackBrandProfileVersion);
router.post("/preview", requireAuth, staff, canManage, previewAiOutput);

router.post("/reindex", requireAuth, staff, canManage, reindexSalesKB);

export default router;
