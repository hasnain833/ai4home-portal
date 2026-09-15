import prisma from "../lib/prisma.js";
import { writeAuditLog } from "../lib/audit.js";
import { BUCKETS, resolveDownloadUrl, uploadObject } from "../lib/storage.js";
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
import { KB_SCOPES } from "../lib/sales-ai.js";

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
    defaultScopeCategories: KB_SCOPES.scheduling,
    supportsCommunities: false,
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
    defaultScopeCategories: null,
    supportsCommunities: true,
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

async function resolveLabCompany() {
  return prisma.company.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
}

async function resolveTestCommunity(rawId, company) {
  const id = typeof rawId === "string" ? rawId.trim() : "";
  if (!id || id === "platform") return { communityId: null };
  if (!company) return { error: "No company exists to test communities against." };

  const community = await prisma.community.findFirst({
    where: { id, companyId: company.id },
    select: { id: true, name: true },
  });
  if (!community) return { error: "That community does not exist." };
  return { communityId: community.id, community };
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

    let testCompany = null;
    let communities = [];
    let communityDocuments = [];

    if (backend.supportsCommunities) {
      testCompany = await resolveLabCompany();
      if (testCompany) {
        communities = await prisma.community.findMany({
          where: { companyId: testCompany.id },
          orderBy: { name: "asc" },
          select: { id: true, name: true, color: true },
        });

        const picked = await resolveTestCommunity(req.query?.communityId, testCompany);
        if (picked.error) return res.status(400).json({ message: picked.error });

        if (picked.communityId) {
          // Both the tenant's real documents and the lab's own test uploads.
          // `isSandbox` travels to the client so the two can be told apart and
          // only the test ones get destructive controls.
          const rows = await backend.model().findMany({
            where: {
              scope: "COMPANY",
              companyId: testCompany.id,
              communityId: picked.communityId,
              isActive: true,
            },
            orderBy: { createdAt: "desc" },
            take: 200,
          });
          communityDocuments = rows.map(toSafeDoc);
        }
      }
    }

    return res.json({
      agent: backend.key,
      supportsCommunities: Boolean(backend.supportsCommunities),
      testCompany,
      communities,
      documents: documents.map(toSafeDoc),
      communityDocuments,
      counts: { platform: documents.length, community: communityDocuments.length },
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

    // Uploading against a community produces a SANDBOX document: it is a
    // COMPANY-scoped row, because a community belongs to a tenant and retrieval
    // cannot reach it otherwise, but `isSandbox` keeps it out of every
    // production query. Without a community it is an ordinary platform
    // document, exactly as before.
    let scope = "PLATFORM";
    let companyId = null;
    let communityId = null;
    let isSandbox = false;

    if (backend.supportsCommunities) {
      const company = await resolveLabCompany();
      const picked = await resolveTestCommunity(req.body?.communityId, company);
      if (picked.error) return res.status(400).json({ message: picked.error });

      if (picked.communityId) {
        scope = "COMPANY";
        companyId = company.id;
        communityId = picked.communityId;
        isSandbox = true;
      }
    }

    const scan = await assertUploadSafe(file, "kbDocument");
    const originalName = file.originalname || "document";

    const category = "General";

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
        ...(backend.supportsCommunities ? { communityId, isSandbox } : {}),
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
        communityId,
        isSandbox,
        agent: backend.key,
        scanned: scan.scanned,
      },
    });
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

/**
 * The lab may only mutate what it owns: the platform tier, and the sandbox
 * documents it created for testing. A tenant's real community document is
 * listed here for context and must survive being looked at — enforced on the
 * server, because hiding the button is not a permission.
 */
function mayMutate(doc) {
  return doc.scope === "PLATFORM" || doc.isSandbox === true;
}

export const deleteKbDocument = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;
    const backend = backendFor(req, res);
    if (!backend) return;
    const { documentId } = req.params;

    const doc = await backend.model().findUnique({ where: { id: documentId } });
    if (!doc) return res.status(404).json({ message: "Document not found" });
    if (!mayMutate(doc)) {
      return res.status(403).json({
        message: "That document belongs to a builder. Delete it from their knowledge base, not here.",
      });
    }

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
    if (!mayMutate(doc)) {
      return res.status(403).json({
        message: "That document belongs to a builder. Reindex it from their knowledge base, not here.",
      });
    }

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


export const getKbDocumentUrl = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;
    const backend = backendFor(req, res);
    if (!backend) return;
    const { documentId } = req.params;

    const where = { id: documentId };
    if (backend.softDelete) where.isDeleted = false;

    if (backend.supportsCommunities) {
      const company = await resolveLabCompany();
      where.OR = [
        { scope: "PLATFORM" },
        company ? { scope: "COMPANY", companyId: company.id } : { scope: "PLATFORM" },
      ];
    } else {
      where.scope = "PLATFORM";
    }

    const doc = await backend.model().findFirst({ where });
    if (!doc) return res.status(404).json({ message: "Document not found" });
    if (!doc.url) {
      return res.status(404).json({ message: "This document has no stored file." });
    }

    const url = await resolveDownloadUrl(doc.url);
    if (!url) {
      return res
        .status(500)
        .json({ message: "Could not generate a link for this document." });
    }

    await writeAuditLog({
      req,
      action: "prompt_lab.kb_document_opened",
      companyId: doc.companyId,
      targetType: backend.targetType,
      targetId: documentId,
      metadata: { name: doc.name, scope: doc.scope, agent: backend.key },
    });

    return res.json({ url, name: doc.name });
  } catch (error) {
    console.error("[Prompt Lab KB] Download URL failed:", error);
    return res.status(500).json({ message: "Failed to open this document" });
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

    let companyId = null;
    let communityId = null;

    if (backend.supportsCommunities) {
      const company = await resolveLabCompany();
      const picked = await resolveTestCommunity(req.body?.communityId, company);
      if (picked.error) return res.status(400).json({ message: picked.error });

      if (picked.communityId) {
        companyId = company.id;
        communityId = picked.communityId;
      }
    }

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
      communityId,
      // The lab is the one caller allowed to see sandbox documents.
      true,
    );

    return res.json({
      question,
      method,
      communityId,
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
