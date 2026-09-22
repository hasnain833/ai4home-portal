import prisma from "../lib/prisma.js";

const MAX_LIMIT = 100;

export const listNotifications = async (req, res) => {
  try {
    const session = req.user;
    if (!session) return res.status(401).json({ message: "Unauthorized" });

    const limit = Math.min(parseInt(req.query.limit || "30", 10) || 30, MAX_LIMIT);
    const unreadOnly = req.query.unreadOnly === "true";

    const notifications = await prisma.notification.findMany({
      where: { userId: session.id, ...(unreadOnly ? { isRead: false } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const unreadCount = await prisma.notification.count({
      where: { userId: session.id, isRead: false },
    });

    return res.json({ notifications, unreadCount });
  } catch (error) {
    console.error("[Notifications] Failed to list:", error);
    return res.status(500).json({ message: "Failed to fetch notifications" });
  }
};

export const getUnreadCount = async (req, res) => {
  try {
    const session = req.user;
    if (!session) return res.status(401).json({ message: "Unauthorized" });

    const unreadCount = await prisma.notification.count({
      where: { userId: session.id, isRead: false },
    });

    return res.json({ unreadCount });
  } catch (error) {
    console.error("[Notifications] Failed to count unread:", error);
    return res.status(500).json({ message: "Failed to fetch unread count" });
  }
};

export const markRead = async (req, res) => {
  try {
    const session = req.user;
    if (!session) return res.status(401).json({ message: "Unauthorized" });

    // updateMany with userId in the filter, so a mismatched id is a no-op
    // rather than an update to somebody else's row.
    const { count } = await prisma.notification.updateMany({
      where: { id: req.params.id, userId: session.id, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    if (count === 0) {
      const exists = await prisma.notification.findFirst({
        where: { id: req.params.id, userId: session.id },
        select: { id: true },
      });
      if (!exists) return res.status(404).json({ message: "Notification not found" });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("[Notifications] Failed to mark read:", error);
    return res.status(500).json({ message: "Failed to update notification" });
  }
};

export const markAllRead = async (req, res) => {
  try {
    const session = req.user;
    if (!session) return res.status(401).json({ message: "Unauthorized" });

    const { count } = await prisma.notification.updateMany({
      where: { userId: session.id, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    return res.json({ success: true, updated: count });
  } catch (error) {
    console.error("[Notifications] Failed to mark all read:", error);
    return res.status(500).json({ message: "Failed to update notifications" });
  }
};

export const deleteNotification = async (req, res) => {
  try {
    const session = req.user;
    if (!session) return res.status(401).json({ message: "Unauthorized" });

    // userId is in the filter, so somebody else's id deletes nothing rather
    // than deleting their notification.
    const { count } = await prisma.notification.deleteMany({
      where: { id: req.params.id, userId: session.id },
    });

    if (count === 0) {
      return res.status(404).json({ message: "Notification not found" });
    }

    const unreadCount = await prisma.notification.count({
      where: { userId: session.id, isRead: false },
    });

    return res.json({ success: true, unreadCount });
  } catch (error) {
    console.error("[Notifications] Failed to delete:", error);
    return res.status(500).json({ message: "Failed to delete notification" });
  }
};

/** Clears everything already read, leaving anything still unread in place. */
export const deleteReadNotifications = async (req, res) => {
  try {
    const session = req.user;
    if (!session) return res.status(401).json({ message: "Unauthorized" });

    const { count } = await prisma.notification.deleteMany({
      where: { userId: session.id, isRead: true },
    });

    return res.json({ success: true, deleted: count });
  } catch (error) {
    console.error("[Notifications] Failed to clear read:", error);
    return res.status(500).json({ message: "Failed to clear notifications" });
  }
};
