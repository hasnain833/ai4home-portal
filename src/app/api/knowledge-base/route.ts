import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const docs = await prisma.knowledgeBaseDocument.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(docs);
  } catch (error) {
    return NextResponse.json({ message: "Error fetching documents" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const data = await request.json();
    const { name, size, url, companyId } = data;

    const doc = await prisma.knowledgeBaseDocument.create({
      data: {
        name,
        size,
        url,
        companyId: companyId || "demo-company",
        isIndexed: false,
      },
    });

    return NextResponse.json(doc);
  } catch (error) {
    return NextResponse.json({ message: "Error creating document" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) return NextResponse.json({ message: "ID required" }, { status: 400 });

    await prisma.knowledgeBaseDocument.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ message: "Error deleting document" }, { status: 500 });
  }
}
