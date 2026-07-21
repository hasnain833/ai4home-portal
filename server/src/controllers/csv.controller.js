import { inngest } from "../lib/inngest.js";
import prisma from "../lib/prisma.js";
import { validateLeadRow, leadDedupKeys } from "../lib/csv-validation.js";

export const uploadCsvMiddleware = (req, res, next) => next();
export const validateCsvImport = async (req, res) => {
  try {
    const { leadsList } = req.body;
    if (!leadsList || !Array.isArray(leadsList) || leadsList.length === 0) {
      return res.status(400).json({ message: "No rows to validate." });
    }

    // Pull existing contacts once for in-memory DB-duplicate detection.
    const existing = await prisma.lead.findMany({
      where: { companyId: req.user.companyId },
      select: { email: true, phone: true },
    });
    const existingEmails = new Set(
      existing.map((l) => (l.email || "").trim().toLowerCase()).filter(Boolean)
    );
    const existingPhones = new Set(
      existing.map((l) => (l.phone || "").replace(/\D/g, "").slice(-10)).filter(Boolean)
    );

    const seen = new Set();
    let valid = 0;
    let duplicatesInFile = 0;
    let duplicatesInDb = 0;
    const rejected = [];

    leadsList.forEach((lead, idx) => {
      const rowNum = idx + 1;
      const check = validateLeadRow(lead);
      if (!check.valid) {
        rejected.push({
          row: rowNum,
          reason: check.reason,
          firstName: lead.firstName || "",
          lastName: lead.lastName || "",
          email: lead.email || "",
          phone: lead.phone || "",
        });
        return;
      }

      const keys = leadDedupKeys(lead);
      const email = (lead.email || "").trim().toLowerCase();
      const phone = (lead.phone || "").replace(/\D/g, "").slice(-10);

      if (keys.length && keys.some((k) => seen.has(k))) {
        duplicatesInFile += 1;
        keys.forEach((k) => seen.add(k));
        return;
      }
      keys.forEach((k) => seen.add(k));

      if ((email && existingEmails.has(email)) || (phone && existingPhones.has(phone))) {
        duplicatesInDb += 1;
        return;
      }
      valid += 1;
    });

    return res.json({
      total: leadsList.length,
      valid,
      duplicates: duplicatesInFile + duplicatesInDb,
      duplicatesInFile,
      duplicatesInDb,
      invalid: rejected.length,
      rejected,
    });
  } catch (error) {
    console.error("[CSV Validate] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ── SW-CSV-002: saved column-mapping templates ──────────────────────────────
export const getMappingTemplates = async (req, res) => {
  try {
    const templates = await prisma.csvMappingTemplate.findMany({
      where: { companyId: req.user.companyId },
      orderBy: { updatedAt: "desc" },
    });
    return res.json(templates);
  } catch (error) {
    console.error("[CSV Templates GET] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const saveMappingTemplate = async (req, res) => {
  try {
    const { name, mapping } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ message: "Template name is required." });
    }
    if (!mapping || typeof mapping !== "object") {
      return res.status(400).json({ message: "A mapping object is required." });
    }
    const template = await prisma.csvMappingTemplate.upsert({
      where: { companyId_name: { companyId: req.user.companyId, name: name.trim() } },
      create: { companyId: req.user.companyId, name: name.trim(), mapping },
      update: { mapping },
    });
    return res.status(201).json(template);
  } catch (error) {
    console.error("[CSV Templates POST] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteMappingTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.csvMappingTemplate.findUnique({ where: { id } });
    if (!existing || existing.companyId !== req.user.companyId) {
      return res.status(404).json({ message: "Template not found." });
    }
    await prisma.csvMappingTemplate.delete({ where: { id } });
    return res.json({ success: true });
  } catch (error) {
    console.error("[CSV Templates DELETE] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const handleCsvUpload = async (req, res) => {
  try {
    const { leadsList, attested, mergeStrategy = "update" } = req.body;

    if (!leadsList || !Array.isArray(leadsList) || leadsList.length === 0) {
      return res.status(400).json({ message: "No valid leads provided for import." });
    }

    if (!attested || attested === "false" || attested === false) {
      return res.status(400).json({
        message: "You must attest that contacts have consented to be contacted.",
      });
    }

    // Enforce HOMEOWNER limits
    if (req.user.role.toUpperCase() === "HOMEOWNER") {
      if (leadsList.length > 1000) {
        return res.status(400).json({
          message: "Homeowners can upload a maximum of 1000 rows per file.",
        });
      }
      const HOMEOWNER_TOTAL_CAP = 500;
      const existingCount = await prisma.lead.count({
        where: { companyId: req.user.companyId },
      });
      if (existingCount + leadsList.length > HOMEOWNER_TOTAL_CAP) {
        const remaining = Math.max(0, HOMEOWNER_TOTAL_CAP - existingCount);
        return res.status(400).json({
          message: `Homeowner accounts are limited to ${HOMEOWNER_TOTAL_CAP} leads in total. You already have ${existingCount}, so you can import at most ${remaining} more.`,
        });
      }
    }

    if (leadsList.length > 100000) {
      return res.status(400).json({
        message: "Maximum 100,000 rows allowed per file.",
      });
    }

    // Fire background Inngest event with pre-mapped rows
    await inngest.send({
      name: "csv/import.started",
      data: {
        rows: leadsList,
        mergeStrategy,
        companyId: req.user.companyId,
        userId: req.user.id,
        userRole: req.user.role,
        userName: req.user.name || req.user.email,
      },
    });

    return res.json({
      message: "CSV import started successfully in the background.",
      rowCount: leadsList.length,
    });
  } catch (error) {
    console.error("CSV Upload Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
