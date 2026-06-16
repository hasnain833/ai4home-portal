import prisma from "../lib/prisma.js";

export const getLeads = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res
        .status(403)
        .json({ message: "User is not associated with a company." });
    }

    const { search = "", status = "all", tag = "all" } = req.query;

    const companyId = req.user.companyId;
    const where = { companyId };

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

      // Check duplicates
      let duplicateLead = null;
      if (email || phone) {
        duplicateLead = await prisma.lead.findFirst({
          where: {
            companyId: req.user.companyId,
            OR: [
              email ? { email } : undefined,
              phone ? { phone } : undefined,
            ].filter(Boolean),
          },
        });
      }

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
