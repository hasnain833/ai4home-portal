import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import multer from "multer";
import {
  getKnowledgeBaseDocs,
  uploadKnowledgeBaseDoc,
  deleteKnowledgeBaseDoc
} from "../controllers/knowledge-base.controller.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/", requireAuth, getKnowledgeBaseDocs);
router.post("/", requireAuth, upload.single("file"), uploadKnowledgeBaseDoc);
router.delete("/", requireAuth, deleteKnowledgeBaseDoc);

export default router;
