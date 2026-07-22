import prisma from "../lib/prisma.js";
import { writeAuditLog } from "../lib/audit.js";

/**
 * NFR-S-005 — GDPR / CCPA data subject rights.
 *
 * Two rights are implemented, for both kinds of data subject the portal holds:
 * marketing contacts (Lead) and homeowners (User with role HOMEOWNER).
 *
 *   Access / portability  → a machine-readable export of everything held.
 *   Erasure               → anonymise (default) or hard delete.
 *
 * Erasure deliberately does NOT remove two things:
 *   - the suppression-list entry, because continuing to honour an opt-out
 *     requires remembering the contact. It is kept as a one-way hash instead of
 *     the raw address, so the record proves suppression without storing the PII.
 *   - the audit trail of the erasure itself, which is the evidence that the
 *     request was carried out.
 *
 * Every action here is audit-logged (NFR-S-004), which is what makes a DSAR
 * defensible after the fact.
 */

import { createHash } from "crypto";

const MAX_RESULTS = 25;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

// A suppression entry must outlive erasure, but must not keep the raw contact.
// Hashing lets a later send still test "is this address suppressed?" without
// the list itself being a store of erased people's contact details.
function hashContact(value) {
  return `erased:${createHash("sha256").update(String(value)).digest("hex").slice(0, 32)}`;
}

function requireCompanyAdmin(req, res) {
  if (!req.user?.companyId) {
    res.status(403).json({ message: "No company associated" });
    return false;
  }
  // A DSAR is an account-level legal action, so it is admin-only regardless of
  // the granular sales permissions.
  if (req.user.role !== "ADMIN" && !req.user.isSuperAdmin) {
    res.status(403).json({
      message: "Only a company admin can process data subject requests.",
    });
    return false;
  }
  return true;
}

/**
 * GET /api/sales/privacy/subjects?query=...
 * Find the people a request could refer to, by email, phone or name.
 */
