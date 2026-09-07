import prisma from "../lib/prisma.js";
import { testERPConnection, syncTicketToERP } from "../services/erp-service.js";
import { writeAuditLog } from "../lib/audit.js";
import { encrypt, decryptSafe } from "../lib/crypto.js";


export const getIntegrations = async (req, res) => {
  try {
    const session = req.user;
    if (!session || session.role !== "ADMIN") {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const platforms = ["BUILTOPIA", "BUILDERTREND", "HYPHEN"];
    const saved = await prisma.integration.findMany({
      where: { companyId: session.companyId || "demo-company" },
      select: {
        platform: true,
        environment: true,
        isActive: true,
        apiKey: true,
        updatedAt: true,
      },
    });

    const result = platforms.map((p) => {
      const record = saved.find((s) => s.platform === p);
      const apiKey = decryptSafe(record?.apiKey);
      return {
        platform: p,
        configured: !!record,
        environment: record?.environment ?? null,
        apiKeyMasked: apiKey ? `••••${apiKey.slice(-4)}` : null,
        isActive: record?.isActive ?? false,
        lastUpdated: record?.updatedAt ?? null,
      };
    });

    return res.json(result);
  } catch (error) {
    console.error("[Integrations] GET failed:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const testIntegration = async (req, res) => {
  try {
    const session = req.user;
    if (!session || session.role !== "ADMIN") {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const { platform } = req.body;
    if (!platform) {
      return res.status(400).json({ message: "Platform is required" });
    }

    const result = await testERPConnection(
      session.companyId || "demo-company",
      platform.toUpperCase(),
    );
    return res.json(result);
  } catch (error) {
    console.error("[Integrations] Test connection failed:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getCredentials = async (req, res) => {
  try {
    const session = req.user;
    if (!session || session.role !== "ADMIN") {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const integrations = await prisma.integration.findMany({
      where: { companyId: session.companyId || "demo-company" },
      select: {
        id: true,
        platform: true,
        environment: true,
        isActive: true,
        updatedAt: true,
        apiKey: true,
        secretKey: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    // Mask the keys before sending (decrypt first so the last-4 is meaningful)
    const masked = integrations.map((i) => {
      const apiKey = decryptSafe(i.apiKey);
      const secretKey = decryptSafe(i.secretKey);
      return {
        ...i,
        apiKey: apiKey ? `••••${apiKey.slice(-4)}` : null,
        secretKey: secretKey ? `••••${secretKey.slice(-4)}` : null,
      };
    });

    return res.json(masked);
  } catch (error) {
    console.error("[Integrations] GET credentials failed:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const saveCredentials = async (req, res) => {
  try {
    const session = req.user;
    if (!session || session.role !== "ADMIN") {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const { platform, apiKey, secretKey, environment } = req.body;

    if (!platform || !apiKey) {
      return res
        .status(400)
        .json({ message: "Platform and API Key are required" });
    }

    // Upsert: if a record already exists for this company+platform, update it
    const existing = await prisma.integration.findFirst({
      where: {
        companyId: session.companyId || "demo-company",
        platform: platform.toUpperCase(),
      },
    });

    // Encrypt secrets at rest (NFR 6.3). Reads go through decryptSafe().
    const encApiKey = encrypt(apiKey);
    const encSecretKey = secretKey ? encrypt(secretKey) : null;

    let integration;
    if (existing) {
      integration = await prisma.integration.update({
        where: { id: existing.id },
        data: {
          apiKey: encApiKey,
          secretKey: encSecretKey,
          environment: environment || "sandbox",
          isActive: true,
        },
      });
    } else {
      integration = await prisma.integration.create({
        data: {
          companyId: session.companyId || "demo-company",
          platform: platform.toUpperCase(),
          apiKey: encApiKey,
          secretKey: encSecretKey,
          environment: environment || "sandbox",
          isActive: true,
        },
      });
    }

    await writeAuditLog({
      req,
      action: existing ? "ERP_RECONNECT" : "ERP_CONNECT",
      companyId: session.companyId,
      targetType: "Integration",
      targetId: integration.id,
      metadata: {
        platform: platform.toUpperCase(),
        environment: environment || "sandbox",
      },
    });

    return res.json({ success: true, id: integration.id });
  } catch (error) {
    console.error("[Integrations] POST credentials failed:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteCredentials = async (req, res) => {
  try {
    const session = req.user;
    if (!session || session.role !== "ADMIN") {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const { platform } = req.body;
    if (!platform) {
      return res.status(400).json({ message: "Platform is required" });
    }

    await prisma.integration.deleteMany({
      where: {
        companyId: session.companyId || "demo-company",
        platform: platform.toUpperCase(),
      },
    });

    await writeAuditLog({
      req,
      action: "ERP_DISCONNECT",
      companyId: session.companyId,
      targetType: "Integration",
      metadata: { platform: platform.toUpperCase() },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error("[Integrations] DELETE credentials failed:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const syncIntegration = async (req, res) => {
  try {
    const session = req.user;
    if (!session || !["ADMIN", "STAFF"].includes(session.role)) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const { ticketId } = req.body;
    if (!ticketId) {
      return res.status(400).json({ message: "ticketId is required" });
    }

    const success = await syncTicketToERP(ticketId);

    return res.json({
      success,
      message: success
        ? "Ticket synced to ERP successfully"
        : "ERP sync did not complete — check that a platform is connected in Integrations settings and review the sync failure log.",
    });
  } catch (error) {
    console.error("[ERP Sync] failed:", error);
    return res
      .status(500)
      .json({ message: error.message || "Internal server error" });
  }
};
