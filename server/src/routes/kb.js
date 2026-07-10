import { Router } from "express";
import multer from "multer";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import {
  getSalesKB,
  addSalesKBDocument,
  uploadSalesKBDocument,
  deleteSalesKBDocument,
  searchSalesKB,
  getBrandProfile,
  updateBrandProfile,
  reindexSalesKB,
} from "../controllers/kb.controller.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.get("/", requireAuth, getSalesKB);
router.post("/", requireAuth, requireRoles(["ADMIN", "STAFF"]), addSalesKBDocument);
router.post("/upload", requireAuth, requireRoles(["ADMIN", "STAFF"]), upload.single("file"), uploadSalesKBDocument);
router.post("/search", requireAuth, searchSalesKB);
router.delete("/:id", requireAuth, requireRoles(["ADMIN", "STAFF"]), deleteSalesKBDocument);

// SW-KB-006 brand/company profile
router.get("/brand-profile", requireAuth, getBrandProfile);
router.put("/brand-profile", requireAuth, requireRoles(["ADMIN", "STAFF"]), updateBrandProfile);

// Backfill pgvector embeddings for existing chunks (call repeatedly until remaining=0)
router.post("/reindex", requireAuth, requireRoles(["ADMIN", "STAFF"]), reindexSalesKB);

export default router;
