import prisma from "../lib/prisma.js";
import { triggerAutomation } from "../lib/automation-events.js";
import { findDuplicateLead } from "../lib/lead-dedup.js";
import { writeBackLeadToSalesforce } from "../services/salesforce-writeback.js";

export const getLeads = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res
        .status(403)
        .json({ message: "User is not associated with a company." });
    }

    const { search = "", status = "all", tag = "all", includeArchived } = req.query;

    const companyId = req.user.companyId;
    const where = { companyId };

    // SW-CRM-006: hide leads archived by a Salesforce deletion unless explicitly
    // requested (?includeArchived=true).
    if (includeArchived !== "true") {
      where.archived = false;
    }

    // Role-based visibility: homeowners only see their own uploaded leads. Admins/staff see all.
    if (req.user.role.toUpperCase() === "HOMEOWNER") {
      where.ownerId = req.user.id;
    }

    if (status !== "all") {
      where.status = status;
    }

    if (tag !== "all") {
      where.tags = { has: tag };
    }

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
      ];
    }

    const leads = await prisma.lead.findMany({
      where,
      include: {
        owner: {
          select: { name: true, email: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(leads);
  } catch (error) {
    console.error("Fetch leads error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const createLead = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res
        .status(403)
        .json({ message: "User is not associated with a company." });
    }

    const {
      firstName,
      lastName,
      email,
      phone,
      street,
      city,
      state,
      zipCode,
      status,
      tags,
      emailOptIn,
      smsOptIn,
      consentSource,
      customFields,
    } = req.body;

    if (!firstName || !lastName) {
      return res
        .status(400)
        .json({ message: "First name and last name are required." });
    }

    const lead = await prisma.lead.create({
      data: {
        companyId: req.user.companyId,
        source: "MANUAL",
        firstName,
        lastName,
        email: email || null,
        phone: phone || null,
        street: street || null,
        city: city || null,
        state: state || null,
        zipCode: zipCode || null,
        status: status || "New",
        ownerId: req.user.id,
        tags: tags || [],
        emailOptIn: !!emailOptIn,
        smsOptIn: !!smsOptIn,
        consentSource:
          consentSource ||
          (emailOptIn || smsOptIn ? "Manual Form" : null),
        consentTimestamp: emailOptIn || smsOptIn ? new Date() : null,
        customFields: customFields || null,
        timeline: {
          create: {
            type: "IMPORT",
            description: `Lead created manually by ${
              req.user.name || req.user.email
            }`,
          },
        },
      },
    });

    // SW-AMK: fire automation rules for manually-created leads.
    await triggerAutomation({ companyId: lead.companyId, leadId: lead.id, event: "MANUAL_CREATION" });

    return res.json(lead);
  } catch (error) {
    console.error("Create lead error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const importLeads = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res
        .status(403)
        .json({ message: "User is not associated with a company." });
    }

    const { leadsList, mergeStrategy, attested } = req.body;

    if (!attested) {
      return res
        .status(400)
        .json({
          message:
            "You must attest that contacts have consented to be contacted.",
        });
    }

    if (!leadsList || !Array.isArray(leadsList)) {
      return res
        .status(400)
        .json({ message: "Invalid lead list payload." });
    }

    // Check homeowner limits
    if (req.user.role.toUpperCase() === "HOMEOWNER") {
      const existingCount = await prisma.lead.count({
        where: { ownerId: req.user.id },
      });
      const limit = 500;
      if (existingCount + leadsList.length > limit) {
        return res.status(400).json({
          message: `Homeowner accounts are limited to a maximum of ${limit} leads total. You currently have ${existingCount} leads and are trying to import ${leadsList.length}.`,
        });
      }
    }

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const errors = [];

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    for (let i = 0; i < leadsList.length; i++) {
      const rowNum = i + 1;
      const rawLead = leadsList[i];
      const {
        firstName,
        lastName,
        email,
        phone,
        street,
        city,
        state,
        zipCode,
        tags,
        emailOptIn,
        smsOptIn,
      } = rawLead;

      if (!firstName || !lastName) {
        errors.push({
          row: rowNum,
          name: `${firstName || ""} ${lastName || ""}`,
          reason: "First name and last name are required.",
        });
        continue;
      }

      if (email && !emailRegex.test(email)) {
        errors.push({
          row: rowNum,
          name: `${firstName} ${lastName}`,
          reason: `Invalid email format: ${email}`,
        });
        continue;
      }

      // SW-LEAD-003: normalized duplicate detection (case-insensitive email,
      // then phone by last-10-digits, ignoring formatting).
      const duplicateLead = await findDuplicateLead(
        req.user.companyId,
        email,
        phone,
      );

      const optInSource =
        emailOptIn || smsOptIn ? "CSV Import Opt-in Column" : null;
      const optInTimestamp = emailOptIn || smsOptIn ? new Date() : null;

      if (duplicateLead) {
        if (mergeStrategy === "skip") {
          skippedCount++;
          continue;
        } else if (mergeStrategy === "update") {
          await prisma.lead.update({
            where: { id: duplicateLead.id },
            data: {
              firstName,
              lastName,
              street: street || duplicateLead.street,
              city: city || duplicateLead.city,
              state: state || duplicateLead.state,
              zipCode: zipCode || duplicateLead.zipCode,
              tags: Array.from(
                new Set([...(duplicateLead.tags || []), ...(tags || [])])
              ),
              emailOptIn:
                emailOptIn !== undefined
                  ? !!emailOptIn
                  : duplicateLead.emailOptIn,
              smsOptIn:
                smsOptIn !== undefined
                  ? !!smsOptIn
                  : duplicateLead.smsOptIn,
              consentSource: optInSource || duplicateLead.consentSource,
              consentTimestamp:
                optInTimestamp || duplicateLead.consentTimestamp,
              timeline: {
                create: {
                  type: "SYNC_UPDATE",
                  description: `Lead details updated via CSV import by ${
                    req.user.name || req.user.email
                  }`,
                },
              },
            },
          });
          updatedCount++;
          continue;
        }
      }

      // Create new
      await prisma.lead.create({
        data: {
          companyId: req.user.companyId,
          source: "CSV",
          firstName,
          lastName,
          email: email || null,
          phone: phone || null,
          street: street || null,
          city: city || null,
          state: state || null,
          zipCode: zipCode || null,
          status: "New",
          ownerId: req.user.id,
          tags: tags || [],
          emailOptIn: !!emailOptIn,
          smsOptIn: !!smsOptIn,
          consentSource: optInSource,
          consentTimestamp: optInTimestamp,
          timeline: {
            create: {
              type: "IMPORT",
              description: `Lead imported via CSV file by ${
                req.user.name || req.user.email
              }`,
            },
          },
        },
      });

      createdCount++;
    }

    return res.json({
      totalProcessed: leadsList.length,
      createdCount,
      updatedCount,
      skippedCount,
      errorsCount: errors.length,
      errors,
    });
  } catch (error) {
    console.error("CSV import error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteLead = async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "User is not associated with a company." });
    }

    const lead = await prisma.lead.findUnique({
      where: { id }
    });

    if (!lead || lead.companyId !== req.user.companyId) {
      return res.status(404).json({ message: "Lead not found." });
    }

    if (req.user.role.toUpperCase() === "HOMEOWNER" && lead.ownerId !== req.user.id) {
      return res.status(403).json({ message: "You do not have permission to delete this lead." });
    }

    await prisma.lead.delete({
      where: { id }
    });

    return res.json({ message: "Lead deleted successfully." });
  } catch (error) {
    console.error("Delete lead error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateLead = async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.user || !req.user.companyId) {
      return res
        .status(403)
        .json({ message: "User is not associated with a company." });
    }

    const lead = await prisma.lead.findUnique({
      where: { id },
    });

    if (!lead || lead.companyId !== req.user.companyId) {
      return res.status(404).json({ message: "Lead not found." });
    }

    if (
      req.user.role.toUpperCase() === "HOMEOWNER" &&
      lead.ownerId !== req.user.id
    ) {
      return res
        .status(403)
        .json({ message: "You do not have permission to update this lead." });
    }

    const {
      firstName,
      lastName,
      email,
      phone,
      street,
      city,
      state,
      zipCode,
      status,
      tags,
      emailOptIn,
      smsOptIn,
      consentSource,
      customFields,
    } = req.body;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (email && !emailRegex.test(email)) {
      return res.status(400).json({ message: "Invalid email format." });
    }

    const updateData = {};
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (email !== undefined) updateData.email = email || null;
    if (phone !== undefined) updateData.phone = phone || null;
    if (street !== undefined) updateData.street = street || null;
    if (city !== undefined) updateData.city = city || null;
    if (state !== undefined) updateData.state = state || null;
    if (zipCode !== undefined) updateData.zipCode = zipCode || null;
    if (status !== undefined) updateData.status = status;
    if (tags !== undefined) updateData.tags = tags;
    if (emailOptIn !== undefined) updateData.emailOptIn = !!emailOptIn;
    if (smsOptIn !== undefined) updateData.smsOptIn = !!smsOptIn;
    if (consentSource !== undefined) updateData.consentSource = consentSource;
    if (customFields !== undefined) updateData.customFields = customFields;

    if (
      (emailOptIn !== undefined && !!emailOptIn !== lead.emailOptIn) ||
      (smsOptIn !== undefined && !!smsOptIn !== lead.smsOptIn)
    ) {
      updateData.consentTimestamp = new Date();
      if (!updateData.consentSource && !lead.consentSource) {
        updateData.consentSource = "Manual Update";
      }
    }

    const timelineEntries = [];

    if (status !== undefined && status !== lead.status) {
      timelineEntries.push({
        type: "STATUS_CHANGE",
        description: `Lead status changed from '${lead.status}' to '${status}' by ${req.user.name || req.user.email}`,
      });
    }

    if (timelineEntries.length === 0) {
      timelineEntries.push({
        type: "SYNC_UPDATE",
        description: `Lead updated by ${req.user.name || req.user.email}`,
      });
    }

    updateData.timeline = {
      create: timelineEntries,
    };

    const updatedLead = await prisma.lead.update({
      where: { id },
      data: updateData,
      include: {
        owner: {
          select: { name: true, email: true },
        },
      },
    });

    // SW-NUR-003: a status change can be a configured exit condition for a sequence.
    // Emit the event; handleCampaignExit only exits sequences that opted into this status.
    if (status !== undefined && status !== lead.status) {
      const { inngest } = await import("../lib/inngest.js");
      await inngest.send({
        name: "campaign.exit",
        data: { leadId: id, reason: "STATUS_CHANGE", newStatus: status },
      });
      // SW-AMK: status changes can trigger automation rules.
      await triggerAutomation({
        companyId: req.user.companyId,
        leadId: id,
        event: "STATUS_CHANGE",
        context: { newStatus: status, previousStatus: lead.status },
      });
    }

    // SW-CRM-008: write status / consent changes back to Salesforce (gated per
    // tenant, no-op unless writeBackEnabled + the lead came from Salesforce).
    const writeBack = {};
    if (status !== undefined && status !== lead.status) writeBack.status = status;
    if (emailOptIn !== undefined && !!emailOptIn !== lead.emailOptIn) writeBack.emailOptIn = !!emailOptIn;
    if (smsOptIn !== undefined && !!smsOptIn !== lead.smsOptIn) writeBack.smsOptIn = !!smsOptIn;
    if (Object.keys(writeBack).length > 0) {
      writeBackLeadToSalesforce(req.user.companyId, id, writeBack).catch((e) =>
        console.error("[Lead Update] Salesforce write-back failed:", e?.message || e),
      );
    }

    return res.json(updatedLead);
  } catch (error) {
    console.error("Update lead error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getLeadTimeline = async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.user || !req.user.companyId) {
      return res
        .status(403)
        .json({ message: "User is not associated with a company." });
    }

    const lead = await prisma.lead.findUnique({
      where: { id },
    });

    if (!lead || lead.companyId !== req.user.companyId) {
      return res.status(404).json({ message: "Lead not found." });
    }

    if (
      req.user.role.toUpperCase() === "HOMEOWNER" &&
      lead.ownerId !== req.user.id
    ) {
      return res
        .status(403)
        .json({ message: "You do not have permission to view this lead's timeline." });
    }

    const timeline = await prisma.leadTimeline.findMany({
      where: { leadId: id },
      orderBy: { createdAt: "desc" },
    });

    return res.json(timeline);
  } catch (error) {
    console.error("Get lead timeline error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

