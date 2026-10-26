import express from "express";
import multer from "multer";
import { requireAuth } from "../middlewares/auth.js";
import { handleUploadErrors } from "../middlewares/upload.js";
import {
  getHomeowners,
  getHomeowner,
  createHomeowner,
  updateHomeowner,
  deleteHomeowner,
  uploadHousePhoto,
  deleteHousePhoto
} from "../controllers/homeowners.controller.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

router.get("/", requireAuth, getHomeowners);
router.get("/:id", requireAuth, getHomeowner);
router.post("/", requireAuth, createHomeowner);
router.patch("/:id", requireAuth, updateHomeowner);
router.delete("/", requireAuth, deleteHomeowner);
router.post("/:id/house-photo", requireAuth, handleUploadErrors(upload.single("file")), uploadHousePhoto);
router.delete("/:id/house-photo", requireAuth, deleteHousePhoto);

export default router;