export const searchDataSubjects = async (req, res) => {
  try {
    if (!requireCompanyAdmin(req, res)) return;

    const query = String(req.query.query || "").trim();
    if (query.length < 3) {
      return res.status(400).json({ message: "Enter at least 3 characters to search." });
    }

    const companyId = req.user.companyId;
    const digits = normalizePhone(query);

    const leadWhere = {
      companyId,
      OR: [
        { email: { contains: query, mode: "insensitive" } },
        { firstName: { contains: query, mode: "insensitive" } },
        { lastName: { contains: query, mode: "insensitive" } },
        ...(digits.length >= 4 ? [{ phone: { contains: digits.slice(-10) } }] : []),
      ],
    };

    const [leads, homeowners] = await Promise.all([
      prisma.lead.findMany({
        where: leadWhere,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          createdAt: true,
          archived: true,
        },
        orderBy: { createdAt: "desc" },
        take: MAX_RESULTS,
      }),
      prisma.user.findMany({
        where: {
          companyId,
          role: "HOMEOWNER",
          OR: [
            { email: { contains: query, mode: "insensitive" } },
            { name: { contains: query, mode: "insensitive" } },
          ],
        },
        select: { id: true, name: true, email: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: MAX_RESULTS,
      }),
    ]);

    return res.json({
      subjects: [
        ...leads.map((l) => ({
          id: l.id,
          type: "lead",
          name: [l.firstName, l.lastName].filter(Boolean).join(" ") || "(no name)",
          email: l.email,
          phone: l.phone,
          createdAt: l.createdAt,
          archived: l.archived,
        })),
        ...homeowners.map((u) => ({
          id: u.id,
          type: "homeowner",
          name: u.name || "(no name)",
          email: u.email,
          phone: null,
          createdAt: u.createdAt,
          archived: false,
        })),
      ],
    });
  } catch (error) {
    console.error("[Privacy] Subject search failed:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

async function buildLeadExport(companyId, leadId) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, companyId },
    include: {
      timeline: { orderBy: { createdAt: "asc" } },
      appointments: { orderBy: { time: "asc" } },
      campaignEnrollments: { include: { campaign: { select: { id: true, name: true } } } },
      schedulingConversations: true,
      owner: { select: { id: true, name: true, email: true } },
    },
  });
  if (!lead) return null;

  const contacts = [normalizeEmail(lead.email), normalizePhone(lead.phone)].filter(Boolean);
  const suppressions = contacts.length
    ? await prisma.suppressionList.findMany({ where: { companyId, value: { in: contacts } } })
    : [];

  // Who inside the company touched this person's record.
  const accessLog = prisma.auditLog
    ? await prisma.auditLog.findMany({
        where: { companyId, targetId: leadId },
        orderBy: { createdAt: "desc" },
        take: 500,
        select: {
          action: true,
          actorEmail: true,
          createdAt: true,
          targetType: true,
          metadata: true,
        },
      })
    : [];

  return {
    subject: {
      type: "lead",
      id: lead.id,
      name: [lead.firstName, lead.lastName].filter(Boolean).join(" "),
      email: lead.email,
      phone: lead.phone,
      address: {
        street: lead.street,
        city: lead.city,
        state: lead.state,
        zipCode: lead.zipCode,
      },
    },
    record: {
      source: lead.source,
      externalId: lead.externalId,
      status: lead.status,
      tags: lead.tags,
      customFields: lead.customFields,
      archived: lead.archived,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
      assignedTo: lead.owner ? { name: lead.owner.name, email: lead.owner.email } : null,
    },
    consent: {
      emailOptIn: lead.emailOptIn,
      smsOptIn: lead.smsOptIn,
      consentSource: lead.consentSource,
      consentTimestamp: lead.consentTimestamp,
      suppressionEntries: suppressions.map((s) => ({
        value: s.value,
        reason: s.reason,
        createdAt: s.createdAt,
      })),
    },
    activity: {
      timeline: lead.timeline.map((t) => ({
        type: t.type,
        description: t.description,
        metadata: t.metadata,
        createdAt: t.createdAt,
      })),
      appointments: lead.appointments.map((a) => ({
        title: a.title,
        time: a.time,
        status: a.status,
        locationType: a.locationType,
        notes: a.notes,
        bookedVia: a.bookedVia,
      })),
      campaignEnrollments: lead.campaignEnrollments.map((e) => ({
        campaign: e.campaign?.name,
        status: e.status,
        exitedReason: e.exitedReason,
        enrolledAt: e.createdAt,
      })),
      schedulingConversations: lead.schedulingConversations.map((c) => ({
        channel: c.channel,
        mode: c.mode,
        status: c.status,
        transcript: c.transcript,
        createdAt: c.createdAt,
      })),
    },
    accessLog,
  };
}

