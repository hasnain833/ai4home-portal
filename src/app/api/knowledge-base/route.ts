import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "@/lib/session";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
    }

    const docs = await prisma.knowledgeBaseDocument.findMany({
      where: { companyId: session.companyId || "demo-company" },
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
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
    }

    const data = await request.json();
    const { name, size, url } = data;
    const companyId = session.companyId || "demo-company";

    const doc = await prisma.knowledgeBaseDocument.create({
      data: {
        name,
        size,
        url,
        companyId,
      },
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
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
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

