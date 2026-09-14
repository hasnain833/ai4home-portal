import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  listNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
} from "../controllers/notifications.controller.js";

const router = express.Router();

router.get("/", requireAuth, listNotifications);
router.get("/unread-count", requireAuth, getUnreadCount);
router.patch("/read-all", requireAuth, markAllRead);
router.patch("/:id/read", requireAuth, markRead);

export default router;