async function buildHomeownerExport(companyId, userId) {
  const user = await prisma.user.findFirst({
    where: { id: userId, companyId, role: "HOMEOWNER" },
    include: {
      properties: true,
      tickets: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!user) return null;

  const accessLog = prisma.auditLog
    ? await prisma.auditLog.findMany({
        where: { companyId, targetId: userId },
        orderBy: { createdAt: "desc" },
        take: 500,
        select: { action: true, actorEmail: true, createdAt: true, targetType: true },
      })
    : [];

  return {
    subject: {
      type: "homeowner",
      id: user.id,
      name: user.name,
      email: user.email,
    },
    record: {
      role: user.role,
      hasWarrantyAccess: user.hasWarrantyAccess,
      hasSalesAccess: user.hasSalesAccess,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    properties: user.properties.map((p) => ({
      address: p.address,
      city: p.city,
      state: p.state,
      zipCode: p.zipCode,
      coeDate: p.coeDate,
      coverageTerm: p.coverageTerm,
    })),
    tickets: user.tickets.map((t) => ({
      id: t.id,
      issueType: t.issueType,
      ticketType: t.ticketType,
      description: t.description,
      status: t.status,
      priority: t.priority,
      chatSummary: t.chatSummary,
      extractedInfo: t.extractedInfo,
      createdAt: t.createdAt,
    })),
    accessLog,
  };
}

/**
 * GET /api/sales/privacy/subjects/:type/:id/export
 * Subject access request: everything held about this person, as JSON.
 */
export const exportDataSubject = async (req, res) => {
  try {
    if (!requireCompanyAdmin(req, res)) return;

    const { type, id } = req.params;
    const companyId = req.user.companyId;

    const data =
      type === "homeowner"
        ? await buildHomeownerExport(companyId, id)
        : type === "lead"
          ? await buildLeadExport(companyId, id)
          : undefined;

    if (data === undefined) {
      return res.status(400).json({ message: "Subject type must be 'lead' or 'homeowner'." });
    }
    if (!data) {
      return res.status(404).json({ message: "No record found for that data subject." });
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      exportedBy: req.user.email,
      regulation: "GDPR Art. 15 / Art. 20 · CCPA §1798.100",
      companyId,
      ...data,
    };

    await writeAuditLog({
      req,
      action: "PRIVACY_DATA_EXPORTED",
      companyId,
      targetType: type === "homeowner" ? "User" : "Lead",
      targetId: id,
      metadata: { subjectType: type },
    });

    if (String(req.query.download || "") === "1") {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="data-export-${type}-${id}.json"`,
      );
    }
    return res.json(payload);
  } catch (error) {
    console.error("[Privacy] Export failed:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

async function eraseLead(companyId, leadId, mode) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, companyId } });
  if (!lead) return null;

  // Preserve suppression under a hash so opt-out survives erasure without the
  // list retaining the person's actual contact details.
  const contacts = [normalizeEmail(lead.email), normalizePhone(lead.phone)].filter(Boolean);
  for (const contact of contacts) {
    const existing = await prisma.suppressionList.findUnique({
      where: { companyId_value: { companyId, value: contact } },
    });
    if (!existing) continue;
    await prisma.suppressionList.upsert({
      where: { companyId_value: { companyId, value: hashContact(contact) } },
      create: { companyId, value: hashContact(contact), reason: existing.reason || "ERASURE" },
      update: {},
    });
    await prisma.suppressionList.delete({
      where: { companyId_value: { companyId, value: contact } },
    });
  }

  if (mode === "delete") {
    // Timeline, appointments, enrolments and scheduling conversations all
    // cascade from Lead, so this removes the whole footprint.
    await prisma.lead.delete({ where: { id: leadId } });
    return { mode: "delete", removed: ["lead", "timeline", "appointments", "enrollments", "conversations"] };
  }

  // Anonymise: keep the row so campaign and conversion counts stay accurate,
  // but strip everything that identifies a person. Free-text history is deleted
  // outright rather than scrubbed — message bodies and transcripts cannot be
  // reliably de-identified in place.
  await prisma.leadTimeline.deleteMany({ where: { leadId } });
  await prisma.schedulingConversation.deleteMany({ where: { leadId } });
  await prisma.salesAppointment.updateMany({
    where: { leadId },
    data: { notes: null, meetingLink: null },
  });

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      firstName: "Erased",
      lastName: "Subject",
      email: null,
      phone: null,
      street: null,
      city: null,
      state: null,
      zipCode: null,
      externalId: null,
      customFields: null,
      tags: [],
      emailOptIn: false,
      smsOptIn: false,
      consentSource: "Erasure request",
      consentTimestamp: new Date(),
      archived: true,
      archivedAt: new Date(),
    },
  });

  return { mode: "anonymize", cleared: ["identity", "address", "timeline", "conversations", "appointmentNotes"] };
}

async function eraseHomeowner(companyId, userId, mode) {
  const user = await prisma.user.findFirst({
    where: { id: userId, companyId, role: "HOMEOWNER" },
  });
  if (!user) return null;

  if (mode === "delete") {
    // Tickets and properties reference the user without a cascade, so a hard
    // delete would fail on the foreign key. Warranty claim history also has an
    // independent retention basis, so it is detached rather than destroyed.
    const [tickets, properties] = await Promise.all([
      prisma.ticket.count({ where: { homeownerId: userId } }),
      prisma.property.count({ where: { homeownerId: userId } }),
    ]);
    if (tickets > 0 || properties > 0) {
      return {
        blocked: true,
        message:
          `This homeowner has ${tickets} warranty ticket(s) and ${properties} propertie(s) that cannot be deleted ` +
          `without destroying warranty records. Use anonymisation instead — it removes all personal identifiers ` +
          `while leaving the claim history intact.`,
      };
    }
    await prisma.user.delete({ where: { id: userId } });
    return { mode: "delete", removed: ["user"] };
  }

  // Anonymise. The email column is unique and non-null, so it is replaced with
  // a non-routable placeholder rather than cleared.
  await prisma.user.update({
    where: { id: userId },
    data: {
      name: "Erased Subject",
      email: `erased+${userId}@invalid.local`,
      avatar: null,
      hasWarrantyAccess: false,
      hasSalesAccess: false,
    },
  });

  // Free-text ticket fields can contain the person's own words and details.
  await prisma.ticket.updateMany({
    where: { homeownerId: userId },
    data: {
      description: null,
      draftResponse: null,
      chatSummary: null,
      extractedInfo: null,
    },
  });

  return { mode: "anonymize", cleared: ["identity", "ticketNarratives"] };
}

/**
 * POST /api/sales/privacy/subjects/:type/:id/erase
 * Body: { mode: "anonymize" | "delete", confirm: true }
 */
export const eraseDataSubject = async (req, res) => {
  try {
    if (!requireCompanyAdmin(req, res)) return;

    const { type, id } = req.params;
    const mode = req.body?.mode === "delete" ? "delete" : "anonymize";

    if (req.body?.confirm !== true) {
      return res.status(400).json({
        message: "Erasure is irreversible. Send confirm: true to proceed.",
      });
    }
    if (type !== "lead" && type !== "homeowner") {
      return res.status(400).json({ message: "Subject type must be 'lead' or 'homeowner'." });
    }

    const companyId = req.user.companyId;

    // Capture what is about to be destroyed so the audit entry is meaningful
    // after the record no longer exists.
    const before =
      type === "lead"
        ? await prisma.lead.findFirst({
            where: { id, companyId },
            select: { email: true, phone: true, firstName: true, lastName: true },
          })
        : await prisma.user.findFirst({
            where: { id, companyId, role: "HOMEOWNER" },
            select: { email: true, name: true },
          });

    const result =
      type === "lead"
        ? await eraseLead(companyId, id, mode)
        : await eraseHomeowner(companyId, id, mode);

    if (!result) {
      return res.status(404).json({ message: "No record found for that data subject." });
    }
    if (result.blocked) {
      return res.status(409).json({ message: result.message, code: "ERASURE_BLOCKED" });
    }

    await writeAuditLog({
      req,
      action: "PRIVACY_DATA_ERASED",
      companyId,
      targetType: type === "homeowner" ? "User" : "Lead",
      targetId: id,
      metadata: {
        subjectType: type,
        mode: result.mode,
        // Identify the subject by hash, so the proof-of-erasure record does not
        // itself re-store the contact details that were just erased.
        subjectRef: hashContact(before?.email || before?.phone || id),
      },
    });

    return res.json({
      success: true,
      mode: result.mode,
      message:
        result.mode === "delete"
          ? "The record and all associated data have been permanently deleted."
          : "All personal identifiers have been removed. Non-identifying records were kept for reporting accuracy.",
      details: result,
    });
  } catch (error) {
    console.error("[Privacy] Erasure failed:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * GET /api/sales/privacy/log
 * The company's own record of DSARs handled — evidence of compliance, and the
 * thing an auditor asks for first.
 */
export const getPrivacyLog = async (req, res) => {
  try {
    if (!requireCompanyAdmin(req, res)) return;
    if (!prisma.auditLog) {
      return res.json({ entries: [] });
    }

    const entries = await prisma.auditLog.findMany({
      where: {
        companyId: req.user.companyId,
        action: { in: ["PRIVACY_DATA_EXPORTED", "PRIVACY_DATA_ERASED"] },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return res.json({ entries });
  } catch (error) {
    console.error("[Privacy] Log fetch failed:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
