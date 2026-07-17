import { Router } from "express";
import {
  requireAuth,
  requireRoles,
  requirePermission,
} from "../middlewares/auth.js";
import {
  getAnnouncements,
  getAnnouncementDetail,
  previewAudience,
  createAnnouncement,
  updateAnnouncement,
  sendAnnouncement,
  cancelAnnouncement,
  deleteAnnouncement,
  getAnnouncementFailures,
  retryAnnouncement,
} from "../controllers/announcements.controller.js";

const router = Router();

const staffOnly = requireRoles(["ADMIN", "STAFF"]);
const canPublish = requirePermission("announcements.publish");

router.get("/", requireAuth, staffOnly, getAnnouncements);
router.get("/:id", requireAuth, staffOnly, getAnnouncementDetail);
router.post("/preview", requireAuth, staffOnly, previewAudience);

router.post("/", requireAuth, staffOnly, canPublish, createAnnouncement);
router.patch("/:id", requireAuth, staffOnly, canPublish, updateAnnouncement);
router.post("/:id/send", requireAuth, staffOnly, canPublish, sendAnnouncement);
router.post(
  "/:id/cancel",
  requireAuth,
  staffOnly,
  canPublish,
  cancelAnnouncement,
);
router.delete("/:id", requireAuth, staffOnly, canPublish, deleteAnnouncement);

router.get("/:id/failures", requireAuth, staffOnly, getAnnouncementFailures);
router.post(
  "/:id/retry",
  requireAuth,
  staffOnly,
  canPublish,
  retryAnnouncement,
);

export default router;
