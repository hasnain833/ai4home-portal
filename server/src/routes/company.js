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

const router = express.Router();

// Set up multer for handling multipart/form-data
const upload = multer({ storage: multer.memoryStorage() });

router.get("/", requireAuth, getCompany);
router.put("/", requireAuth, updateCompany);

router.get("/branding", getCompanyBranding);
router.options("/branding", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return res.status(204).end();
});

router.post("/logo", requireAuth, upload.single("file"), uploadCompanyLogo);
router.post(
  "/verification",
  requireAuth,
  upload.single("file"),
  submitVerificationDocument,
);

export default router;
