import prisma from "../lib/prisma.js";
import { createClient } from "@supabase/supabase-js";
import { inngest } from "../lib/inngest.js";

const formatFileSize = (bytes) => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

export const getKnowledgeBaseDocs = async (req, res) => {
  try {
    const session = req.user;
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const docs = await prisma.warrantyKB.findMany({
      // scope pins this to the company tier — a null companyId would otherwise
      // become `IS NULL` and match the shared PLATFORM documents.
      where: { scope: "COMPANY", companyId: session.companyId || "demo-company", isActive: true },
      orderBy: { createdAt: "desc" },
      include: { community: { select: { id: true, name: true, color: true } } },
    });
    return res.json(docs);
  } catch (error) {
    console.error("Error fetching knowledge-base docs:", error);
    return res.status(500).json({ message: "Error fetching documents" });
  }
};

export const uploadKnowledgeBaseDoc = async (req, res) => {
  try {
    const session = req.user;
    if (!session || (session.role !== "STAFF" && session.role !== "ADMIN")) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: "No file provided" });
    }

    const companyId = session.companyId || "demo-company";

    // 1. Initialize Supabase Admin Client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Missing Supabase credentials for KB upload");
      return res.status(500).json({ message: "Server configuration error" });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Ensure bucket exists
    const bucketName = "knowledge_base";
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
    if (!bucketsError) {
      const bucketExists = buckets.some(b => b.name === bucketName);
      if (!bucketExists) {
        await supabase.storage.createBucket(bucketName, { public: true });
      }
    }

    // 3. Upload file
    const fileBuffer = file.buffer;
    const originalName = file.originalname || "document";
    const fileName = `${companyId}/${Date.now()}_${originalName.replace(/[^a-zA-Z0-9.\-_]/g, '')}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(fileName, fileBuffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (uploadError) {
      console.error("Supabase upload error:", uploadError);
      return res.status(500).json({ message: "Error uploading file to storage" });
    }

    // 4. Get public URL
    const { data: publicUrlData } = supabase.storage
      .from(bucketName)
      .getPublicUrl(fileName);

    const url = publicUrlData.publicUrl;
    const size = formatFileSize(file.size);

    // 5. Save to database
    // "" or "shared" from the picker means the document applies to every community.
    const rawCommunity = typeof req.body?.communityId === "string" ? req.body.communityId.trim() : "";
    let communityId = rawCommunity && rawCommunity !== "shared" ? rawCommunity : null;

    if (communityId) {
      const community = await prisma.community.findFirst({
        where: { id: communityId, companyId },
        select: { id: true },
      });
      // A community from another company must not silently scope this document.
      if (!community) {
        return res.status(400).json({ message: "That community does not exist." });
      }
    }

    const category =
      typeof req.body?.category === "string" && req.body.category.trim()
        ? req.body.category.trim()
        : "General";

    const doc = await prisma.warrantyKB.create({
      data: {
        name: originalName,
        size,
        url,
        companyId,
        scope: "COMPANY",
        communityId,
        category,
        status: "PENDING",
      },
    });

    // 6. Parse and embed. Inngest makes this durable and retried; if it is not
    // configured the send throws, so fall back to running it in-process rather
    // than leaving the document stuck at PENDING forever.
    try {
      await inngest.send({
        name: "warranty.kb.ingest",
        data: { documentId: doc.id, companyId },
      });
    } catch (e) {
      console.warn("[Warranty KB] Inngest unavailable, ingesting in-process:", e?.message || e);
      const { runWarrantyKbIngestion } = await import("../inngest/functions/warranty-kb-ingest.js");
      runWarrantyKbIngestion(doc.id, companyId).catch(async (err) => {
        console.error("[Warranty KB] Ingestion failed:", err?.message || err);
        await prisma.warrantyKB
          .update({
            where: { id: doc.id },
            data: { status: "FAILED", error: String(err?.message || err).slice(0, 500) },
          })
          .catch(() => {});
      });
    }

    return res.json(doc);
  } catch (error) {
    console.error("Error creating knowledge-base doc:", error);
    return res.status(500).json({ message: "Error creating document" });
  }
};

export const deleteKnowledgeBaseDoc = async (req, res) => {
  try {
    const session = req.user;
    if (!session || (session.role !== "STAFF" && session.role !== "ADMIN")) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const id = req.query.id;

    if (!id) return res.status(400).json({ message: "ID required" });

    // Verify document belongs to company
    const doc = await prisma.warrantyKB.findFirst({
      where: { id, scope: "COMPANY", companyId: session.companyId || "demo-company" },
    });

    if (!doc) {
      return res.status(404).json({ message: "Document not found" });
    }

    await prisma.warrantyKB.update({
      where: { id },
      data: { isActive: false }
    });

    return res.json({ success: true });
  } catch (error) {
    console.error("Error deleting knowledge-base doc:", error);
    return res.status(500).json({ message: "Error deleting document" });
  }
};
