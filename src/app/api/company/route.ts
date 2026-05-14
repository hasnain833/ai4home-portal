import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    // For now, we fetch the first company as a demo
    const company = await prisma.company.findFirst();
    return NextResponse.json(company);
  } catch (error) {
    return NextResponse.json({ message: "Error fetching company" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const data = await request.json();
    const { id, ...updateData } = data;

    const company = await prisma.company.update({
      where: { id: id || "demo-company" },
      data: updateData,
    });

    return NextResponse.json(company);
  } catch (error) {
    return NextResponse.json({ message: "Error updating company" }, { status: 500 });
  }
}
