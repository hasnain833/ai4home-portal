/**
 * Knowledge Base management from inside the Prompt Lab.
 *
 * This screen manages the PLATFORM tier only — the shared knowledge every
 * company's agent retrieves. A single builder's own documents are uploaded on
 * that company's own KB screen, which enforces its own permissions.
 *
 * Super-admin only: platform KB content reaches every tenant, so it is not
 * something a company admin can write.
 */
import prisma from "../lib/prisma.js";
import { writeAuditLog } from "../lib/audit.js";
import { BUCKETS, uploadObject } from "../lib/storage.js";
import {
  assertUploadSafe,
  buildStorageKey,
  UploadRejected,
} from "../lib/file-security.js";
import { runKbIngestion } from "../inngest/functions/kb-ingest.js";
import { runWarrantyKbIngestion } from "../inngest/functions/warranty-kb-ingest.js";
import {
  queryDetailed as salesQuery,
  deleteDocument as salesDeleteChunks,
  getRetrievalStatus as salesRetrievalStatus,
} from "../services/vector-store.service.js";
import {
  queryDetailed as warrantyQuery,
  deleteDocument as warrantyDeleteChunks,
  getRetrievalStatus as warrantyRetrievalStatus,
} from "../services/warranty-vector.service.js";
import { KB_CATEGORIES, KB_SCOPES } from "../lib/sales-ai.js";

function denyUnlessSuperAdmin(req, res) {
  if (!req.user?.isSuperAdmin) {
    res.status(403).json({ message: "Unauthorized" });
    return true;
  }
  return false;
}

const KB_BACKENDS = {
  sales: {
    model: () => prisma.salesKB,
    bucket: BUCKETS.salesKb,
    ingest: runKbIngestion,
    query: salesQuery,
    deleteChunks: salesDeleteChunks,
    retrievalStatus: salesRetrievalStatus,
    categories: Object.values(KB_CATEGORIES),
    defaultScopeCategories: KB_SCOPES.scheduling,
    targetType: "SalesKB",
    softDelete: true,
  },
  warranty: {
    model: () => prisma.warrantyKB,
    bucket: BUCKETS.warrantyKb,
    ingest: runWarrantyKbIngestion,
    query: warrantyQuery,
    deleteChunks: warrantyDeleteChunks,
    retrievalStatus: warrantyRetrievalStatus,
    categories: ["General", "diagnostic", "policy", "faq"],
    defaultScopeCategories: null,
    targetType: "WarrantyKB",
    softDelete: false,
  },
};

function backendFor(req, res) {
  const key = String(
    req.query?.agent || req.body?.agent || "sales",
  ).toLowerCase();
  const backend = KB_BACKENDS[key];
  if (!backend) {
    res.status(400).json({ message: `Unknown agent "${key}".` });
    return null;
  }
  return { key, ...backend };
}

function formatFileSize(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function toSafeDoc(doc) {
  const { url, ...rest } = doc;
  return { ...rest, hasFile: Boolean(url) };
}

export const listKbDocuments = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;
    const backend = backendFor(req, res);
    if (!backend) return;

    const where = { scope: "PLATFORM" };
    if (backend.softDelete) where.isDeleted = false;

    const documents = await backend.model().findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const retrieval = await backend
      .retrievalStatus(null)
      .catch((e) => ({ status: "UNAVAILABLE", detail: e.message }));

    return res.json({
      agent: backend.key,
      categories: backend.categories,
      documents: documents.map(toSafeDoc),
      counts: { platform: documents.length },
      retrieval,
    });
  } catch (error) {
    console.error("[Prompt Lab KB] List failed:", error);
    return res
      .status(500)
      .json({ message: "Failed to load knowledge base documents" });
  }
};

