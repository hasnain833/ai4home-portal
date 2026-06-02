import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "@/lib/session";
import { createClient } from "@supabase/supabase-js";

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

export async function GET(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
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
    return NextResponse.json(docs);
  } catch (error) {
    console.error("Error fetching knowledge-base docs:", error);
    return NextResponse.json({ message: "Error fetching documents" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session || (session.role !== "STAFF" && session.role !== "ADMIN")) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const communityId = formData.get("communityId") as string;
    
    if (!file) {
      return NextResponse.json({ message: "No file provided" }, { status: 400 });
    }

    const companyId = session.companyId || "demo-company";

    // 1. Initialize Supabase Admin Client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
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
    const fileBuffer = await file.arrayBuffer();
    const fileName = `${companyId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '')}`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(fileName, fileBuffer, {
        contentType: file.type,
        upsert: false
      });

    if (uploadError) {
      console.error("Supabase upload error:", uploadError);
      return NextResponse.json({ message: "Error uploading file to storage" }, { status: 500 });
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
        name: file.name,
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

    return NextResponse.json(doc);
  } catch (error) {
    console.error("Error creating knowledge-base doc:", error);
    return NextResponse.json({ message: "Error creating document" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session || (session.role !== "STAFF" && session.role !== "ADMIN")) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) return NextResponse.json({ message: "ID required" }, { status: 400 });

    // Verify document belongs to company
    const doc = await prisma.knowledgeBaseDocument.findFirst({
      where: { id, companyId: session.companyId || "demo-company" }
    });

    if (!doc) {
      return NextResponse.json({ message: "Document not found" }, { status: 404 });
    }

    await prisma.knowledgeBaseDocument.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting knowledge-base doc:", error);
    return NextResponse.json({ message: "Error deleting document" }, { status: 500 });
  }
}

