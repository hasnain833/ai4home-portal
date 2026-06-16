import prisma from "../lib/prisma.js";
import { createClient } from "@supabase/supabase-js";

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

    const docs = await prisma.knowledgeBaseDocument.findMany({
      where: { companyId: session.companyId || "demo-company" },
      include: {
        community: {
          select: { id: true, name: true, color: true }
        }
      },
      orderBy: { createdAt: "desc" },
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
    const communityId = req.body.communityId;
    
    if (!file) {
      return res.status(400).json({ message: "No file provided" });
    }

    const companyId = session.companyId || "demo-company";

    // 1. Initialize Supabase Admin Client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
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
    const doc = await prisma.knowledgeBaseDocument.create({
      data: {
        name: originalName,
        size,
        url,
        companyId,
        communityId: communityId || null,
      },
      include: {
        community: {
          select: { id: true, name: true, color: true }
        }
      }
    });

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
    const doc = await prisma.knowledgeBaseDocument.findFirst({
      where: { id, companyId: session.companyId || "demo-company" }
    });

    if (!doc) {
      return res.status(404).json({ message: "Document not found" });
    }

    await prisma.knowledgeBaseDocument.delete({
      where: { id },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error("Error deleting knowledge-base doc:", error);
    return res.status(500).json({ message: "Error deleting document" });
  }
};
