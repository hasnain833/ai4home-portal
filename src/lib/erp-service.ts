import prisma from "@/lib/prisma";

export type ERPPlatform = "BUILTOPIA" | "BUILDERTREND" | "HYPHEN";

export interface ERPConfig {
  apiKey: string;
  secretKey?: string;
  environment: string;
}

/** Fetch credentials from DB for a given company + platform */
export async function getERPConfig(
  companyId: string,
  platform: ERPPlatform
): Promise<ERPConfig | null> {
  const record = await prisma.integration.findFirst({
    where: { companyId, platform, isActive: true },
  });
  if (!record) return null;
  return {
    apiKey: record.apiKey,
    secretKey: record.secretKey || undefined,
    environment: record.environment,
  };
}

// ─── Platform clients ─────────────────────────────────────────────────────────

class BuiltopiaClient {
  private baseUrl: string;
  constructor(private config: ERPConfig) {
    this.baseUrl =
      config.environment === "production"
        ? "https://api.builtopia.com/v1"
        : "https://sandbox-api.builtopia.com/v1";
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/ping`, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
      });
      return res.ok
        ? { ok: true, message: "Connection successful" }
        : { ok: false, message: `HTTP ${res.status}: ${res.statusText}` };
    } catch (e: any) {
      return { ok: false, message: e.message || "Network error" };
    }
  }

  async syncTicket(ticket: any): Promise<{ success: boolean; remoteId: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/tickets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          externalId: ticket.id,
          issueType: ticket.issueType,
          status: ticket.status,
          priority: ticket.priority,
          homeownerEmail: ticket.homeowner?.email,
          createdAt: ticket.createdAt,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return { success: true, remoteId: data.id || `BT-${ticket.id.slice(0, 8)}` };
    } catch (e: any) {
      console.error("[Builtopia] syncTicket failed:", e.message);
      return { success: false, remoteId: "" };
    }
  }
}

class BuildertrendClient {
  private baseUrl: string;
  constructor(private config: ERPConfig) {
    this.baseUrl =
      config.environment === "production"
        ? "https://api.buildertrend.net/v1"
        : "https://sandbox.buildertrend.net/api/v1";
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          ...(this.config.secretKey ? { "X-Secret-Key": this.config.secretKey } : {}),
        },
      });
      return res.ok
        ? { ok: true, message: "Connection successful" }
        : { ok: false, message: `HTTP ${res.status}: ${res.statusText}` };
    } catch (e: any) {
      return { ok: false, message: e.message || "Network error" };
    }
  }

  async syncTicket(ticket: any): Promise<{ success: boolean; remoteId: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/warranty-requests`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          externalRef: ticket.id,
          type: ticket.issueType,
          urgency: ticket.priority,
          homeowner: ticket.homeowner?.email,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return { success: true, remoteId: data.id || `BT2-${ticket.id.slice(0, 8)}` };
    } catch (e: any) {
      console.error("[Buildertrend] syncTicket failed:", e.message);
      return { success: false, remoteId: "" };
    }
  }
}

class HyphenClient {
  private baseUrl: string;
  constructor(private config: ERPConfig) {
    this.baseUrl =
      config.environment === "production"
        ? "https://api.hyphensolutions.com/v2"
        : "https://staging-api.hyphensolutions.com/v2";
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/status`, {
        headers: { "x-api-key": this.config.apiKey },
      });
      return res.ok
        ? { ok: true, message: "Connection successful" }
        : { ok: false, message: `HTTP ${res.status}: ${res.statusText}` };
    } catch (e: any) {
      return { ok: false, message: e.message || "Network error" };
    }
  }

  async syncTicket(ticket: any): Promise<{ success: boolean; remoteId: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/service-requests`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.apiKey,
        },
        body: JSON.stringify({ warrantyRef: ticket.id, issue: ticket.issueType }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return { success: true, remoteId: data.id || `HY-${ticket.id.slice(0, 8)}` };
    } catch (e: any) {
      console.error("[Hyphen] syncTicket failed:", e.message);
      return { success: false, remoteId: "" };
    }
  }
}

// ─── Public helpers ───────────────────────────────────────────────────────────

export async function testERPConnection(
  companyId: string,
  platform: ERPPlatform
): Promise<{ ok: boolean; message: string }> {
  const config = await getERPConfig(companyId, platform);
  if (!config) return { ok: false, message: "No credentials saved for this platform" };

  switch (platform) {
    case "BUILTOPIA":
      return new BuiltopiaClient(config).testConnection();
    case "BUILDERTREND":
      return new BuildertrendClient(config).testConnection();
    case "HYPHEN":
      return new HyphenClient(config).testConnection();
  }
}

export async function syncTicketToERP(ticketId: string): Promise<boolean> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { homeowner: { include: { company: true } } },
  });
  if (!ticket) throw new Error("Ticket not found");

  const companyId = ticket.homeowner?.companyId;
  if (!companyId) return false;

  const platforms: ERPPlatform[] = ["BUILTOPIA", "BUILDERTREND", "HYPHEN"];

  for (const platform of platforms) {
    const config = await getERPConfig(companyId, platform);
    if (!config) continue;

    let result: { success: boolean; remoteId: string };
    switch (platform) {
      case "BUILTOPIA":
        result = await new BuiltopiaClient(config).syncTicket(ticket);
        break;
      case "BUILDERTREND":
        result = await new BuildertrendClient(config).syncTicket(ticket);
        break;
      case "HYPHEN":
        result = await new HyphenClient(config).syncTicket(ticket);
        break;
    }

    if (result.success) {
      await prisma.ticket.update({
        where: { id: ticketId },
        data: { erpSyncStatus: "SYNCED", erpReferenceId: result.remoteId },
      });
      return true;
    }
  }

  return false;
}
