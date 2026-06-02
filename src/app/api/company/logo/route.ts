import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "@/lib/session";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(request);
    
    // Both ADMIN and STAFF can upload logos
    if (!session || (session.role !== "STAFF" && session.role !== "ADMIN")) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    
    if (!file) {
      return NextResponse.json({ message: "No file provided" }, { status: 400 });
    }

    const companyId = session.companyId || "demo-company";

    // 1. Initialize Supabase Admin Client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Ensure bucket exists
    const bucketName = "company_logos";
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
    if (!bucketsError) {
      const bucketExists = buckets.some(b => b.name === bucketName);
      if (!bucketExists) {
        await supabase.storage.createBucket(bucketName, { public: true });
      } else {
        await supabase.storage.updateBucket(bucketName, { public: true });
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

    // 5. Save to database
    const company = await prisma.company.update({
      where: { id: companyId },
      data: { logo: url }
    });

    return NextResponse.json({ url });
  } catch (error) {
    console.error("Error uploading logo:", error);
    return NextResponse.json({ message: "Error uploading logo" }, { status: 500 });
  }
}
