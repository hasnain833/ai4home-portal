import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "@/lib/session";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // Homeowners only fetch the active config for their specific company
    const configs = await prisma.agentConfig.findMany({
      where: {
        companyId: session.companyId || "demo-company",
        ...(session.role === "HOMEOWNER" ? { isActive: true } : {})
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(configs);
  } catch (error) {
    console.error("Error fetching agent config:", error);
    return NextResponse.json({ message: "Error fetching config" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
    }

    const data = await request.json();
    const { systemPrompt, greetingMessage, escalationMessage } = data;
    const companyId = session.companyId || "demo-company";

    // Deactivate old configs for this company
    await prisma.agentConfig.updateMany({
      where: { companyId },
      data: { isActive: false },
    });

    const config = await prisma.agentConfig.create({
      data: {
        systemPrompt,
        greetingMessage,
        escalationMessage,
        companyId,
        isActive: true,
        version: "1.0.0", // Real apps would increment this
      },
    });

    return NextResponse.json(config);
  } catch (error) {
    console.error("Error saving agent config:", error);
    return NextResponse.json({ message: "Error saving config" }, { status: 500 });
  }
}

