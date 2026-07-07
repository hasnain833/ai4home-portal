import prisma from "../lib/prisma.js";
import { resolveAnnouncementAudience } from "../inngest/functions/announcement.js";

// Announcements target email, SMS, or both (SRS SW-ANN-002). Unknown values fall
// back to EMAIL.
function normalizeChannel(channel) {
  const c = String(channel || "EMAIL").toUpperCase();
  return c === "SMS" || c === "BOTH" ? c : "EMAIL";
}

function channelIncludesEmail(channel) {
  const c = normalizeChannel(channel);
  return c === "EMAIL" || c === "BOTH";
}

function sanitizeGeoFilter(geo) {
  if (!geo || typeof geo !== "object") return null;
  const pick = (arr) =>
    Array.isArray(arr) ? arr.map((v) => String(v).trim()).filter(Boolean) : [];
  const states = pick(geo.states);
  const cities = pick(geo.cities);
  const zips = pick(geo.zips);
  if (!states.length && !cities.length && !zips.length) return null;
  return { states, cities, zips };
}

export const getAnnouncements = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const announcements = await prisma.announcement.findMany({
      where: { companyId: req.user.companyId },
      orderBy: { createdAt: "desc" },
    });

    const formatted = announcements.map((a) => ({
      id: a.id,
      title: a.title,
      subject: a.subject,
      channel: a.channel,
      status: a.status,
      audienceType: a.audienceType,
      segmentId: a.segmentId,
      scheduledAt: a.scheduledAt,
      sentAt: a.sentAt,
      audienceCount: a.audienceCount,
      sentCount: a.sentCount,
      deliveredCount: a.deliveredCount,
      failedCount: a.failedCount,
      openedCount: a.openedCount,
      clickedCount: a.clickedCount,
      unsubscribedCount: a.unsubscribedCount,
      createdAt: a.createdAt,
    }));

    return res.json(formatted);
  } catch (error) {
    console.error("[Announcements List] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getAnnouncementDetail = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }
    const { id } = req.params;
    const announcement = await prisma.announcement.findFirst({
      where: { id, companyId: req.user.companyId },
    });
    if (!announcement) {
      return res.status(404).json({ message: "Announcement not found" });
    }
    return res.json(announcement);
  } catch (error) {
    console.error("[Announcement Detail] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Preview the recipient count for a given audience config without creating anything.
export const previewAudience = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }
    const { audienceType = "ALL", segmentId = null, geoFilter = null, channel = "EMAIL" } = req.body;
    const leads = await resolveAnnouncementAudience({
      companyId: req.user.companyId,
      channel: normalizeChannel(channel),
      audienceType,
      segmentId,
      geoFilter: sanitizeGeoFilter(geoFilter),
    });
    return res.json({ count: leads.length });
  } catch (error) {
    console.error("[Announcement Preview] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Create an announcement. `action` controls what happens next:
//   "draft"    -> saved as Draft (default)
//   "send"     -> saved and immediately fanned out via Inngest
//   "schedule" -> saved with scheduledAt; the send function holds until that time
export const createAnnouncement = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const {
      title,
      subject,
      body,
      ctaLink = null,
      channel = "EMAIL",
      audienceType = "ALL",
      segmentId = null,
      geoFilter = null,
      scheduledAt = null,
      action = "draft",
    } = req.body;

    const resolvedChannel = normalizeChannel(channel);

    if (!title || !body) {
      return res.status(400).json({ message: "Title and body are required" });
    }
    if (action === "send" && channelIncludesEmail(resolvedChannel) && !subject) {
      return res.status(400).json({ message: "Subject is required to send an email announcement" });
    }

    const wantsSchedule = action === "schedule" && scheduledAt;
    const scheduledDate = wantsSchedule ? new Date(scheduledAt) : null;
    if (wantsSchedule && (isNaN(scheduledDate) || scheduledDate.getTime() <= Date.now())) {
      return res.status(400).json({ message: "scheduledAt must be a valid future date" });
    }

    // "Queued" (not "Sending") — the Inngest function flips it to "Sending" when it
    // actually starts. Setting "Sending" here would make the function skip itself.
    let status = "Draft";
    if (action === "send") status = "Queued";
    else if (wantsSchedule) status = "Scheduled";

    const announcement = await prisma.announcement.create({
      data: {
        companyId: req.user.companyId,
        title,
        subject: subject || title,
        body,
        ctaLink: ctaLink || null,
        channel: resolvedChannel,
        audienceType: audienceType === "SEGMENT" ? "SEGMENT" : "ALL",
        segmentId: audienceType === "SEGMENT" ? segmentId : null,
        geoFilter: sanitizeGeoFilter(geoFilter),
        scheduledAt: scheduledDate,
        status,
        createdById: req.user.id || null,
      },
    });

    // Whenever an announcement is meant to go out, dispatch it to leads as an
    // email campaign via the Inngest batch pipeline (SW-ANN-002).
    if (action === "send" || wantsSchedule) {
      const { inngest } = await import("../lib/inngest.js");
      await inngest.send({
        name: "announcement.send",
        data: { announcementId: announcement.id, companyId: req.user.companyId },
      });
    }

    return res.status(201).json(announcement);
  } catch (error) {
    console.error("[Announcement Create] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateAnnouncement = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }
    const { id } = req.params;
    const existing = await prisma.announcement.findFirst({
      where: { id, companyId: req.user.companyId },
    });
    if (!existing) {
      return res.status(404).json({ message: "Announcement not found" });
    }
    if (!["Draft", "Scheduled"].includes(existing.status)) {
      return res.status(400).json({ message: `Cannot edit an announcement that is ${existing.status}` });
    }

    const { title, subject, body, ctaLink, audienceType, segmentId, geoFilter } = req.body;
    const updated = await prisma.announcement.update({
      where: { id },
      data: {
        title: title ?? existing.title,
        subject: subject ?? existing.subject,
        body: body ?? existing.body,
        ctaLink: ctaLink !== undefined ? ctaLink : existing.ctaLink,
        audienceType: audienceType ? (audienceType === "SEGMENT" ? "SEGMENT" : "ALL") : existing.audienceType,
        segmentId: audienceType === "SEGMENT" ? (segmentId ?? existing.segmentId) : audienceType === "ALL" ? null : existing.segmentId,
        geoFilter: geoFilter !== undefined ? sanitizeGeoFilter(geoFilter) : existing.geoFilter,
      },
    });
    return res.json(updated);
  } catch (error) {
    console.error("[Announcement Update] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Send a previously-created Draft, immediately or scheduled.
export const sendAnnouncement = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }
    const { id } = req.params;
    const { scheduledAt = null } = req.body;

    const announcement = await prisma.announcement.findFirst({
      where: { id, companyId: req.user.companyId },
    });
    if (!announcement) {
      return res.status(404).json({ message: "Announcement not found" });
    }
    if (!["Draft", "Scheduled"].includes(announcement.status)) {
      return res.status(400).json({ message: `Announcement is already ${announcement.status}` });
    }
    if (!announcement.subject) {
      return res.status(400).json({ message: "Subject is required to send" });
    }

    const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
    if (scheduledDate && (isNaN(scheduledDate) || scheduledDate.getTime() <= Date.now())) {
      return res.status(400).json({ message: "scheduledAt must be a valid future date" });
    }

    const updated = await prisma.announcement.update({
      where: { id },
      data: {
        status: scheduledDate ? "Scheduled" : "Queued",
        scheduledAt: scheduledDate,
      },
    });

    const { inngest } = await import("../lib/inngest.js");
    await inngest.send({
      name: "announcement.send",
      data: { announcementId: id, companyId: req.user.companyId },
    });

    return res.json({ success: true, announcement: updated });
  } catch (error) {
    console.error("[Announcement Send] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// SW-ANN-003: cancel a scheduled send before the batch pipeline starts.
export const cancelAnnouncement = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }
    const { id } = req.params;
    const announcement = await prisma.announcement.findFirst({
      where: { id, companyId: req.user.companyId },
    });
    if (!announcement) {
      return res.status(404).json({ message: "Announcement not found" });
    }
    if (!["Scheduled", "Sending"].includes(announcement.status)) {
      return res.status(400).json({ message: `Cannot cancel an announcement that is ${announcement.status}` });
    }

    const { inngest } = await import("../lib/inngest.js");
    await inngest.send({
      name: "announcement.cancel",
      data: { announcementId: id, companyId: req.user.companyId },
    });

    const updated = await prisma.announcement.update({
      where: { id },
      data: { status: "Cancelled" },
    });

    return res.json({ success: true, announcement: updated });
  } catch (error) {
    console.error("[Announcement Cancel] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteAnnouncement = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }
    const { id } = req.params;
    const announcement = await prisma.announcement.findFirst({
      where: { id, companyId: req.user.companyId },
    });
    if (!announcement) {
      return res.status(404).json({ message: "Announcement not found" });
    }
    if (announcement.status === "Sending") {
      return res.status(400).json({ message: "Cannot delete an announcement while it is sending" });
    }
    await prisma.announcement.delete({ where: { id } });
    return res.json({ success: true });
  } catch (error) {
    console.error("[Announcement Delete] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
