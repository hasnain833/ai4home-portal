import prisma from "../lib/prisma.js";
import { triggerAutomation } from "../lib/automation-events.js";
import { findDuplicateLead } from "../lib/lead-dedup.js";
import {
  getAuthenticatedClient,
  mapSalesforceRecordToLead,
  DEFAULT_FIELD_MAPPINGS,
} from "./salesforce-service.js";

export async function runIncrementalSync(companyId) {
  const auth = await getAuthenticatedClient(companyId);
  if (!auth) {
    return {
      ok: false,
      reason: "no-connection",
      message: "No active Salesforce connection.",
    };
  }
  const { client, connection } = auth;

  const mappings = await prisma.salesforceFieldMapping.findMany({
    where: { companyId, isActive: true },
  });
  const activeMappings =
    mappings.length > 0
      ? mappings
      : DEFAULT_FIELD_MAPPINGS.map((m) => ({
          ...m,
          isConsentField: m.isConsentField || false,
        }));

  const sfFields = [
    "Id",
    "SystemModstamp",
    ...activeMappings.map((m) => m.salesforceField),
  ];
  const uniqueFields = [...new Set(sfFields)];
  const lastSyncIso = connection.lastSyncAt
    ? connection.lastSyncAt.toISOString().replace("Z", "+00:00")
    : null;

  let soql = `SELECT ${uniqueFields.join(", ")} FROM Lead`;
  if (lastSyncIso) soql += ` WHERE SystemModstamp > ${lastSyncIso}`;
  soql += " ORDER BY SystemModstamp ASC";

  let allRecords = [];
  let result = await client.query(soql);
  allRecords = result.records || [];
  while (!result.done && result.nextRecordsUrl) {
    result = await client.queryMore(result.nextRecordsUrl);
    allRecords.push(...(result.records || []));
  }

  let createdCount = 0;
  let updatedCount = 0;
  let errorCount = 0;
  const errors = [];

  for (const sfRecord of allRecords) {
    try {
      const leadData = mapSalesforceRecordToLead(sfRecord, activeMappings);
      if (!leadData.firstName || !leadData.lastName) {
        errorCount++;
        errors.push(`Missing required fields for record ${sfRecord.Id || "unknown"}`);
        continue;
      }
      const externalId = leadData.externalId;
      delete leadData.externalId;

      const existing = externalId
        ? await prisma.lead.findFirst({ where: { companyId, externalId } })
        : null;

      if (existing) {
        await prisma.lead.update({
          where: { id: existing.id },
          data: {
            ...leadData,
            source: "SALESFORCE",
            // A record that reappears in Salesforce is no longer deleted.
            archived: false,
            archivedAt: null,
            timeline: {
              create: {
                type: "SYNC_UPDATE",
                description: "Lead updated via Salesforce incremental sync",
              },
            },
          },
        });
        updatedCount++;
      } else {
        // SW-LEAD-003: cross-source linking. Before creating a new row, check
        // whether this Salesforce record matches an existing local (CSV/manual)
        // lead by email/phone. If so — and that lead isn't already tied to a
        // different Salesforce record — LINK it: Salesforce becomes the
        // system-of-record for that lead, avoiding a duplicate.
        const crossMatch = externalId
          ? await findDuplicateLead(companyId, leadData.email, leadData.phone)
          : null;

        if (crossMatch && !crossMatch.externalId) {
          await prisma.lead.update({
            where: { id: crossMatch.id },
            data: {
              ...leadData,
              source: "SALESFORCE",
              externalId,
              archived: false,
              archivedAt: null,
              timeline: {
                create: {
                  type: "SYNC_LINK",
                  description: `Linked existing ${crossMatch.source} lead to Salesforce record ${externalId} (Salesforce is now the system-of-record).`,
                },
              },
            },
          });
          updatedCount++;
          continue;
        }

        const created = await prisma.lead.create({
          data: {
            companyId,
            source: "SALESFORCE",
            externalId: externalId || null,
            firstName: leadData.firstName,
            lastName: leadData.lastName,
            email: leadData.email || null,
            phone: leadData.phone || null,
            street: leadData.street || null,
            city: leadData.city || null,
            state: leadData.state || null,
            zipCode: leadData.zipCode || null,
            status: leadData.status || "New",
            // SW-CRM-009: imported leads default to "consent unknown" (opt-ins
            // false) unless Salesforce explicitly maps a consent field, so they
            // are excluded from opt-in-required SMS/email by the compliance gate.
            emailOptIn: leadData.emailOptIn ?? false,
            smsOptIn: leadData.smsOptIn ?? false,
            consentSource:
              leadData.emailOptIn || leadData.smsOptIn
                ? "Salesforce Sync"
                : "Salesforce (consent unknown)",
            consentTimestamp:
              leadData.emailOptIn || leadData.smsOptIn ? new Date() : null,
            customFields: leadData.customFields || null,
            timeline: {
              create: {
                type: "IMPORT",
                description: "Lead imported via Salesforce incremental sync",
              },
            },
          },
        });
        createdCount++;
        await triggerAutomation({
          companyId,
          leadId: created.id,
          event: "CRM_INGEST",
          context: { source: "SALESFORCE" },
        });
      }
    } catch (recordError) {
      errorCount++;
      errors.push(recordError.message || "Unknown error");
    }
  }

  // SW-CRM-006: reconcile Salesforce deletions → archive the local lead.
  let archivedCount = 0;
  try {
    if (lastSyncIso) {
      const delSoql = `SELECT Id FROM Lead WHERE IsDeleted = true AND SystemModstamp > ${lastSyncIso}`;
      let dr = await client.queryAll(delSoql);
      const delRecords = dr.records || [];
      while (!dr.done && dr.nextRecordsUrl) {
        dr = await client.queryMore(dr.nextRecordsUrl);
        delRecords.push(...(dr.records || []));
      }
      const deletedIds = delRecords.map((r) => r.Id).filter(Boolean);
      if (deletedIds.length) {
        const updated = await prisma.lead.updateMany({
          where: { companyId, externalId: { in: deletedIds }, archived: false },
          data: { archived: true, archivedAt: new Date() },
        });
        archivedCount = updated.count;
      }
    }
  } catch (delErr) {
    errors.push(`Delete reconcile failed: ${delErr.message || delErr}`);
  }

  const changed = createdCount + updatedCount + archivedCount;
  const syncStatus =
    errorCount > 0 && changed > 0 ? "WARNING" : errorCount > 0 ? "ERROR" : "SUCCESS";
  const message = `Incremental sync complete. Created: ${createdCount}, Updated: ${updatedCount}, Archived: ${archivedCount}, Errors: ${errorCount}`;

  await prisma.salesforceConnection.update({
    where: { companyId },
    data: { lastSyncAt: new Date(), lastSyncStatus: syncStatus, lastSyncMessage: message },
  });

  await prisma.syncLog.create({
    data: {
      companyId,
      direction: "INBOUND",
      action: "INCREMENTAL_SYNC",
      status: syncStatus,
      recordCount: createdCount + updatedCount,
      errorCount,
      message,
      metadata: errors.length > 0 ? { errors: errors.slice(0, 50) } : undefined,
    },
  });

  return {
    ok: true,
    totalProcessed: allRecords.length,
    createdCount,
    updatedCount,
    archivedCount,
    errorCount,
    status: syncStatus,
    message,
  };
}
