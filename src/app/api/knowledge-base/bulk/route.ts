import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "@/lib/session";
import AdmZip from "adm-zip";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session || (session.role !== "STAFF" && session.role !== "ADMIN")) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ message: "No file provided" }, { status: 400 });
    }

    const companyId = session.companyId || "demo-company";
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Parse ZIP
    const zip = new AdmZip(buffer);
    const zipEntries = zip.getEntries();

    const createdCommunities = new Map<string, string>(); // name -> id
    let docsCount = 0;

    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;
      
      const parts = entry.entryName.split("/");
      if (parts.length < 2) continue; // Skip files in root or unrecognized formats

      const communityName = parts[0];
      const fileName = parts[parts.length - 1];
      
      // Ignore hidden files like .DS_Store
      if (fileName.startsWith(".")) continue;

      let communityId = createdCommunities.get(communityName);
      if (!communityId) {
        // Find or create community
        let dbCommunity = await prisma.community.findFirst({
          where: { name: communityName, companyId }
        });
        
        if (!dbCommunity) {
          // Generate a random dark color
          const colors = ["#0F3B3D", "#1A365D", "#4A044E", "#3F6212", "#7F1D1D"];
          const color = colors[Math.floor(Math.random() * colors.length)];
          
          dbCommunity = await prisma.community.create({
            data: { name: communityName, color, companyId }
          });
        }
        communityId = dbCommunity.id;
        createdCommunities.set(communityName, communityId);
      }

      // Record document
      // Note: We are simulating storage by just saving the filename. 
      // In a real app, you would upload entry.getData() to Supabase/S3 here.
      await prisma.knowledgeBaseDocument.create({
        data: {
          name: fileName,
          size: `${(entry.header.size / 1024).toFixed(1)} KB`,
          url: `/simulated-storage/${companyId}/${communityName}/${fileName}`,
          companyId,
          communityId,
        }
      });
      docsCount++;
    }

    return NextResponse.json({ 
      success: true, 
      communitiesCreated: createdCommunities.size,
      documentsImported: docsCount 
    });

  } catch (error) {
    console.error("Error processing bulk zip:", error);
    return NextResponse.json({ message: "Error processing bulk zip" }, { status: 500 });
  }
}
