import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import multer from "multer";
import {
  getCompany,
  updateCompany,
  getCompanyBranding,
  uploadCompanyLogo,
  submitVerificationDocument
} from "../controllers/company.controller.js";
import { handleUploadErrors } from "../middlewares/upload.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});
const uploadFile = handleUploadErrors(upload.single("file"));

router.get("/", requireAuth, getCompany);
router.put("/", requireAuth, updateCompany);

router.get("/branding", getCompanyBranding);
router.options("/branding", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return res.status(204).end();
});

router.post("/logo", requireAuth, uploadFile, uploadCompanyLogo);
router.post("/verification", requireAuth, uploadFile, submitVerificationDocument);

export default router;
