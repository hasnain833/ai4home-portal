import prisma from "../lib/prisma.js";
import { triggerAutomation } from "../lib/automation-events.js";
import {
  snapshotMappings,
  listVersions,
  rollbackToVersion,
} from "../lib/mapping-versions.js";
import {
  SalesforceClient,
  encrypt,
  decrypt,
  seedDefaultMappings,
  getAuthenticatedClient,
  mapSalesforceRecordToLead,
  DEFAULT_FIELD_MAPPINGS,
  generateCodeVerifier,
  codeChallengeFromVerifier,
  filterQueryableFields,
} from "../services/salesforce-service.js";
import { runIncrementalSync } from "../services/salesforce-sync.js";

export const connectSalesforce = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const companyId = req.user.companyId;
    const { clientId, clientSecret, environment } = req.body;

    if (!clientId || !clientSecret) {
      return res
        .status(400)
        .json({ message: "Client ID and Client Secret are required" });
    }

    const env = environment === "production" ? "production" : "sandbox";
    const baseUrl = process.env.NEXT_PUBLIC_URL || "http://localhost:3000";
    const redirectUri = `${baseUrl}/api/sales/salesforce/callback`;
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = codeChallengeFromVerifier(codeVerifier);

    // Encode credentials + companyId into state payload
    const statePayload = JSON.stringify({
      companyId,
      clientId,
      clientSecret: encrypt(clientSecret),
      environment: env,
      codeVerifier: encrypt(codeVerifier),
    });
    const state = Buffer.from(statePayload).toString("base64url");

    const authUrl = SalesforceClient.getAuthorizationUrl({
      clientId,
      redirectUri,
      environment: env,
      state,
      codeChallenge,
    });

    return res.json({ authUrl });
  } catch (error) {
    console.error("[Salesforce Connect] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const salesforceCallback = async (req, res) => {
  try {
    const code = req.query.code;
    const stateParam = req.query.state;
    const error = req.query.error;
    const errorDescription = req.query.error_description;

    const baseUrl = process.env.NEXT_PUBLIC_URL || "http://localhost:3000";

    if (error) {
      console.error(`[Salesforce Callback] OAuth error: ${error} — ${errorDescription}`);
      return res.redirect(
        `${baseUrl}/sales/settings?sf_error=${encodeURIComponent(errorDescription || error)}`
      );
    }

    if (!code || !stateParam) {
      return res.redirect(`${baseUrl}/sales/settings?sf_error=missing_code`);
    }

    let stateData;

    try {
      const decoded = Buffer.from(stateParam, "base64url").toString("utf-8");
      stateData = JSON.parse(decoded);
    } catch {
      return res.redirect(`${baseUrl}/sales/settings?sf_error=invalid_state`);
    }

    const {
      companyId,
      clientId,
      clientSecret: encryptedSecret,
      environment,
      codeVerifier: encryptedVerifier,
    } = stateData;
    const clientSecret = decrypt(encryptedSecret);
    // PKCE: recover the verifier that pairs with the challenge we sent earlier.
    // Older in-flight states (pre-PKCE) simply won't have it.
    const codeVerifier = encryptedVerifier ? decrypt(encryptedVerifier) : undefined;
    const redirectUri = `${baseUrl}/api/sales/salesforce/callback`;

    // Exchange the authorization code for tokens
    const tokenResponse = await SalesforceClient.exchangeCodeForTokens({
      code,
      clientId,
      clientSecret,
      redirectUri,
      environment,
      codeVerifier,
    });

    const tokenExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

    // Upsert the SalesforceConnection record
    await prisma.salesforceConnection.upsert({
      where: { companyId },
      create: {
        companyId,
        instanceUrl: tokenResponse.instance_url,
        accessToken: encrypt(tokenResponse.access_token),
        refreshToken: encrypt(tokenResponse.refresh_token),
        tokenExpiresAt,
        environment,
        clientId,
        clientSecret: encrypt(clientSecret),
        isActive: true,
      },
      update: {
        instanceUrl: tokenResponse.instance_url,
        accessToken: encrypt(tokenResponse.access_token),
        refreshToken: encrypt(tokenResponse.refresh_token),
        tokenExpiresAt,
        environment,
        clientId,
        clientSecret: encrypt(clientSecret),
        isActive: true,
      },
    });

    await seedDefaultMappings(companyId);

    // SW-CRM-004: record the seeded defaults as the baseline version, so the
    // history has a v1 to roll back to rather than starting at the first edit.
    await snapshotMappings(companyId, {
      changeType: "SAVE",
      note: "Seeded default field mappings on connect",
      userId: req.user?.id || null,
    });

    await prisma.syncLog.create({
      data: {
        companyId,
        direction: "INBOUND",
        action: "OAUTH_CONNECT",
        status: "SUCCESS",
        message: `Successfully connected to Salesforce (${environment}) at ${tokenResponse.instance_url}`,
      },
    });

    return res.redirect(`${baseUrl}/sales/settings?connected=true`);
  } catch (err) {
    console.error("[Salesforce Callback] Error:", err);
    const baseUrl = process.env.NEXT_PUBLIC_URL || "http://localhost:3000";
    return res.redirect(
      `${baseUrl}/sales/settings?sf_error=${encodeURIComponent(err.message || "token_exchange_failed")}`
    );
  }
};

export const disconnectSalesforce = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const companyId = req.user.companyId;

    const connection = await prisma.salesforceConnection.findUnique({
      where: { companyId },
    });

    if (!connection) {
      return res.status(404).json({ message: "No Salesforce connection found" });
    }

    await prisma.salesforceConnection.update({
      where: { companyId },
      data: {
        isActive: false,
        accessToken: "",
        refreshToken: "",
      },
    });

    await prisma.syncLog.create({
      data: {
        companyId,
        direction: "INBOUND",
        action: "OAUTH_DISCONNECT",
        status: "SUCCESS",
        message: "Salesforce connection disconnected by admin.",
      },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error("[Salesforce Disconnect] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getSalesforceStatus = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const companyId = req.user.companyId;

    const connection = await prisma.salesforceConnection.findUnique({
      where: { companyId },
      select: {
        id: true,
        instanceUrl: true,
        environment: true,
        syncInterval: true,
        isActive: true,
        lastSyncAt: true,
        lastSyncStatus: true,
        lastSyncMessage: true,
        writeBackEnabled: true,
        lastWriteBackAt: true,
        clientId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!connection) {
      return res.json({
        connected: false,
        environment: null,
        syncInterval: 15,
        lastSyncAt: null,
        lastSyncStatus: null,
        writeBackEnabled: false,
        clientIdMasked: null,
      });
    }

    const syncedLeadCount = await prisma.lead.count({
      where: { companyId, source: "SALESFORCE" },
    });

    return res.json({
      connected: connection.isActive,
      environment: connection.environment,
      instanceUrl: connection.instanceUrl,
      syncInterval: connection.syncInterval,
      lastSyncAt: connection.lastSyncAt,
      lastSyncStatus: connection.lastSyncStatus,
      lastSyncMessage: connection.lastSyncMessage,
      writeBackEnabled: connection.writeBackEnabled,
      lastWriteBackAt: connection.lastWriteBackAt,
      clientIdMasked: connection.clientId
        ? `${connection.clientId.slice(0, 8)}••••${connection.clientId.slice(-4)}`
        : null,
      syncedLeadCount,
      connectedSince: connection.createdAt,
    });
  } catch (error) {
    console.error("[Salesforce Status] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateSalesforceStatus = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const companyId = req.user.companyId;
    const { syncInterval, writeBackEnabled } = req.body;

    const updateData = {};
    if (syncInterval !== undefined) {
      updateData.syncInterval = parseInt(syncInterval, 10);
    }
    // SW-CRM-008: per-tenant outbound write-back toggle (off by default).
    if (writeBackEnabled !== undefined) {
      updateData.writeBackEnabled = !!writeBackEnabled;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    await prisma.salesforceConnection.update({
      where: { companyId },
      data: updateData,
    });

    return res.json({ success: true });
  } catch (error) {
    console.error("[Salesforce Status PATCH] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getMappings = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const companyId = req.user.companyId;

    const mappings = await prisma.salesforceFieldMapping.findMany({
      where: { companyId },
      orderBy: { createdAt: "asc" },
    });

    return res.json(mappings);
  } catch (error) {
    console.error("[Salesforce Mappings] GET Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const saveMapping = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const companyId = req.user.companyId;
    const { salesforceField, portalField, description, isActive, isConsentField } = req.body;

    if (!salesforceField || !portalField) {
      return res
        .status(400)
        .json({ message: "salesforceField and portalField are required" });
    }

    const existing = await prisma.salesforceFieldMapping.findUnique({
      where: { companyId_salesforceField: { companyId, salesforceField } },
      select: { id: true },
    });

    const mapping = await prisma.salesforceFieldMapping.upsert({
      where: {
        companyId_salesforceField: {
          companyId,
          salesforceField,
        },
      },
      create: {
        companyId,
        salesforceField,
        portalField,
        description: description || null,
        isActive: isActive !== undefined ? isActive : true,
        isConsentField: isConsentField || false,
      },
      update: {
        portalField,
        description: description || null,
        isActive: isActive !== undefined ? isActive : true,
        isConsentField: isConsentField || false,
      },
    });

    // SW-CRM-004: record the resulting set as a new version. Never fails the save.
    const version = await snapshotMappings(companyId, {
      changeType: "SAVE",
      note: `${existing ? "Updated" : "Added"} mapping ${salesforceField} → ${portalField}`,
      userId: req.user.id || null,
    });

    return res.json({ ...mapping, version: version?.version ?? null });
  } catch (error) {
    console.error("[Salesforce Mappings] POST Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteMapping = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const companyId = req.user.companyId;
    const { id } = req.body;

    if (!id) {
      return res.status(400).json({ message: "Mapping id is required" });
    }

    const mapping = await prisma.salesforceFieldMapping.findFirst({
      where: { id, companyId },
    });

    if (!mapping) {
      return res.status(404).json({ message: "Mapping not found" });
    }

    await prisma.salesforceFieldMapping.delete({
      where: { id },
    });

    // SW-CRM-004: snapshot after the delete so the version history can restore it.
    const version = await snapshotMappings(companyId, {
      changeType: "DELETE",
      note: `Removed mapping ${mapping.salesforceField} → ${mapping.portalField}`,
      userId: req.user.id || null,
    });

    return res.json({ success: true, version: version?.version ?? null });
  } catch (error) {
    console.error("[Salesforce Mappings] DELETE Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// SW-CRM-004: mapping version history — what changed, when, and by whom.
export const getMappingVersions = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const versions = await listVersions(req.user.companyId, req.query.limit);
    return res.json(versions);
  } catch (error) {
    console.error("[Salesforce Mapping Versions] GET Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// SW-CRM-004: restore a past mapping version. Takes effect on subsequent syncs —
// an in-flight sync already snapshotted its mappings at the start of its run.
export const rollbackMappingVersion = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const { version } = req.body;
    if (version === undefined || version === null || Number.isNaN(Number(version))) {
      return res.status(400).json({ message: "A numeric 'version' is required" });
    }

    const result = await rollbackToVersion(
      req.user.companyId,
      Number(version),
      req.user.id || null,
    );

    if (!result.success) {
      return res.status(404).json({ message: result.reason || "Rollback failed" });
    }

    return res.json({
      success: true,
      ...result,
      message: `Restored mapping version ${result.restoredFrom}. Applies to subsequent syncs.`,
    });
  } catch (error) {
    console.error("[Salesforce Mapping Rollback] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getLogs = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const companyId = req.user.companyId;
    const page = parseInt(req.query.page || "1", 10);
    const limit = Math.min(
      parseInt(req.query.limit || "20", 10),
      50
    );
    const direction = req.query.direction;

    const where = { companyId };
    if (direction && (direction === "INBOUND" || direction === "OUTBOUND")) {
      where.direction = direction;
    }

    const [logs, total] = await Promise.all([
      prisma.syncLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.syncLog.count({ where }),
    ]);

    return res.json({
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("[Salesforce Logs] GET Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const manualSync = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }
    const result = await runIncrementalSync(req.user.companyId);

    if (!result.ok) {
      return res.status(400).json({ message: result.message });
    }

    return res.json({
      success: true,
      totalProcessed: result.totalProcessed,
      createdCount: result.createdCount,
      updatedCount: result.updatedCount,
      archivedCount: result.archivedCount,
      errorCount: result.errorCount,
      status: result.status,
      message: result.message,
    });
  } catch (err) {
    console.error("[Salesforce Sync] Error:", err);
    // Best-effort: record the failure so the UI surfaces it.
    try {
      await prisma.salesforceConnection.update({
        where: { companyId: req.user.companyId },
        data: {
          lastSyncStatus: "ERROR",
          lastSyncMessage: (err.message || "Incremental sync failed").slice(0, 500),
        },
      });
      await prisma.syncLog.create({
        data: {
          companyId: req.user.companyId,
          direction: "INBOUND",
          action: "INCREMENTAL_SYNC",
          status: "ERROR",
          errorCount: 1,
          message: (err.message || "Incremental sync failed").slice(0, 500),
        },
      });
    } catch { /* ignore logging failure */ }
    return res
      .status(500)
      .json({ message: err.message || "Incremental sync failed" });
  }
};

export const bulkImport = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const companyId = req.user.companyId;

    const auth = await getAuthenticatedClient(companyId);
    if (!auth) {
      return res
        .status(400)
        .json({ message: "No active Salesforce connection. Please connect first." });
    }

    const { client, connection } = auth;

    const mappings = await prisma.salesforceFieldMapping.findMany({
      where: { companyId, isActive: true },
    });
    const activeMappings = mappings.length > 0 ? mappings : DEFAULT_FIELD_MAPPINGS.map(m => ({
      ...m, isConsentField: m.isConsentField || false,
    }));

    const sfFields = ["Id", ...activeMappings.map(m => m.salesforceField)];
    const uniqueFields = [...new Set(sfFields)];
    // Drop any mapped fields that don't exist on Lead in this org (e.g.
    // MobilePhone or custom fields) so the query doesn't fail with INVALID_FIELD.
    const { fields: queryableFields, skipped } = await filterQueryableFields(client, "Lead", uniqueFields);
    if (skipped.length) {
      console.warn(`[Salesforce Bulk Import] Skipping fields not present on Lead in this org: ${skipped.join(", ")}`);
    }
    const soql = `SELECT ${queryableFields.join(", ")} FROM Lead`;

    let allRecords = [];
    let usedBulkApi = false;

    try {
      const job = await client.createBulkQueryJob(soql);
      let jobStatus = job;
      const maxAttempts = 30;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        jobStatus = await client.getBulkJobStatus(job.id);
        if (jobStatus.state === "JobComplete") break;
        if (jobStatus.state === "Failed" || jobStatus.state === "Aborted") {
          throw new Error(`Bulk job ${jobStatus.state}`);
        }
      }

      if (jobStatus.state === "JobComplete") {
        const csvResults = await client.getBulkQueryResults(job.id);
        const { parseBulkCSV } = await import("../services/salesforce-service.js");
        allRecords = parseBulkCSV(csvResults);
        usedBulkApi = true;
      } else {
        throw new Error("Bulk job timed out");
      }
    } catch (bulkError) {
      console.warn("[Salesforce Bulk] Falling back to REST API:", bulkError);
      let result = await client.query(soql);
      allRecords = result.records;

      while (!result.done && result.nextRecordsUrl) {
        result = await client.queryMore(result.nextRecordsUrl);
        allRecords.push(...result.records);
      }
    }

    let createdCount = 0;
    let updatedCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const sfRecord of allRecords) {
      try {
        const leadData = mapSalesforceRecordToLead(sfRecord, activeMappings);

        if (!leadData.firstName || !leadData.lastName) {
          errorCount++;
          errors.push(`Missing required fields for SF record ${sfRecord.Id || "unknown"}`);
          continue;
        }

        const externalId = leadData.externalId;
        delete leadData.externalId;

        const existing = externalId
          ? await prisma.lead.findFirst({
              where: { companyId, externalId },
            })
          : null;

        if (existing) {
          await prisma.lead.update({
            where: { id: existing.id },
            data: {
              ...leadData,
              source: "SALESFORCE",
              timeline: {
                create: {
                  type: "SYNC_UPDATE",
                  description: "Lead updated via Salesforce Bulk API import",
                },
              },
            },
          });
          updatedCount++;
        } else {
          const createdSfLead = await prisma.lead.create({
            data: {
              companyId,
              source: "SALESFORCE",
              externalId: externalId || null,
              firstName: leadData.firstName,
              lastName: leadData.lastName,
              email: leadData.email || null,
              phone: leadData.phone || null,
              street: leadData.street || null,
              city: leadData.city || null,
              state: leadData.state || null,
              zipCode: leadData.zipCode || null,
              // Always enter the portal pipeline at "New" -- see salesforce-sync.js.
              status: "New",
              emailOptIn: leadData.emailOptIn ?? false,
              smsOptIn: leadData.smsOptIn ?? false,
              consentSource: leadData.emailOptIn || leadData.smsOptIn ? "Salesforce Sync" : null,
              consentTimestamp: leadData.emailOptIn || leadData.smsOptIn ? new Date() : null,
              customFields: leadData.customFields || null,
              timeline: {
                create: {
                  type: "IMPORT",
                  description: "Lead imported via Salesforce Bulk API sync",
                },
              },
            },
          });
          createdCount++;
          // SW-AMK: newly synced Salesforce leads can trigger automation rules.
          await triggerAutomation({ companyId, leadId: createdSfLead.id, event: "CRM_INGEST", context: { source: "SALESFORCE" } });
        }
      } catch (recordError) {
        errorCount++;
        errors.push(recordError.message || "Unknown error");
      }
    }

    const syncStatus = errorCount > 0 && createdCount + updatedCount > 0 ? "WARNING" : errorCount > 0 ? "ERROR" : "SUCCESS";
    const message = `Bulk sync complete. Created: ${createdCount}, Updated: ${updatedCount}, Errors: ${errorCount}`;

    await prisma.salesforceConnection.update({
      where: { companyId },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: syncStatus,
        lastSyncMessage: message,
      },
    });

    await prisma.syncLog.create({
      data: {
        companyId,
        direction: "INBOUND",
        action: "BULK_IMPORT",
        status: syncStatus,
        recordCount: createdCount + updatedCount,
        errorCount,
        message,
        metadata: errors.length > 0 ? { errors: errors.slice(0, 50) } : undefined,
      },
    });

    return res.json({
      success: true,
      totalProcessed: allRecords.length,
      createdCount,
      updatedCount,
      errorCount,
      status: syncStatus,
      message,
    });
  } catch (err) {
    console.error("[Salesforce Bulk Import] Error:", err);
    return res.status(500).json({ message: err.message || "Bulk import failed" });
  }
};
