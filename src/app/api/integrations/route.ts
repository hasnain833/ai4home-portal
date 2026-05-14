import { NextResponse } from "next/server";
import { ERPIntegrationService } from "@/lib/erp-service";

export async function GET() {
  try {
    // Return active integrations for the company
    const stats = await ERPIntegrationService.getActiveIntegration("demo-company");
    return NextResponse.json(stats);
  } catch (error) {
    return NextResponse.json({ message: "Error fetching integrations" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const data = await request.json();
    const { platform, apiKey, secretKey, environment } = data;

    // Here we would securely store these in a separate Integrations table
    // For Phase 1, we simulate the connection test
    console.log(`[Integration] Testing connection to ${platform}...`);
    await new Promise(r => setTimeout(r, 1500));

    return NextResponse.json({ 
      success: true, 
      message: `Successfully connected to ${platform}`,
      status: "CONNECTED"
    });
  } catch (error) {
    return NextResponse.json({ message: "Failed to connect to ERP" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { ticketId } = await request.json();
    const result = await ERPIntegrationService.syncTicketToERP(ticketId);
    return NextResponse.json({ success: result });
  } catch (error) {
    return NextResponse.json({ message: "Sync failed" }, { status: 500 });
  }
}
