import prisma from "@/lib/prisma";

export type ERPType = "BUILTOPIA" | "BUILDERTREND" | "HYPHEN";

export interface ERPClient {
  syncTicket(ticketId: string): Promise<boolean>;
  testConnection(): Promise<boolean>;
}

export class ERPIntegrationService {
  static async getActiveIntegration(companyId: string) {
    // In a full implementation, we'd have a table for ERP credentials
    // For Phase 1, we'll use a simplified check or mock for these specific platforms
    return {
      type: "BUILTOPIA",
      status: "CONNECTED",
      lastSync: new Date(),
    };
  }

  static async syncTicketToERP(ticketId: string) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { homeowner: true },
    });

    if (!ticket) throw new Error("Ticket not found");

    console.log(`[ERP Sync] Sending ticket ${ticketId} to ERP...`);
    
    // Simulate API call to Builtopia/Buildertrend
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Update sync status in DB
    // (We should add an erpSyncStatus field to the Ticket model later)
    
    return true;
  }
}
