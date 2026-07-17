import prisma from "../lib/prisma.js";
import { getAuthenticatedClient } from "./salesforce-service.js";
import { maybeAlertOnSyncFailure } from "../lib/sync-alerts.js";

export async function writeBackLeadToSalesforce(companyId, leadId, changedFields) {
  try {
    if (!changedFields || Object.keys(changedFields).length === 0) return;

    const connection = await prisma.salesforceConnection.findUnique({
      where: { companyId },
      select: { isActive: true, writeBackEnabled: true },
    });
    if (!connection || !connection.isActive || !connection.writeBackEnabled) return;

    const lead = await prisma.lead.findFirst({
      where: { id: leadId, companyId },
      select: { externalId: true },
    });
    if (!lead || !lead.externalId) return;

    const mappings = await prisma.salesforceFieldMapping.findMany({
      where: { companyId, isActive: true },
    });
    if (mappings.length === 0) return;

    const byPortalField = new Map(mappings.map((m) => [m.portalField, m]));

    const sfPayload = {};
    for (const [portalField, value] of Object.entries(changedFields)) {
      const mapping = byPortalField.get(portalField);
      if (!mapping) continue;

      if (mapping.isConsentField) {
        if (portalField === "emailOptIn") {
          sfPayload[mapping.salesforceField] = !value;
        } else {
          sfPayload[mapping.salesforceField] = !!value;
        }
      } else {
        sfPayload[mapping.salesforceField] = value;
      }
    }

    if (Object.keys(sfPayload).length === 0) return;

    const auth = await getAuthenticatedClient(companyId);
    if (!auth) return;

    await auth.client.updateRecord("Lead", lead.externalId, sfPayload);

    await prisma.salesforceConnection.update({
      where: { companyId },
      data: { lastWriteBackAt: new Date() },
    });

    await prisma.syncLog.create({
      data: {
        companyId,
        direction: "OUTBOUND",
        action: "WRITE_BACK",
        status: "SUCCESS",
        recordCount: 1,
        message: `Wrote back ${Object.keys(sfPayload).join(", ")} to Salesforce Lead ${lead.externalId}`,
      },
    });
  } catch (err) {
    console.error("[Salesforce Write-back] Failed:", err?.message || err);
    try {
      await prisma.syncLog.create({
        data: {
          companyId,
          direction: "OUTBOUND",
          action: "WRITE_BACK",
          status: "ERROR",
          errorCount: 1,
          message: (err?.message || "Write-back failed").slice(0, 500),
        },
      });
      // SW-CRM-007: repeated write-back failures are as invisible as sync ones.
      await maybeAlertOnSyncFailure(companyId, { action: "write-back" });
    } catch { /* ignore logging failure */ }
  }
}
