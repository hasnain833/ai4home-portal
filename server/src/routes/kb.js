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
} from "../controllers/kb.controller.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// §4.12: "Knowledge base / brand profile" is "Per permission" for a Builder
// Member, "No" for a Homeowner. Reads and the retrieval-test search stay on the
// role guard; the grant gates changing what the AI features are grounded in.
const staff = requireRoles(["ADMIN", "STAFF"]);
const canManage = requirePermission("kb.manage");

router.get("/", requireAuth, getSalesKB);
router.post("/search", requireAuth, searchSalesKB);

router.post("/", requireAuth, staff, canManage, addSalesKBDocument);
router.post("/upload", requireAuth, staff, canManage, upload.single("file"), uploadSalesKBDocument);
router.delete("/:id", requireAuth, staff, canManage, deleteSalesKBDocument);

// SW-KB-006 brand/company profile — feeds every AI prompt, so editing it is
// squarely "configure the knowledge base".
router.get("/brand-profile", requireAuth, getBrandProfile);
router.put("/brand-profile", requireAuth, staff, canManage, updateBrandProfile);

// SW-KB-007: config version history + rollback, and a preview/sandbox that tests
// AI output against a candidate config without persisting or sending.
router.get("/brand-profile/versions", requireAuth, staff, canManage, getBrandProfileVersions);
router.post("/brand-profile/versions/:version/rollback", requireAuth, staff, canManage, rollbackBrandProfileVersion);
router.post("/preview", requireAuth, staff, canManage, previewAiOutput);

// Backfill pgvector embeddings for existing chunks (call repeatedly until remaining=0)
router.post("/reindex", requireAuth, staff, canManage, reindexSalesKB);

export default router;
