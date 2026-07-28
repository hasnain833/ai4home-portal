import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { triggerAutomation } from "../../lib/automation-events.js";
import { validateLeadRow, sanitizeCsvValue } from "../../lib/csv-validation.js";
import { findDuplicateLead, resolveMergedField } from "../../lib/lead-dedup.js";
import { deadLetterJob } from "../../lib/dead-letter.js";

export const handleCsvImport = inngest.createFunction(
  {
    id: "handle-csv-import",
    concurrency: [{ key: "event.data.companyId", limit: 1 }],
    triggers: [{ event: "csv/import.started" }],
    onFailure: async ({ event, error }) =>
      deadLetterJob({ functionId: "handle-csv-import", event, error }),
  },
  async ({ event, step }) => {
    const { jobId, companyId, userRole, userName } = event.data;
    const job = await step.run("load-import-job", async () => {
      if (!jobId) {
        throw new Error("CSV import event is missing jobId.");
      }
      return prisma.csvImportJob.findFirst({
        where: { id: jobId, companyId },
      });
    });

    if (!job) {
      throw new Error(`CSV import job not found: ${jobId}`);
    }

    const rows = Array.isArray(job.rows) ? job.rows : [];
    const mergeStrategy = job.mergeStrategy || "update";
    const userId = job.userId;

    await step.run("mark-running", async () => {
      await prisma.csvImportJob.update({
        where: { id: job.id },
        data: { status: "RUNNING", startedAt: job.startedAt || new Date(), totalRows: rows.length },
      });
    });

    const chunkSize = 250;
    const totals = {
      createdCount: job.createdCount || 0,
      updatedCount: job.updatedCount || 0,
      skippedCount: job.skippedCount || 0,
      errors: Array.isArray(job.errors) ? job.errors : [],
    };

    try {
      for (let i = job.processedRows || 0; i < rows.length; i += chunkSize) {
        const result = await step.run(`process-rows-${i + 1}-${Math.min(i + chunkSize, rows.length)}`, async () => {
          let createdCount = 0;
          let updatedCount = 0;
          let skippedCount = 0;
          const errors = [];
          const createdLeadIds = [];
          const chunk = rows.slice(i, i + chunkSize);

        for (let j = 0; j < chunk.length; j++) {
          const lead = chunk[j];
          const rowNum = i + j + 1;

          const check = validateLeadRow(lead);
          if (!check.valid) {
            errors.push({
              row: rowNum,
              reason: check.reason,
              firstName: lead.firstName || "",
              lastName: lead.lastName || "",
              email: lead.email || "",
              phone: lead.phone || "",
            });
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
          const duplicateLead = await findDuplicateLead(companyId, email, phone);

          const optInSource = emailOptIn || smsOptIn ? "CSV Import" : null;
          const optInTimestamp = emailOptIn || smsOptIn ? new Date() : null;

          if (duplicateLead) {
            if (mergeStrategy === "skip") {
              skippedCount++;
              continue;
            } else if (mergeStrategy === "update") {
              const mergedTags = Array.from(new Set([...duplicateLead.tags, ...tags]));
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
          createdLeadIds.push(createdLead.id);
        }

          return {
            processedRows: chunk.length,
            createdCount,
            updatedCount,
            skippedCount,
            errors,
            createdLeadIds,
          };
        });

        totals.createdCount += result.createdCount;
        totals.updatedCount += result.updatedCount;
        totals.skippedCount += result.skippedCount;
        totals.errors.push(...result.errors);

        await step.run(`checkpoint-${i + result.processedRows}`, async () => {
          await prisma.csvImportJob.update({
            where: { id: job.id },
            data: {
              processedRows: Math.min(i + result.processedRows, rows.length),
              createdCount: totals.createdCount,
              updatedCount: totals.updatedCount,
              skippedCount: totals.skippedCount,
              errorCount: totals.errors.length,
              errors: totals.errors,
            },
          });
        });

        if (result.createdLeadIds.length > 0) {
          await step.run(`emit-automation-${i + 1}`, async () => {
            for (let k = 0; k < result.createdLeadIds.length; k += 100) {
              await Promise.all(
                result.createdLeadIds
                  .slice(k, k + 100)
                  .map((leadId) =>
                    triggerAutomation({
                      companyId,
                      leadId,
                      event: "CRM_INGEST",
                      context: { source: "CSV" },
                    }),
                  ),
              );
            }
          });
        }
      }

      await step.run("mark-completed", async () => {
        await prisma.csvImportJob.update({
          where: { id: job.id },
          data: {
            status: "COMPLETED",
            processedRows: rows.length,
            completedAt: new Date(),
            createdCount: totals.createdCount,
            updatedCount: totals.updatedCount,
            skippedCount: totals.skippedCount,
            errorCount: totals.errors.length,
            errors: totals.errors,
          },
        });
      });

      return {
        jobId: job.id,
        total: rows.length,
        createdCount: totals.createdCount,
        updatedCount: totals.updatedCount,
        skippedCount: totals.skippedCount,
        errorsCount: totals.errors.length,
      };
    } catch (error) {
      await step.run("mark-failed", async () => {
        await prisma.csvImportJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            failedAt: new Date(),
            errorMessage: String(error?.message || error).slice(0, 2000),
          },
        });
      });
      throw error;
    }
  }
);
