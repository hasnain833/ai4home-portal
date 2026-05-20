import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "@/lib/session";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const company = await prisma.company.findUnique({
      where: { id: session.companyId || "demo-company" }
    });

    return NextResponse.json(company);
  } catch (error) {
    console.error("Error fetching company details:", error);
    return NextResponse.json({ message: "Error fetching company" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session || session.role !== "ADMIN") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
    }

    const data = await request.json();
    const { id, ...updateData } = data;
    const companyId = session.companyId || "demo-company";

    const company = await prisma.company.update({
      where: { id: companyId },
      data: updateData,
    });

    return NextResponse.json(company);
  } catch (error) {
    console.error("Error updating company details:", error);
    return NextResponse.json({ message: "Error updating company" }, { status: 500 });
  }
}

