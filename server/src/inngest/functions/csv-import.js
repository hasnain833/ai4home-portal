import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";

export const handleCsvImport = inngest.createFunction(
  { id: "handle-csv-import", event: "csv/import.started" },
  async ({ event, step }) => {
    const { rows, mergeStrategy, companyId, userId, userRole, userName } = event.data;
    
    const chunkSize = 100;
    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const errors = [];

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    await step.run("process-rows", async () => {
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        
        for (let j = 0; j < chunk.length; j++) {
          const lead = chunk[j];
          const rowNum = i + j + 1;
          
          const firstName = lead.firstName;
          const lastName = lead.lastName;
          const email = lead.email;
          const phone = lead.phone;
          const emailOptIn = Boolean(lead.emailOptIn);
          const smsOptIn = Boolean(lead.smsOptIn);
          const tags = Array.isArray(lead.tags) ? lead.tags : [];
          
          if (!firstName || !lastName) {
            errors.push({ row: rowNum, reason: "First name and last name are required." });
            continue;
          }

          if (email && !emailRegex.test(email)) {
            errors.push({ row: rowNum, reason: `Invalid email format: ${email}` });
            continue;
          }

          let duplicateLead = null;
          const orConditions = [];
          if (email && email.trim()) orConditions.push({ email: email.trim() });
          if (phone && phone.trim()) orConditions.push({ phone: phone.trim() });

          if (orConditions.length > 0) {
            duplicateLead = await prisma.lead.findFirst({
              where: {
                companyId,
                OR: orConditions,
              },
            });
          }

          const optInSource = emailOptIn || smsOptIn ? "CSV Import" : null;
          const optInTimestamp = emailOptIn || smsOptIn ? new Date() : null;

          if (duplicateLead) {
            if (mergeStrategy === "skip") {
              skippedCount++;
              continue;
            } else if (mergeStrategy === "update") {
              // Merge tags
              const mergedTags = Array.from(new Set([...duplicateLead.tags, ...tags]));

              await prisma.lead.update({
                where: { id: duplicateLead.id },
                data: {
                  firstName,
                  lastName,
                  email: email || duplicateLead.email,
                  phone: phone || duplicateLead.phone,
                  street: lead.street || duplicateLead.street,
                  city: lead.city || duplicateLead.city,
                  state: lead.state || duplicateLead.state,
                  zipCode: lead.zipCode || duplicateLead.zipCode,
                  tags: mergedTags,
                  emailOptIn: lead.emailOptIn !== undefined ? emailOptIn : duplicateLead.emailOptIn,
                  smsOptIn: lead.smsOptIn !== undefined ? smsOptIn : duplicateLead.smsOptIn,
                  consentSource: optInSource || duplicateLead.consentSource,
                  consentTimestamp: optInTimestamp || duplicateLead.consentTimestamp,
                  timeline: {
                    create: {
                      type: "SYNC_UPDATE",
                      description: `Lead details updated via CSV import by ${userName}`,
                    },
                  },
                },
              });
              updatedCount++;
              continue;
            }
          }

          await prisma.lead.create({
            data: {
              companyId,
              source: "CSV",
              firstName,
              lastName,
              email: email || null,
              phone: phone || null,
              street: lead.street || null,
              city: lead.city || null,
              state: lead.state || null,
              zipCode: lead.zipCode || null,
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
        }
      }
    });

    return { total: rows.length, createdCount, updatedCount, skippedCount, errorsCount: errors.length };
  }
);
