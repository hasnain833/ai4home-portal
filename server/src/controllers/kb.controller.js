import prisma from "../lib/prisma.js";
import { createClient } from "@supabase/supabase-js";
import { deleteDocument, queryDetailed, backfillEmbeddings } from "../services/vector-store.service.js";
import { runKbIngestion } from "../inngest/functions/kb-ingest.js";

const SALES_KB_BUCKET = "sales_knowledge_base";

function formatFileSize(bytes) {
  if (!bytes) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export const getSalesKB = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    // SW-KB-003: soft-deleted docs are hidden from the active list.
    const documents = await prisma.salesKB.findMany({
      where: { companyId: req.user.companyId, isDeleted: false },
      orderBy: { createdAt: "desc" },
    });

    return res.json(documents);
  } catch (error) {
    console.error("[Sales KB List] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const addSalesKBDocument = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const { name, size, url, category } = req.body;

    if (!name || !size || !url) {
      return res.status(400).json({ message: "Missing required fields: name, size, url" });
    }

    const document = await prisma.salesKB.create({
      data: {
        companyId: req.user.companyId,
        name,
        size,
        url,
        category: category || "General",
        status: "PENDING",
      },
    });

    // Index in the background (extract → chunk → store). Fire-and-forget so the
    // response is immediate; the doc's status badge tracks INDEXING → READY.
    runKbIngestion(document.id, req.user.companyId).catch((e) =>
      console.error("[Sales KB] Ingestion failed:", e?.message || e),
    );

    return res.status(201).json(document);
  } catch (error) {
    console.error("[Sales KB Create] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// SW-KB-001: upload a file (PDF/DOCX/TXT) to storage, create the SalesKB row, and
// kick off async indexing. Mirrors the Warranty KB storage flow but into a Sales bucket.
export const uploadSalesKBDocument = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const file = req.file;
    if (!file) return res.status(400).json({ message: "No file provided" });

    const companyId = req.user.companyId;
    const category = req.body.category || "General";

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Missing Supabase credentials for Sales KB upload");
      return res.status(500).json({ message: "Server storage is not configured" });
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Ensure the bucket exists (public so the ingester can fetch the file by URL).
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
    if (!bucketsError && !buckets.some((b) => b.name === SALES_KB_BUCKET)) {
      await supabase.storage.createBucket(SALES_KB_BUCKET, { public: true });
    }

    const originalName = file.originalname || "document";
    const fileName = `${companyId}/${Date.now()}_${originalName.replace(/[^a-zA-Z0-9.\-_]/g, "")}`;

    const { error: uploadError } = await supabase.storage
      .from(SALES_KB_BUCKET)
      .upload(fileName, file.buffer, { contentType: file.mimetype, upsert: false });
    if (uploadError) {
      console.error("Sales KB storage upload error:", uploadError);
      return res.status(500).json({ message: "Error uploading file to storage" });
    }

    const { data: publicUrlData } = supabase.storage.from(SALES_KB_BUCKET).getPublicUrl(fileName);

    const document = await prisma.salesKB.create({
      data: {
        companyId,
        name: originalName,
        size: formatFileSize(file.size),
        url: publicUrlData.publicUrl,
        category,
        status: "PENDING",
      },
    });

    // Index in the background (extract → chunk → store). Fire-and-forget so the
    // response is immediate; the doc's status badge tracks INDEXING → READY.
    runKbIngestion(document.id, companyId).catch((e) =>
      console.error("[Sales KB] Ingestion failed:", e?.message || e),
    );

    return res.status(201).json(document);
  } catch (error) {
    console.error("[Sales KB Upload] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// SW-KB-003: soft delete — remove from retrieval (drop vectors) but keep the row
// for rollback/audit.
export const deleteSalesKBDocument = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const { id } = req.params;

    const document = await prisma.salesKB.findFirst({
      where: { id, companyId: req.user.companyId, isDeleted: false },
    });

    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }

    // Drop the document's chunks from retrieval; still soft-delete even if this fails.
    try {
      await deleteDocument(req.user.companyId, document.id);
    } catch (e) {
      console.error("[Sales KB Delete] chunk cleanup failed:", e?.message || e);
    }

    await prisma.salesKB.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date(), status: "PENDING", chunkCount: 0 },
    });

    return res.json({ success: true, message: "Document removed from the knowledge base." });
  } catch (error) {
    console.error("[Sales KB Delete] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Retrieval test / citation endpoint (SW-KB-005): returns the top-k chunks and
// which documents they came from for a query.
export const searchSalesKB = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const { q, k = 5, categories = null } = req.body;
    if (!q || !q.trim()) {
      return res.status(400).json({ message: "Query text 'q' is required" });
    }

    const { matches, method } = await queryDetailed(
      req.user.companyId,
      q,
      Math.min(Number(k) || 5, 20),
      categories,
    ).then((r) => ({ matches: r.results, method: r.method }));

    // De-duplicate cited documents for a clean citation list.
    const citations = [];
    const seen = new Set();
    for (const m of matches) {
      if (m.documentId && !seen.has(m.documentId)) {
        seen.add(m.documentId);
        citations.push({ documentId: m.documentId, name: m.name, category: m.category });
      }
    }

    // `method` tells you whether this was semantic (pgvector) or the FTS fallback.
    return res.json({ matches, citations, method });
  } catch (error) {
    console.error("[Sales KB Search] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// SW-KB-006: structured brand/company profile injected into AI prompts at runtime.
export const getBrandProfile = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }
    const company = await prisma.company.findUnique({
      where: { id: req.user.companyId },
      select: { name: true, logo: true, voiceProfile: true, salesBrandProfile: true },
    });
    return res.json({
      companyName: company?.name || "",
      logo: company?.logo || null,
      voiceProfile: company?.voiceProfile || "professional",
      profile: company?.salesBrandProfile || {},
    });
  } catch (error) {
    console.error("[Sales KB Brand Profile Get] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateBrandProfile = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }
    const { profile, voiceProfile } = req.body;
    const updated = await prisma.company.update({
      where: { id: req.user.companyId },
      data: {
        ...(voiceProfile ? { voiceProfile } : {}),
        ...(profile !== undefined ? { salesBrandProfile: profile } : {}),
      },
      select: { voiceProfile: true, salesBrandProfile: true },
    });
    return res.json({ success: true, voiceProfile: updated.voiceProfile, profile: updated.salesBrandProfile || {} });
  } catch (error) {
    console.error("[Sales KB Brand Profile Update] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Backfill pgvector embeddings for existing KB chunks that were ingested before
// the pgvector upgrade. Processes in batches; call repeatedly until remaining=0.
export const reindexSalesKB = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const batchSize = Math.min(Number(req.body.batchSize) || 50, 200);
    const result = await backfillEmbeddings(req.user.companyId, batchSize);

    return res.json({
      success: true,
      processed: result.processed,
      remaining: result.remaining,
      message: result.remaining > 0
        ? `Processed ${result.processed} chunks. ${result.remaining} remaining — call again to continue.`
        : `Done! All chunks now have embeddings.`,
    });
  } catch (error) {
    console.error("[Sales KB Reindex] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
