import express from "express";
import multer from "multer";
import { requirePermission } from "../middlewares/auth.js";
import { handleUploadErrors } from "../middlewares/upload.js";
import {
  listHomes,
  createHome,
  updateHome,
  deleteHome,
  importHomes,
  uploadPhotos,
  deletePhoto,
  makeCover,
} from "../controllers/sales-homes.controller.js";

const router = express.Router();
const canManage = requirePermission("kb.manage");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 10 } });
const importFile = handleUploadErrors(upload.single("file"));
const photoFiles = handleUploadErrors(upload.array("files", 10));

router.get("/", listHomes);
router.post("/", canManage, createHome);
router.post("/import", canManage, importFile, importHomes);
router.patch("/:id", canManage, updateHome);
router.delete("/:id", canManage, deleteHome);
router.post("/:id/photos", canManage, photoFiles, uploadPhotos);
router.post("/:id/photos/:photoId/cover", canManage, makeCover);
router.delete("/:id/photos/:photoId", canManage, deletePhoto);

export default router;
