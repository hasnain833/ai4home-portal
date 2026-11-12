import { inngest } from "../lib/inngest.js";
import prisma from "../lib/prisma.js";
import { validateLeadRow, leadDedupKeys } from "../lib/csv-validation.js";
import { toCsv } from "../lib/utils.js";
import { parseCsvText, parseCsvWithAliases, suggestLeadMapping, leadsFromMapping } from "../lib/csv-parse.js";

const leadsFromBody = ({ headers, rows, mapping } = {}) =>
  Array.isArray(headers) && Array.isArray(rows) && rows.every(Array.isArray) && mapping && typeof mapping === "object"
    ? leadsFromMapping(headers, rows, mapping)
    : [];

/** For importers with fixed columns: rows keyed by field name, from the caller's aliases. */
export const parseCsvRows = (req, res) => {
  const { text, aliases } = req.body || {};
  if (typeof text !== "string" || !aliases || typeof aliases !== "object") {
    return res.status(400).json({ message: "text and aliases are required." });
  }
  return res.json({ rows: parseCsvWithAliases(text, aliases) });
};

/** Step 1 of the lead import: the file's columns, its rows and a first guess at the mapping. */
export const parseLeadCsv = (req, res) => {
  const [headers, ...rows] = parseCsvText(req.body?.text);
  if (!headers || rows.length === 0) {
    return res.status(400).json({ message: "CSV must contain a header row and at least one data row." });
  }
  return res.json({ headers, rows, mapping: suggestLeadMapping(headers) });
};

export const uploadCsvMiddleware = (req, res, next) => next();
export const validateCsvImport = async (req, res) => {
  const leadsList = leadsFromBody(req.body);
  if (leadsList.length === 0) {
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
};

// ── SW-CSV-002: saved column-mapping templates ──────────────────────────────
export const getMappingTemplates = async (req, res) => {
  const templates = await prisma.csvMappingTemplate.findMany({
    where: { companyId: req.user.companyId },
    orderBy: { updatedAt: "desc" },
  });
  return res.json(templates);
};

export const saveMappingTemplate = async (req, res) => {
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
};

export const deleteMappingTemplate = async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.csvMappingTemplate.findUnique({ where: { id } });
  if (!existing || existing.companyId !== req.user.companyId) {
    return res.status(404).json({ message: "Template not found." });
  }
  await prisma.csvMappingTemplate.delete({ where: { id } });
  return res.json({ success: true });
};

export const handleCsvUpload = async (req, res) => {
  const { attested, mergeStrategy = "update" } = req.body;
  const leadsList = leadsFromBody(req.body);

  if (leadsList.length === 0) {
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

  const job = await prisma.csvImportJob.create({
    data: {
      companyId: req.user.companyId,
      userId: req.user.id,
      status: "QUEUED",
      mergeStrategy,
      totalRows: leadsList.length,
      rows: leadsList,
      errors: [],
    },
  });

  // Fire a small background event. The large CSV payload stays in the database
  // so Inngest payload limits and request retries do not duplicate thousands of rows.
  await inngest.send({
    name: "csv/import.started",
    data: {
      jobId: job.id,
      companyId: req.user.companyId,
      userRole: req.user.role,
      userName: req.user.name || req.user.email,
    },
  });

  return res.json({
    message: "CSV import started successfully in the background.",
    jobId: job.id,
    rowCount: leadsList.length,
  });
};

export const getCsvImportStatus = async (req, res) => {
  const job = await prisma.csvImportJob.findFirst({
    where: { id: req.params.id, companyId: req.user.companyId },
    select: {
      id: true,
      status: true,
      totalRows: true,
      processedRows: true,
      createdCount: true,
      updatedCount: true,
      skippedCount: true,
      errorCount: true,
      errorMessage: true,
      startedAt: true,
      completedAt: true,
      failedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!job) return res.status(404).json({ message: "CSV import job not found." });
  return res.json(job);
};

export const downloadCsvImportErrors = async (req, res) => {
  const job = await prisma.csvImportJob.findFirst({
    where: { id: req.params.id, companyId: req.user.companyId },
    select: { id: true, errors: true },
  });
  if (!job) return res.status(404).json({ message: "CSV import job not found." });

  const errors = Array.isArray(job.errors) ? job.errors : [];
  const header = ["row", "reason", "firstName", "lastName", "email", "phone"];
  const csv = toCsv(errors, header);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=csv-import-${job.id}-errors.csv`);
  return res.send(csv);
};
