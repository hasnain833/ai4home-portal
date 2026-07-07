import { Router } from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import {
  getAnnouncements,
  getAnnouncementDetail,
  previewAudience,
  createAnnouncement,
  updateAnnouncement,
  sendAnnouncement,
  cancelAnnouncement,
  deleteAnnouncement,
} from "../controllers/announcements.controller.js";

const router = Router();

// SW-ANN-006: only Builder Admin / authorized staff may author or publish.
router.get("/", requireAuth, requireRoles(["ADMIN", "STAFF"]), getAnnouncements);
router.post("/preview", requireAuth, requireRoles(["ADMIN", "STAFF"]), previewAudience);
router.post("/", requireAuth, requireRoles(["ADMIN", "STAFF"]), createAnnouncement);
router.get("/:id", requireAuth, requireRoles(["ADMIN", "STAFF"]), getAnnouncementDetail);
router.patch("/:id", requireAuth, requireRoles(["ADMIN", "STAFF"]), updateAnnouncement);
router.post("/:id/send", requireAuth, requireRoles(["ADMIN", "STAFF"]), sendAnnouncement);
router.post("/:id/cancel", requireAuth, requireRoles(["ADMIN", "STAFF"]), cancelAnnouncement);
router.delete("/:id", requireAuth, requireRoles(["ADMIN", "STAFF"]), deleteAnnouncement);

export default router;
