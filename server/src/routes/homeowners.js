import express from "express";
import multer from "multer";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
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

router.get("/", requireAuth, requireRoles(["ADMIN", "STAFF"]), getHomeowners);
router.get("/:id", requireAuth, requireRoles(["ADMIN", "STAFF"]), getHomeowner);
router.post("/", requireAuth, requireRoles(["ADMIN", "STAFF"]), createHomeowner);
router.patch("/:id", requireAuth, requireRoles(["ADMIN", "STAFF"]), updateHomeowner);
router.delete("/", requireAuth, requireRoles(["ADMIN"]), deleteHomeowner);
router.post("/:id/house-photo", requireAuth, requireRoles(["ADMIN", "STAFF"]), handleUploadErrors(upload.single("file")), uploadHousePhoto);
router.delete("/:id/house-photo", requireAuth, requireRoles(["ADMIN", "STAFF"]), deleteHousePhoto);

export default router;
