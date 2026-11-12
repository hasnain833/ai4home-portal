import express from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import multer from "multer";
import {
  getKnowledgeBaseDocs,
  uploadKnowledgeBaseDoc,
  deleteKnowledgeBaseDoc
} from "../controllers/knowledge-base.controller.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/", requireAuth, requireRoles(["ADMIN", "STAFF"]), getKnowledgeBaseDocs);
router.post("/", requireAuth, requireRoles(["ADMIN", "STAFF"]), upload.single("file"), uploadKnowledgeBaseDoc);
router.delete("/", requireAuth, requireRoles(["ADMIN", "STAFF"]), deleteKnowledgeBaseDoc);

export default router;
