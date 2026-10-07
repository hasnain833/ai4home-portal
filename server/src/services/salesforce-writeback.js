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

// ── Pushing AI4HB-created records into the builder's Salesforce ──────────────
// Gated by the same per-tenant write-back switch as field updates. Every record
// we write carries a link back to the portal for the full conversation.

const portalUrl = () => process.env.NEXT_PUBLIC_URL || "";
const leadLink = (leadId) => `${portalUrl()}/sales/leads/${leadId}`;

async function pushClient(companyId) {
  const connection = await prisma.salesforceConnection.findUnique({
    where: { companyId },
    select: { isActive: true, writeBackEnabled: true },
  });
  if (!connection?.isActive || !connection.writeBackEnabled) return null;
  return (await getAuthenticatedClient(companyId))?.client || null;
}

async function logPush(companyId, ok, message) {
  try {
    await prisma.syncLog.create({
      data: {
        companyId,
        direction: "OUTBOUND",
        action: "WRITE_BACK",
        status: ok ? "SUCCESS" : "ERROR",
        recordCount: ok ? 1 : 0,
        errorCount: ok ? 0 : 1,
        message: String(message).slice(0, 500),
      },
    });
    if (!ok) await maybeAlertOnSyncFailure(companyId, { action: "write-back" });
  } catch { /* ignore logging failure */ }
}

/**
 * Creates the Salesforce Lead for a portal lead that has none yet, and stores
 * its id as the lead's externalId so the inbound sync matches it from then on.
 * Returns the Salesforce Lead id, or null when push is off or it failed.
 */
export async function pushLeadToSalesforce(companyId, leadId, client = null) {
  try {
    const lead = await prisma.lead.findFirst({ where: { id: leadId, companyId } });
    if (!lead) return null;
    if (lead.externalId) return lead.externalId;

    client = client || (await pushClient(companyId));
    if (!client) return null;

    const name = `${lead.firstName} ${lead.lastName}`.trim();
    const sfId = await client.createRecord("Lead", {
      FirstName: lead.firstName || undefined,
      LastName: lead.lastName || "-",
      // Company is required on a standard Lead; homebuyers have none.
      Company: name || "Homebuyer",
      Email: lead.email || undefined,
      MobilePhone: lead.phone || undefined,
      Street: lead.street || undefined,
      City: lead.city || undefined,
      State: lead.state || undefined,
      PostalCode: lead.zipCode || undefined,
      Description: `Captured by the AI4HB Sales Agent.\nFull conversation and details: ${leadLink(lead.id)}`,
    });

    // Only claim the id if nothing else (e.g. a sync) linked the lead meanwhile.
    await prisma.lead.updateMany({ where: { id: lead.id, externalId: null }, data: { externalId: sfId } });
    await logPush(companyId, true, `Created Salesforce Lead ${sfId} for ${name}`);
    return sfId;
  } catch (err) {
    console.error("[Salesforce Push] Lead create failed:", err?.message || err);
    await logPush(companyId, false, `Lead create failed: ${err?.message || err}`);
    return null;
  }
}

/** Creates or moves the Salesforce Event for a booked appointment. */
export async function pushAppointmentToSalesforce(appointmentId) {
  let companyId = null;
  try {
    const appt = await prisma.salesAppointment.findUnique({
      where: { id: appointmentId },
      include: { lead: { select: { id: true, companyId: true } } },
    });
    if (!appt) return;
    companyId = appt.lead.companyId;

    const client = await pushClient(companyId);
    if (!client) return;

    const whoId = await pushLeadToSalesforce(companyId, appt.leadId, client);
    if (!whoId) return;

    const start = appt.time;
    const end = appt.endTime || new Date(start.getTime() + (appt.durationMinutes || 30) * 60000);
    const event = {
      Subject: appt.title,
      StartDateTime: start.toISOString(),
      EndDateTime: end.toISOString(),
      Location: appt.locationType === "VIRTUAL" ? "Virtual" : "On site",
      Description: [
        appt.notes,
        `Booked by the AI4HB Sales Agent.\nFull conversation and details: ${leadLink(appt.leadId)}`,
      ].filter(Boolean).join("\n\n"),
    };

    if (appt.salesforceEventId) {
      await client.updateRecord("Event", appt.salesforceEventId, event);
      await logPush(companyId, true, `Moved Salesforce Event ${appt.salesforceEventId}`);
    } else {
      const eventId = await client.createRecord("Event", { ...event, WhoId: whoId });
      await prisma.salesAppointment.update({ where: { id: appt.id }, data: { salesforceEventId: eventId } });
      await logPush(companyId, true, `Created Salesforce Event ${eventId}`);
    }
  } catch (err) {
    console.error("[Salesforce Push] Event write failed:", err?.message || err);
    if (companyId) await logPush(companyId, false, `Event write failed: ${err?.message || err}`);
  }
}

/** Removes the Salesforce Event of a cancelled appointment. */
export async function deleteSalesforceEvent(companyId, eventId) {
  if (!eventId) return;
  try {
    const client = await pushClient(companyId);
    if (!client) return;
    await client.deleteRecord("Event", eventId);
    await logPush(companyId, true, `Deleted Salesforce Event ${eventId}`);
  } catch (err) {
    console.error("[Salesforce Push] Event delete failed:", err?.message || err);
    await logPush(companyId, false, `Event delete failed: ${err?.message || err}`);
  }
}
