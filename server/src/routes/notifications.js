import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  listNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  deleteNotification,
  deleteReadNotifications,
} from "../controllers/notifications.controller.js";

const router = express.Router();

router.get("/", requireAuth, listNotifications);
router.get("/unread-count", requireAuth, getUnreadCount);
router.patch("/read-all", requireAuth, markAllRead);
router.patch("/:id/read", requireAuth, markRead);
// Ordered before "/:id" so "read" is never taken for a notification id.
router.delete("/read", requireAuth, deleteReadNotifications);
router.delete("/:id", requireAuth, deleteNotification);

export default router;
