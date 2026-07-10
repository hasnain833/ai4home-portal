import prisma from "../lib/prisma.js";
import { testERPConnection, syncTicketToERP } from "../services/erp-service.js";
import { calculateWarrantyYear } from "../lib/utils.js";
import { generateTicketId } from "../lib/ticket-utils.js";
import { MessagingService } from "../services/messaging-service.js";
import { writeAuditLog } from "../lib/audit.js";
import { encrypt, decryptSafe } from "../lib/crypto.js";

function isAuthorizedBotpress(req) {
  const secret =
    process.env.BOTPRESS_WEBHOOK_SECRET || process.env.SESSION_SECRET || "";
  if (!secret) {
    console.error(
      "[Botpress] No BOTPRESS_WEBHOOK_SECRET/SESSION_SECRET configured — rejecting webhook.",
    );
    return false;
  }

  const secretParam = req.query.secret;
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers["x-api-key"];

  if (secretParam === secret) return true;
  if (apiKeyHeader === secret) return true;
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (token === secret) return true;
  }

  return false;
}

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

export const botpressTicket = async (req, res) => {
  try {
    if (!isAuthorizedBotpress(req)) {
      return res
        .status(401)
        .json({ message: "Unauthorized integration request" });
    }

    const data = req.body;
    const {
      email,
      propertyId,
      issueType,
      description,
      isEmergency = false,
      priority,
      kbReferences = [],
    } = data;

    if (!email || !issueType || !description) {
      return res.status(400).json({
        message: "email, issueType, and description are required fields",
      });
    }

    // 1. Resolve homeowner
    const homeowner = await prisma.user.findUnique({
      where: { email },
      include: { properties: true },
    });

    if (!homeowner) {
      return res
        .status(404)
        .json({ message: `Homeowner with email ${email} not found` });
    }

    // 2. Resolve property
    let selectedPropertyId = propertyId;
    let warrantyYear = 1;

    if (!selectedPropertyId && homeowner.properties.length > 0) {
      selectedPropertyId = homeowner.properties[0].id;
    }

    if (selectedPropertyId) {
      const property =
        homeowner.properties.find((p) => p.id === selectedPropertyId) ||
        (await prisma.property.findUnique({
          where: { id: selectedPropertyId },
        }));

      if (property && property.coeDate) {
        warrantyYear = calculateWarrantyYear(property.coeDate);
      }
    }

    // 3. Resolve ticket priority & normalize boolean
    const emergencyBool =
      typeof isEmergency === "string"
        ? isEmergency.toLowerCase() === "true"
        : !!isEmergency;

    let ticketPriority = String(priority || "MEDIUM").toUpperCase();
    if (!["LOW", "MEDIUM", "HIGH", "URGENT"].includes(ticketPriority)) {
      ticketPriority = "MEDIUM";
    }

    if (emergencyBool) {
      ticketPriority = "URGENT";
    }

    // 4. Create the Ticket
    const ticketId = await generateTicketId();
    const ticket = await prisma.ticket.create({
      data: {
        id: ticketId,
        issueType,
        description,
        chatSummary: data.chatSummary || data.summary || null,
        extractedInfo: data.extractedInfo
          ? typeof data.extractedInfo === "object"
            ? JSON.stringify(data.extractedInfo)
            : String(data.extractedInfo)
          : data.specificInfo
            ? typeof data.specificInfo === "object"
              ? JSON.stringify(data.specificInfo)
              : String(data.specificInfo)
            : null,
        kbReferences:
          kbReferences && Array.isArray(kbReferences) && kbReferences.length > 0
            ? JSON.stringify(kbReferences)
            : null,
        propertyId: selectedPropertyId || null,
        homeownerId: homeowner.id,
        companyId: homeowner.companyId ?? null,
        isEmergency: emergencyBool,
        priority: ticketPriority,
        warrantyYear,
        erpSyncStatus: "PENDING",
      },
    });

    try {
      await syncTicketToERP(ticket.id, {
        reason: emergencyBool ? "escalation" : "creation",
      });
    } catch (erpError) {
      console.error(
        `[Botpress] ERP sync on ticket creation failed for #${ticket.id}:`,
        erpError.message,
      );
    }

    const portalUrl = process.env.NEXT_PUBLIC_URL;
    const ticketUrl = `${portalUrl}/warranty/tickets/${ticket.id}`;

    console.log(
      `[BOTPRESS INTEGRATION] Ticket #${ticket.id} generated successfully for ${email}`,
    );

    return res.json({
      success: true,
      message: "Ticket created successfully",
      ticketId: ticket.id,
      ticketUrl,
      warrantyYear,
    });
  } catch (error) {
    console.error("Botpress ticket generation error:", error);
    return res
      .status(500)
      .json({ message: "Internal server error during ticket generation" });
  }
};

export const botpressSync = async (req, res) => {
  try {
    // 1. Verify Authentication
    if (!isAuthorizedBotpress(req)) {
      return res
        .status(401)
        .json({ message: "Unauthorized integration request" });
    }

    const body = req.body;
    const {
      ticketId,
      status,
      priority,
      isEmergency,
      draftResponse,
      description,
      chatSummary,
      summary,
      extractedInfo,
      specificInfo,
    } = body;

    if (!ticketId) {
      return res
        .status(400)
        .json({ message: "ticketId is required to perform sync operations" });
    }

    // 2. Resolve Ticket
    let ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      return res.status(404).json({ message: `Ticket not found: ${ticketId}` });
    }

    // 3. Update Ticket fields if specified
    const updatedData = {};
    if (status) updatedData.status = status;
    if (priority) updatedData.priority = priority;
    if (isEmergency !== undefined) {
      updatedData.isEmergency = !!isEmergency;
      if (isEmergency) {
        updatedData.priority = "URGENT";
        updatedData.status = "ESCALATED";
      }
    }
    if (draftResponse !== undefined) {
      updatedData.draftResponse = draftResponse;
    }
    if (description !== undefined) {
      updatedData.description = description;
    }
    const finalSummary = chatSummary || summary;
    if (finalSummary !== undefined) {
      updatedData.chatSummary = finalSummary;
    }
    const finalExtracted = extractedInfo || specificInfo;
    if (finalExtracted !== undefined) {
      updatedData.extractedInfo =
        typeof finalExtracted === "object"
          ? JSON.stringify(finalExtracted)
          : String(finalExtracted);
    }

    if (Object.keys(updatedData).length > 0) {
      const statusChanged =
        updatedData.status && updatedData.status !== ticket.status;

      ticket = await prisma.ticket.update({
        where: { id: ticket.id },
        data: updatedData,
      });

      if (
        statusChanged ||
        ticket.erpSyncStatus === "SYNCED" ||
        updatedData.isEmergency
      ) {
        try {
          const reason =
            ticket.status === "ESCALATED" || updatedData.isEmergency
              ? "escalation"
              : ticket.status === "RESOLVED"
                ? "resolution"
                : "status-change";
          await syncTicketToERP(ticket.id, { reason });
        } catch (erpError) {
          console.error(
            `[Orchestration Sync] Automated ERP sync update failed for Ticket #${ticket.id}:`,
            erpError,
          );
        }
      }

      if (statusChanged) {
        await MessagingService.notifyTicketStatusChange(
          ticket.id,
          ticket.status,
        );
      }
    }

    return res.json({
      success: true,
      ticketId: ticket.id,
      ticketStatus: ticket.status,
      ticketPriority: ticket.priority,
      isEmergency: ticket.isEmergency,
    });
  } catch (error) {
    console.error("[Orchestration Sync] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
