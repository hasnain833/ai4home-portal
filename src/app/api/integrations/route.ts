import { NextResponse } from "next/server";
import { testERPConnection, ERPPlatform } from "@/lib/erp-service";
import { getServerSession } from "@/lib/session";
import prisma from "@/lib/prisma";

// GET /api/integrations — list all platforms, showing which ones have saved credentials
export async function GET(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session || session.role !== "ADMIN") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
    }

    const platforms: ERPPlatform[] = ["BUILTOPIA", "BUILDERTREND", "HYPHEN"];
    const saved = await prisma.integration.findMany({
      where: { companyId: session.companyId },
      select: { platform: true, environment: true, isActive: true, apiKey: true, updatedAt: true },
    });

    const result = platforms.map((p) => {
      const record = saved.find((s) => s.platform === p);
      return {
        platform: p,
        configured: !!record,
        environment: record?.environment ?? null,
        apiKeyMasked: record?.apiKey ? `••••${record.apiKey.slice(-4)}` : null,
        isActive: record?.isActive ?? false,
        lastUpdated: record?.updatedAt ?? null,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[Integrations] GET failed:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// POST /api/integrations — test the live connection for a platform
export async function POST(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session || session.role !== "ADMIN") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
    }

    const { platform } = await request.json();
    if (!platform) {
      return NextResponse.json({ message: "Platform is required" }, { status: 400 });
    }

    const result = await testERPConnection(session.companyId, platform.toUpperCase() as ERPPlatform);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[Integrations] Test connection failed:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