export const uploadKbDocument = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;
    const backend = backendFor(req, res);
    if (!backend) return;

    const file = req.file;
    if (!file) return res.status(400).json({ message: "No file provided" });

    const scope = "PLATFORM";
    const companyId = null;

    const scan = await assertUploadSafe(file, "kbDocument");
    const originalName = file.originalname || "document";
    const category =
      typeof req.body?.category === "string" && req.body.category.trim()
        ? req.body.category.trim()
        : "General";

    const key = buildStorageKey(
      companyId || "platform",
      originalName,
      "document",
    );
    const { ref } = await uploadObject({
      bucket: backend.bucket,
      key,
      buffer: file.buffer,
      contentType: file.mimetype,
      isPublic: false,
    });

    const document = await backend.model().create({
      data: {
        scope,
        companyId,
        name: originalName,
        size: formatFileSize(file.size),
        url: ref,
        category,
        status: "PENDING",
      },
    });

    await writeAuditLog({
      req,
      action: "prompt_lab.kb_document_uploaded",
      companyId,
      targetType: backend.targetType,
      targetId: document.id,
      metadata: {
        name: originalName,
        bytes: file.size,
        scope,
        agent: backend.key,
        scanned: scan.scanned,
      },
    });

    // Ingestion runs after the response, and deliberately so.
    //
    // Embedding dominates the cost: a book-length PDF is a thousand-plus chunks
    // and minutes of work, far past any proxy's patience. Holding the request
    // makes the browser report a failure while the server is still succeeding.
    //
    // So respond now and let the client poll the document's status. The one thing
    // that must not happen is a silent stall, so a thrown error is recorded on the
    // row as FAILED rather than only reaching the log.
    backend.ingest(document.id, companyId).catch(async (e) => {
      console.error(
        `[Prompt Lab KB] Ingestion failed for ${document.id}:`,
        e?.message || e,
      );
      await backend
        .model()
        .update({
          where: { id: document.id },
          data: {
            status: "FAILED",
            error: String(e?.message || e).slice(0, 500),
          },
        })
        .catch(() => {});
    });

    return res.status(201).json(toSafeDoc(document));
  } catch (error) {
    if (error instanceof UploadRejected) {
      return res
        .status(error.status)
        .json({ message: error.message, code: error.code });
    }
    console.error("[Prompt Lab KB] Upload failed:", error);
    return res.status(500).json({ message: "Failed to upload this document" });
  }
};

export const deleteKbDocument = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;
    const backend = backendFor(req, res);
    if (!backend) return;
    const { documentId } = req.params;

    const doc = await backend.model().findUnique({ where: { id: documentId } });
    if (!doc) return res.status(404).json({ message: "Document not found" });

    await backend.deleteChunks(doc.companyId, documentId);
    await backend.model().delete({ where: { id: documentId } });

    await writeAuditLog({
      req,
      action: "prompt_lab.kb_document_deleted",
      companyId: doc.companyId,
      targetType: backend.targetType,
      targetId: documentId,
      metadata: { name: doc.name, scope: doc.scope, agent: backend.key },
    });

    return res.json({ message: "Document deleted" });
  } catch (error) {
    console.error("[Prompt Lab KB] Delete failed:", error);
    return res.status(500).json({ message: "Failed to delete this document" });
  }
};

export const reindexKbDocument = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;
    const backend = backendFor(req, res);
    if (!backend) return;
    const { documentId } = req.params;

    const doc = await backend.model().findUnique({ where: { id: documentId } });
    if (!doc) return res.status(404).json({ message: "Document not found" });

    await backend.model().update({
      where: { id: documentId },
      data: { status: "PENDING", error: null },
    });

    backend
      .ingest(documentId, doc.companyId)
      .catch((e) =>
        console.error(
          `[Prompt Lab KB] Reindex failed for ${documentId}:`,
          e?.message || e,
        ),
      );

    return res.json({ message: "Reindexing started", documentId });
  } catch (error) {
    console.error("[Prompt Lab KB] Reindex failed:", error);
    return res.status(500).json({ message: "Failed to reindex this document" });
  }
};


export const probeKb = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;
    const backend = backendFor(req, res);
    if (!backend) return;

    const question =
      typeof req.body?.question === "string" ? req.body.question.trim() : "";
    if (!question) {
      return res
        .status(400)
        .json({ message: "Enter a question to test retrieval with." });
    }

    // Platform tier only, so the probe tests exactly the documents listed above.
    // Production retrieval also layers in that company's own documents.
    const companyId = null;
    const limit = Math.min(Math.max(Number(req.body?.limit) || 8, 1), 20);
    const categories =
      Array.isArray(req.body?.categories) && req.body.categories.length
        ? req.body.categories
        : backend.defaultScopeCategories;

    const startedAt = Date.now();
    const { method, results } = await backend.query(
      companyId,
      question,
      limit,
      categories,
    );

    return res.json({
      question,
      method,
      latencyMs: Date.now() - startedAt,
      results: (results || []).map((r) => ({
        documentId: r.documentId,
        name: r.name || "",
        category: r.category || "General",
        scope: r.scope || "COMPANY",
        score: Number(r.score) || 0,
        text: r.text || "",
      })),
    });
  } catch (error) {
    console.error("[Prompt Lab KB] Probe failed:", error);
    return res.status(500).json({ message: "Retrieval test failed" });
  }
};
