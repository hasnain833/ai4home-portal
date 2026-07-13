import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { triggerAutomation } from "../../lib/automation-events.js";
import { validateLeadRow, sanitizeCsvValue } from "../../lib/csv-validation.js";
import { findDuplicateLead, resolveMergedField } from "../../lib/lead-dedup.js";

export const handleCsvImport = inngest.createFunction(
  { id: "handle-csv-import", triggers: [{ event: "csv/import.started" }] },
  async ({ event, step }) => {
    const { rows, mergeStrategy, companyId, userId, userRole, userName } = event.data;

    const chunkSize = 100;
    const summary = await step.run("process-rows", async () => {
      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      const errors = [];

      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        for (let j = 0; j < chunk.length; j++) {
          const lead = chunk[j];
          const rowNum = i + j + 1;

          const check = validateLeadRow(lead);
          if (!check.valid) {
            errors.push({ row: rowNum, reason: check.reason });
            continue;
          }
          const firstName = sanitizeCsvValue(lead.firstName);
          const lastName = sanitizeCsvValue(lead.lastName);
          const email = lead.email;
          const phone = lead.phone;
          const street = sanitizeCsvValue(lead.street);
          const city = sanitizeCsvValue(lead.city);
          const state = sanitizeCsvValue(lead.state);
          const zipCode = sanitizeCsvValue(lead.zipCode);
          const emailOptIn = Boolean(lead.emailOptIn);
          const smsOptIn = Boolean(lead.smsOptIn);
          const tags = (Array.isArray(lead.tags) ? lead.tags : []).map(sanitizeCsvValue);

          // SW-LEAD-003: normalized dedup (case-insensitive email, then phone
          // by last-10-digits ignoring formatting).
          const duplicateLead = await findDuplicateLead(companyId, email, phone);

          const optInSource = emailOptIn || smsOptIn ? "CSV Import" : null;
          const optInTimestamp = emailOptIn || smsOptIn ? new Date() : null;

          if (duplicateLead) {
            if (mergeStrategy === "skip") {
              skippedCount++;
              continue;
            } else if (mergeStrategy === "update") {
              // Merge tags (union across sources).
              const mergedTags = Array.from(new Set([...duplicateLead.tags, ...tags]));

              // SW-LEAD-003: cross-source linking with CRM as system-of-record.
              // If the matched lead is owned by Salesforce (has an externalId), a
              // CSV import must NOT overwrite its authoritative fields — it only
              // fills gaps the CRM left empty. Otherwise the CSV value wins.
              const isCrmOwned = !!duplicateLead.externalId;

              await prisma.lead.update({
                where: { id: duplicateLead.id },
                data: {
                  firstName: resolveMergedField(firstName, duplicateLead.firstName, isCrmOwned),
                  lastName: resolveMergedField(lastName, duplicateLead.lastName, isCrmOwned),
                  email: resolveMergedField(email, duplicateLead.email, isCrmOwned),
                  phone: resolveMergedField(phone, duplicateLead.phone, isCrmOwned),
                  street: resolveMergedField(street, duplicateLead.street, isCrmOwned),
                  city: resolveMergedField(city, duplicateLead.city, isCrmOwned),
                  state: resolveMergedField(state, duplicateLead.state, isCrmOwned),
                  zipCode: resolveMergedField(zipCode, duplicateLead.zipCode, isCrmOwned),
                  tags: mergedTags,
                  emailOptIn: lead.emailOptIn !== undefined ? emailOptIn : duplicateLead.emailOptIn,
                  smsOptIn: lead.smsOptIn !== undefined ? smsOptIn : duplicateLead.smsOptIn,
                  consentSource: optInSource || duplicateLead.consentSource,
                  consentTimestamp: optInTimestamp || duplicateLead.consentTimestamp,
                  timeline: {
                    create: {
                      type: "SYNC_UPDATE",
                      description: isCrmOwned
                        ? `CSV import merged into Salesforce-owned lead by ${userName} (CRM fields preserved).`
                        : `Lead details updated via CSV import by ${userName}.`,
                    },
                  },
                },
              });
              updatedCount++;
              continue;
            }
          }

          const createdLead = await prisma.lead.create({
            data: {
              companyId,
              source: "CSV",
              firstName,
              lastName,
              email: email || null,
              phone: phone || null,
              street: street || null,
              city: city || null,
              state: state || null,
              zipCode: zipCode || null,
              tags: tags,
              status: "New",
              ownerId: userId,
              emailOptIn,
              smsOptIn,
              consentSource: optInSource,
              consentTimestamp: optInTimestamp,
              timeline: {
                create: {
                  type: "IMPORT",
                  description: `Lead imported via CSV file by ${userName}`,
                },
              },
            },
          });
          createdCount++;
          // SW-AMK: newly imported leads can trigger automation rules.
          await triggerAutomation({ companyId, leadId: createdLead.id, event: "CRM_INGEST", context: { source: "CSV" } });
        }
      }

      return { createdCount, updatedCount, skippedCount, errors };
    });

    return {
      total: rows.length,
      createdCount: summary.createdCount,
      updatedCount: summary.updatedCount,
      skippedCount: summary.skippedCount,
      errorsCount: summary.errors.length,
      errors: summary.errors,
    };
  }
);
