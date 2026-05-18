import { NextResponse } from "next/server";
import { syncTicketToERP } from "@/lib/erp-service";
import { getServerSession } from "@/lib/session";

// POST /api/integrations/sync — sync a specific ticket to ERP
export async function POST(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session || !["ADMIN", "STAFF"].includes(session.role)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
    }

    const { ticketId } = await request.json();
    if (!ticketId) {
      return NextResponse.json({ message: "ticketId is required" }, { status: 400 });
    }

    const success = await syncTicketToERP(ticketId);

    return NextResponse.json({
      success,
      message: success ? "Ticket synced to ERP successfully" : "No configured ERP found — add credentials to .env",
    });
  } catch (error: any) {
    console.error("[ERP Sync] failed:", error);
    return NextResponse.json({ message: error.message || "Internal server error" }, { status: 500 });
  }
}
