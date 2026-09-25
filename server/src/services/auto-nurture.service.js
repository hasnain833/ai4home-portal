import prisma from "../lib/prisma.js";
import { PLAYBOOK_NAME, playbookSteps } from "../lib/nurture-playbook.js";

export const AUTO_KIND = "AUTO_180";

// Lead-creation triggers that start the 180-day nurture. A returning web-form
// submitter is already a lead, and a Salesforce sync is the CRM's lead, not ours.
export function isNewLeadEvent(triggerEvent, context = {}) {
  if (triggerEvent === "MANUAL_CREATION") return true;
  if (triggerEvent === "WEB_FORM") return !context?.returning;
  if (triggerEvent === "CRM_INGEST") return context?.source === "CSV";
  return false;
}

/**
 * The company's built-in nurture campaign, created on first use and switched on.
 * Serialised per company: a CSV import fires many enrollments at once, and each
 * would otherwise create its own copy.
 */
export async function ensureAutoCampaign(companyId) {
  const find = (db) =>
    db.campaign.findFirst({ where: { companyId, kind: AUTO_KIND }, orderBy: { createdAt: "asc" } });

  const existing = await find(prisma);
  if (existing) return existing;

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auto-nurture:${companyId}`}))`;
    const raced = await find(tx);
    if (raced) return raced;
    return tx.campaign.create({
      data: {
        companyId,
        kind: AUTO_KIND,
        name: PLAYBOOK_NAME,
        description: "Runs automatically for every new lead from your website form, manual entry, or CSV import.",
        status: "Active",
        channel: "Email & SMS",
        steps: { create: playbookSteps() },
      },
    });
  });
}
