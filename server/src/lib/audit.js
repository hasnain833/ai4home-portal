import prisma from "./prisma.js";

/**
 * NFR-S-004 audit trail. Best-effort: a logging failure (including the AuditLog
 * table not existing yet, before `prisma db push`) must never block or fail the
 * audited action, so every write is wrapped and swallowed with a warning.
 *
 * @param {object}   entry
 * @param {import('express').Request} [entry.req]  Express request (for actor + IP)
 * @param {string}   entry.action                 e.g. "ERP_CONNECT", "ERP_DISCONNECT"
 * @param {string}   [entry.companyId]
 * @param {string}   [entry.targetType]
 * @param {string}   [entry.targetId]
 * @param {object}   [entry.metadata]
 */
export async function writeAuditLog({ req, action, companyId, targetType, targetId, metadata } = {}) {
  try {
    if (!prisma.auditLog) {
      // Client not regenerated after adding the model — skip silently.
      return;
    }
    const actor = req?.user || {};
    const ip =
      req?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req?.socket?.remoteAddress ||
      null;

    await prisma.auditLog.create({
      data: {
        action,
        companyId: companyId ?? actor.companyId ?? null,
        actorId: actor.id ?? null,
        actorEmail: actor.email ?? null,
        targetType: targetType ?? null,
        targetId: targetId ?? null,
        metadata: metadata ?? undefined,
        ip,
      },
    });
  } catch (err) {
    // Table may not exist yet (pre-migration) or DB hiccup — never throw.
    console.warn(`[Audit] Failed to write audit log (${action}):`, err.message);
  }
}
