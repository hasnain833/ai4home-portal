import prisma from "../lib/prisma.js";
import { decryptSafe } from "../lib/crypto.js";

/** Fetch credentials from DB for a given company + platform (decrypted at rest). */
export async function getERPConfig(companyId, platform) {
  const record = await prisma.integration.findFirst({
    where: { companyId, platform, isActive: true },
  });
  if (!record) return null;
  return {
    apiKey: decryptSafe(record.apiKey),
    secretKey: decryptSafe(record.secretKey) || undefined,
    environment: record.environment,
  };
}

// ─── Platform clients ─────────────────────────────────────────────────────────

class BuiltopiaClient {
  constructor(config) {
    this.config = config;
    this.baseUrl =
      config.environment === "production"
        ? "https://api.builtopia.com/v1"
        : "https://sandbox-api.builtopia.com/v1";
  }

  async testConnection() {
    try {
      const res = await fetch(`${this.baseUrl}/ping`, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
      });
      return res.ok
        ? { ok: true, message: "Connection successful" }
        : { ok: false, message: `HTTP ${res.status}: ${res.statusText}` };
    } catch (e) {
      return { ok: false, message: e.message || "Network error" };
    }
  }

  async syncTicket(ticket) {
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
    } catch (e) {
      console.error("[Builtopia] syncTicket failed:", e.message);
      return { success: false, remoteId: "", error: e.message };
    }
  }
}

class BuildertrendClient {
  constructor(config) {
    this.config = config;
    this.baseUrl =
      config.environment === "production"
        ? "https://api.buildertrend.net/v1"
        : "https://sandbox.buildertrend.net/api/v1";
  }

  async testConnection() {
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
    } catch (e) {
      return { ok: false, message: e.message || "Network error" };
    }
  }

  async syncTicket(ticket) {
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
    } catch (e) {
      console.error("[Buildertrend] syncTicket failed:", e.message);
      return { success: false, remoteId: "", error: e.message };
    }
  }
}

class HyphenClient {
  constructor(config) {
    this.config = config;
    this.baseUrl =
      config.environment === "production"
        ? "https://api.hyphensolutions.com/v2"
        : "https://staging-api.hyphensolutions.com/v2";
  }

  async testConnection() {
    try {
      const res = await fetch(`${this.baseUrl}/status`, {
        headers: { "x-api-key": this.config.apiKey },
      });
      return res.ok
        ? { ok: true, message: "Connection successful" }
        : { ok: false, message: `HTTP ${res.status}: ${res.statusText}` };
    } catch (e) {
      return { ok: false, message: e.message || "Network error" };
    }
  }

  async syncTicket(ticket) {
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
    } catch (e) {
      console.error("[Hyphen] syncTicket failed:", e.message);
      return { success: false, remoteId: "", error: e.message };
    }
  }
}

// ─── Public helpers ───────────────────────────────────────────────────────────

export async function testERPConnection(companyId, platform) {
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

// NFR 6.5: failed ERP writes are retried up to 3× with exponential backoff before
// the ticket is marked FAILED and an alert row is written. Idempotent — the remote
// side keys on the ticket id (externalId/externalRef/warrantyRef) so retries and
// re-syncs upsert rather than duplicate.
const MAX_ERP_ATTEMPTS = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClient(platform, config) {
  switch (platform) {
    case "BUILTOPIA":
      return new BuiltopiaClient(config);
    case "BUILDERTREND":
      return new BuildertrendClient(config);
    case "HYPHEN":
      return new HyphenClient(config);
    default:
      return null;
  }
}

async function syncWithRetry(client, ticket, platform) {
  let lastError = "sync failed";
  for (let attempt = 1; attempt <= MAX_ERP_ATTEMPTS; attempt++) {
    const result = await client.syncTicket(ticket);
    if (result.success) return result;
    lastError = result.error || lastError;
    if (attempt < MAX_ERP_ATTEMPTS) {
      const backoff = 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200);
      console.warn(
        `[ERP] ${platform} sync attempt ${attempt}/${MAX_ERP_ATTEMPTS} failed for ticket ${ticket.id} (${lastError}); retrying in ${backoff}ms`,
      );
      await sleep(backoff);
    }
  }
  return { success: false, error: lastError };
}

// Best-effort audit/alert row so persistent ERP failures surface in the KPI
// dashboard (NFR 6.5). Reuses the existing generic SyncLog model — no migration.
async function logErpSync({ companyId, ticketId, platform, status, message }) {
  try {
    await prisma.syncLog.create({
      data: {
        companyId,
        direction: "OUTBOUND",
        action: `ERP_SYNC:${platform}`,
        status,
        recordCount: status === "SUCCESS" ? 1 : 0,
        errorCount: status === "SUCCESS" ? 0 : 1,
        message: message || null,
        metadata: { ticketId },
      },
    });
  } catch (e) {
    console.error("[ERP] Failed to write SyncLog row:", e.message);
  }
}

export async function syncTicketToERP(ticketId, { reason = "manual" } = {}) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { homeowner: { include: { company: true } } },
  });
  if (!ticket) throw new Error("Ticket not found");

  const companyId = ticket.homeowner?.companyId;
  if (!companyId) return false;

  const platforms = ["BUILTOPIA", "BUILDERTREND", "HYPHEN"];
  let anyConfigured = false;

  for (const platform of platforms) {
    const config = await getERPConfig(companyId, platform);
    if (!config) continue;
    anyConfigured = true;

    const client = makeClient(platform, config);
    const result = await syncWithRetry(client, ticket, platform);

    if (result.success) {
      await prisma.ticket.update({
        where: { id: ticketId },
        data: { erpSyncStatus: "SYNCED", erpReferenceId: result.remoteId },
      });
      await logErpSync({ companyId, ticketId, platform, status: "SUCCESS", message: `Synced (${reason})` });
      return true;
    }

    // This platform failed all attempts — record it and try the next one.
    await logErpSync({
      companyId,
      ticketId,
      platform,
      status: "FAILED",
      message: `${reason}: ${result.error}`,
    });
  }

  // Every configured platform failed after retries → mark the ticket so the
  // failure is visible in the dashboard and can be retried.
  if (anyConfigured) {
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { erpSyncStatus: "FAILED" },
    });
  }

  return false;
}
