import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const config = await prisma.agentConfig.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(config);
  } catch (error) {
    return NextResponse.json({ message: "Error fetching config" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const data = await request.json();
    const { systemPrompt, greetingMessage, escalationMessage, companyId } = data;

    // Deactivate old configs
    await prisma.agentConfig.updateMany({
      where: { companyId: companyId || "demo-company" },
      data: { isActive: false },
    });

    const config = await prisma.agentConfig.create({
      data: {
        systemPrompt,
        greetingMessage,
        escalationMessage,
        companyId: companyId || "demo-company",
        isActive: true,
        version: "1.0.0", // Real apps would increment this
      },
    });

    return NextResponse.json(config);
  } catch (error) {
    return NextResponse.json({ message: "Error saving config" }, { status: 500 });
  }
}
