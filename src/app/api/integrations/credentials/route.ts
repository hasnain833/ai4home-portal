import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "@/lib/session";

// GET — fetch all integration credentials for the admin's company (keys are masked)
export async function GET(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session || session.role !== "ADMIN") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
    }

    const integrations = await prisma.integration.findMany({
      where: { companyId: session.companyId },
      select: {
        id: true,
        platform: true,
        environment: true,
        isActive: true,
        updatedAt: true,
        // Mask the keys — never expose raw secrets to the frontend
        apiKey: true,
        secretKey: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    // Mask the keys before sending
    const masked = integrations.map((i) => ({
      ...i,
      apiKey: i.apiKey ? `••••${i.apiKey.slice(-4)}` : null,
      secretKey: i.secretKey ? `••••${i.secretKey.slice(-4)}` : null,
    }));

    return NextResponse.json(masked);
  } catch (error) {
    console.error("[Integrations] GET credentials failed:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// POST — create or update (upsert) integration credentials for a platform
export async function POST(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session || session.role !== "ADMIN") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
    }

    const { platform, apiKey, secretKey, environment } = await request.json();

    if (!platform || !apiKey) {
      return NextResponse.json({ message: "Platform and API Key are required" }, { status: 400 });
    }

    // Upsert: if a record already exists for this company+platform, update it
    const existing = await prisma.integration.findFirst({
      where: { companyId: session.companyId, platform: platform.toUpperCase() },
    });

    let integration;
    if (existing) {
      integration = await prisma.integration.update({
        where: { id: existing.id },
        data: {
          apiKey,
          secretKey: secretKey || null,
          environment: environment || "sandbox",
          isActive: true,
        },
      });
    } else {
      integration = await prisma.integration.create({
        data: {
          companyId: session.companyId,
          platform: platform.toUpperCase(),
          apiKey,
          secretKey: secretKey || null,
          environment: environment || "sandbox",
          isActive: true,
        },
      });
    }

    return NextResponse.json({ success: true, id: integration.id });
  } catch (error) {
    console.error("[Integrations] POST credentials failed:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// DELETE — remove integration credentials
export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session || session.role !== "ADMIN") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
    }

    const { platform } = await request.json();
    if (!platform) {
      return NextResponse.json({ message: "Platform is required" }, { status: 400 });
    }

    await prisma.integration.deleteMany({
      where: { companyId: session.companyId, platform: platform.toUpperCase() },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Integrations] DELETE credentials failed:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
