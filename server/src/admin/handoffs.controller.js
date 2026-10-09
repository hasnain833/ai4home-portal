import prisma from "../lib/prisma.js";
import { HANDOFF_CHANNEL, resolveHandoffFailures } from "../lib/dead-letter.js";
import { runCloseWon, sendHomeownerWelcome } from "../controllers/leads.controller.js";
import { writeAuditLog } from "../lib/audit.js";
import { denyUnlessSuperAdmin } from "../middlewares/auth.js";

// Admin > Hand-off Issues: failed sales-to-warranty hand-offs across all builders.


export const listHandoffIssues = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;
    const status = req.query.status === "RESOLVED" ? "RESOLVED" : "PENDING";
    const rows = await prisma.deadLetter.findMany({
      where: { channel: HANDOFF_CHANNEL, status },
      include: { company: { select: { id: true, name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    const leadIds = rows.map((r) => r.leadId).filter(Boolean);
    const leads = await prisma.lead.findMany({
      where: { id: { in: leadIds } },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true },
    });
    const byId = new Map(leads.map((l) => [l.id, l]));
    const open = await prisma.deadLetter.count({ where: { channel: HANDOFF_CHANNEL, status: "PENDING" } });

    return res.json({
      open,
      issues: rows.map((r) => ({
        id: r.id,
        company: r.company,
        lead: byId.get(r.leadId) || null,
        error: r.error,
        attempts: r.attempts,
        partial: !!r.payload?.partial,
        requestedBy: r.payload?.requestedBy || null,
        status: r.status,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        resolvedAt: r.replayedAt,
      })),
    });
  } catch (error) {
    console.error("[Hand-off Issues] List error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** Runs the hand-off again with the builder's original choices. */
export const retryHandoffIssue = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;
    const row = await prisma.deadLetter.findFirst({
      where: { id: req.params.id, channel: HANDOFF_CHANNEL, status: "PENDING" },
    });
    if (!row) return res.status(404).json({ message: "Open issue not found" });

    // Hand-off already done and only the welcome email failed: just resend it.
    if (row.payload?.partial && row.payload?.homeownerId) {
      try {
        await sendHomeownerWelcome(row.companyId, row.payload.homeownerId);
      } catch (e) {
        await prisma.deadLetter.update({
          where: { id: row.id },
          data: { error: `Welcome email failed again: ${e?.message || e}`.slice(0, 2000), attempts: { increment: 1 } },
        });
        return res.status(400).json({ message: `Welcome email failed again: ${e?.message || e}` });
      }
      await resolveHandoffFailures(row.companyId, row.leadId);
      return res.json({ success: true });
    }

    const { status, body } = await runCloseWon(row.companyId, row.leadId, row.payload?.request || {});
    if (status >= 400 || body.notice) {
      const error = body.notice || body.detail || body.message;
      await prisma.deadLetter.update({
        where: { id: row.id },
        data: { error: String(error).slice(0, 2000), attempts: { increment: 1 } },
      });
      return res.status(400).json({ message: error });
    }

    await resolveHandoffFailures(row.companyId, row.leadId);
    await writeAuditLog({ req, action: "HANDOFF_RETRIED", targetType: "Lead", targetId: row.leadId, metadata: { companyId: row.companyId } });
    return res.json({ success: true });
  } catch (error) {
    console.error("[Hand-off Issues] Retry error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** Marks an issue resolved after it was fixed by hand. */
export const resolveHandoffIssue = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;
    const row = await prisma.deadLetter.findFirst({
      where: { id: req.params.id, channel: HANDOFF_CHANNEL },
      select: { id: true, leadId: true, companyId: true },
    });
    if (!row) return res.status(404).json({ message: "Issue not found" });
    await prisma.deadLetter.update({
      where: { id: row.id },
      data: { status: "RESOLVED", replayedAt: new Date() },
    });
    await writeAuditLog({ req, action: "HANDOFF_RESOLVED", targetType: "Lead", targetId: row.leadId, metadata: { companyId: row.companyId } });
    return res.json({ success: true });
  } catch (error) {
    console.error("[Hand-off Issues] Resolve error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
