import prisma from "../lib/prisma.js";
import { writeAuditLog } from "../lib/audit.js";
import {
  BUILTIN_NEWS_SOURCES,
  NEWS_DEFAULTS_KEY,
  normalizeNewsSources,
} from "../lib/news-sources.js";
import { decryptDetailed, encryptionKeyStatus, isEncrypted } from "../lib/crypto.js";
import {
  PLATFORM_AI_PROVIDERS,
  TENANT_AI_PROVIDERS,
  getPlatformAiKeyStatus,
  savePlatformAiKey,
  invalidateAiConfigCache,
} from "../lib/ai-config.js";

function denyUnlessSuperAdmin(req, res) {
  if (!req.user?.isSuperAdmin) {
    res.status(403).json({ message: "Unauthorized" });
    return true;
  }
  return false;
}

const SYNC_WINDOW_HOURS = 24;
export const getCrmHealth = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;

    const connections = await prisma.salesforceConnection.findMany({
      select: {
        companyId: true,
        instanceUrl: true,
        environment: true,
        isActive: true,
        syncInterval: true,
        lastSyncAt: true,
        lastSyncStatus: true,
        lastSyncMessage: true,
        writeBackEnabled: true,
        lastWriteBackAt: true,
        tokenExpiresAt: true,
        company: { select: { id: true, name: true, salesEnabled: true } },
      },
    });

    const since = new Date(Date.now() - SYNC_WINDOW_HOURS * 60 * 60 * 1000);
    const recentLogs = await prisma.syncLog.groupBy({
      by: ["companyId", "status"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { errorCount: true, recordCount: true },
    });

    const byCompany = new Map();
    for (const log of recentLogs) {
      const entry = byCompany.get(log.companyId) || {
        runs: 0,
        failures: 0,
        errors: 0,
        records: 0,
      };
      entry.runs += log._count._all;
      if (String(log.status).toUpperCase() !== "SUCCESS")
        entry.failures += log._count._all;
      entry.errors += log._sum.errorCount || 0;
      entry.records += log._sum.recordCount || 0;
      byCompany.set(log.companyId, entry);
    }

    const now = Date.now();
    const payload = connections.map((c) => {
      const recent = byCompany.get(c.companyId) || {
        runs: 0,
        failures: 0,
        errors: 0,
        records: 0,
      };
      const tokenExpired =
        !!c.tokenExpiresAt && c.tokenExpiresAt.getTime() < now;
      const staleAfterMs = Math.max(c.syncInterval || 15, 15) * 60 * 1000 * 4;
      const stale =
        !c.lastSyncAt || now - c.lastSyncAt.getTime() > staleAfterMs;

      let health = "HEALTHY";
      if (!c.isActive) health = "DISABLED";
      else if (
        tokenExpired ||
        String(c.lastSyncStatus || "").toUpperCase() === "FAILED"
      )
        health = "FAILING";
      else if (stale || recent.failures > 0) health = "DEGRADED";

      return {
        companyId: c.companyId,
        companyName: c.company?.name || "—",
        salesEnabled: c.company?.salesEnabled ?? false,
        environment: c.environment,
        instanceHost: safeHost(c.instanceUrl),
        isActive: c.isActive,
        writeBackEnabled: c.writeBackEnabled,
        syncInterval: c.syncInterval,
        lastSyncAt: c.lastSyncAt,
        lastSyncStatus: c.lastSyncStatus,
        lastSyncMessage: c.lastSyncMessage,
        lastWriteBackAt: c.lastWriteBackAt,
        tokenExpired,
        stale,
        health,
        recent: { ...recent, windowHours: SYNC_WINDOW_HOURS },
      };
    });

    const rank = { FAILING: 0, DEGRADED: 1, DISABLED: 2, HEALTHY: 3 };
    payload.sort(
      (a, b) =>
        rank[a.health] - rank[b.health] ||
        a.companyName.localeCompare(b.companyName),
    );

    return res.json({
      connections: payload,
      summary: payload.reduce(
        (acc, c) => ({ ...acc, [c.health]: (acc[c.health] || 0) + 1 }),
        { total: payload.length },
      ),
    });
  } catch (error) {
    console.error("[Platform getCrmHealth] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}


export const getDefaultNewsSources = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;
    if (!prisma.platformSetting) {
      return res.status(503).json({
        message:
          "PlatformSetting table is not available yet. Run `npx prisma db push`.",
      });
    }

    const row = await prisma.platformSetting.findUnique({
      where: { key: NEWS_DEFAULTS_KEY },
    });
    const saved = normalizeNewsSources(row?.value);

    const companies = await prisma.company.findMany({
      select: { newsSources: true },
    });
    const inheriting = companies.filter(
      (c) =>
        normalizeNewsSources(c.newsSources).filter((s) => s.enabled).length ===
        0,
    ).length;

    return res.json({
      sources: saved.length ? saved : BUILTIN_NEWS_SOURCES,
      isCustomized: saved.length > 0,
      builtin: BUILTIN_NEWS_SOURCES,
      updatedAt: row?.updatedAt || null,
      inheritingCompanies: inheriting,
      totalCompanies: companies.length,
    });
  } catch (error) {
    console.error("[Platform getDefaultNewsSources] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateDefaultNewsSources = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;
    if (!prisma.platformSetting) {
      return res.status(503).json({
        message:
          "PlatformSetting table is not available yet. Run `npx prisma db push`.",
      });
    }

    const { sources } = req.body;
    if (!Array.isArray(sources)) {
      return res.status(400).json({ message: "`sources` must be an array" });
    }

    const normalized = normalizeNewsSources(sources);
    if (sources.length > 0 && normalized.length === 0) {
      return res
        .status(400)
        .json({ message: "No valid sources — each needs a http(s) URL." });
    }

    const row = await prisma.platformSetting.upsert({
      where: { key: NEWS_DEFAULTS_KEY },
      create: { key: NEWS_DEFAULTS_KEY, value: normalized },
      update: { value: normalized },
    });

    await writeAuditLog({
      req,
      action: "PLATFORM_NEWS_DEFAULTS_UPDATED",
      targetType: "PlatformSetting",
      targetId: NEWS_DEFAULTS_KEY,
      metadata: {
        count: normalized.length,
        urls: normalized.map((s) => s.url),
      },
    });

    return res.json({
      sources: normalized,
      isCustomized: normalized.length > 0,
      updatedAt: row.updatedAt,
    });
  } catch (error) {
    console.error("[Platform updateDefaultNewsSources] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};


export const getAiKeySettings = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;
    if (!prisma.platformSetting) {
      return res.status(503).json({
        message:
          "PlatformSetting table is not available yet. Run `npx prisma db push`.",
      });
    }

    const [platformKeys, companies, aiIntegrations] = await Promise.all([
      getPlatformAiKeyStatus(),
      prisma.company.findMany({
        select: { id: true, name: true, aiPlatformGrant: true },
        orderBy: { name: "asc" },
      }),
      prisma.integration.findMany({
        where: { isActive: true, platform: { in: TENANT_AI_PROVIDERS } },
        select: { companyId: true, platform: true, apiKey: true },
      }),
    ]);

    const ownKeyByCompany = new Map();
    for (const row of aiIntegrations) {
      if (row.apiKey && !ownKeyByCompany.has(row.companyId)) {
        ownKeyByCompany.set(row.companyId, row.platform);
      }
    }

    return res.json({
      providers: PLATFORM_AI_PROVIDERS,
      platformKeys,
      companies: companies.map((c) => ({
        id: c.id,
        name: c.name,
        grant: c.aiPlatformGrant || null,
        ownKeyProvider: ownKeyByCompany.get(c.id) || null,
      })),
    });
  } catch (error) {
    console.error("[Platform getAiKeySettings] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updatePlatformAiKey = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;

    const { provider, apiKey } = req.body || {};
    if (!PLATFORM_AI_PROVIDERS.includes(provider)) {
      return res.status(400).json({
        message: `provider must be one of: ${PLATFORM_AI_PROVIDERS.join(", ")}`,
      });
    }

    const result = await savePlatformAiKey(provider, apiKey);

    await writeAuditLog({
      req,
      action: result.configured
        ? "PLATFORM_AI_KEY_SET"
        : "PLATFORM_AI_KEY_CLEARED",
      targetType: "PlatformSetting",
      targetId: `ai.platformKeys:${provider}`,
      metadata: { provider },
    });

    return res.json({ ...result, platformKeys: await getPlatformAiKeyStatus() });
  } catch (error) {
    console.error("[Platform updatePlatformAiKey] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** Grant or revoke one tenant's access to a platform AI key. */
export const updateCompanyAiGrant = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;

    const { companyId } = req.params;
    const raw = req.body?.grant;
    // null / "" / "NONE" all mean "revoke".
    const grant =
      raw === null || raw === undefined || raw === "" || raw === "NONE"
        ? null
        : String(raw).toUpperCase();

    if (grant !== null && !PLATFORM_AI_PROVIDERS.includes(grant)) {
      return res.status(400).json({
        message: `grant must be null or one of: ${PLATFORM_AI_PROVIDERS.join(", ")}`,
      });
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true },
    });
    if (!company) return res.status(404).json({ message: "Company not found" });

    await prisma.company.update({
      where: { id: companyId },
      data: { aiPlatformGrant: grant },
    });
    invalidateAiConfigCache(companyId);

    await writeAuditLog({
      req,
      action: grant ? "COMPANY_AI_GRANT_SET" : "COMPANY_AI_GRANT_REVOKED",
      targetType: "Company",
      targetId: companyId,
      metadata: { companyName: company.name, grant },
    });

    return res.json({ companyId, grant });
  } catch (error) {
    console.error("[Platform updateCompanyAiGrant] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};


const SUPPORT_LEAD_LIMIT = 100;

export const getSupportLeads = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;

    const { companyId } = req.params;
    const search = String(req.query.search ?? "");
    const reason = String(req.query.reason ?? "");

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true },
    });
    if (!company) return res.status(404).json({ message: "Company not found" });

    const where = { companyId, archived: false };
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
      ];
    }

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          status: true,
          source: true,
          createdAt: true,
          owner: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
        take: SUPPORT_LEAD_LIMIT,
      }),
      prisma.lead.count({ where }),
    ]);

    await writeAuditLog({
      req,
      action: "SUPPORT_LEAD_ACCESS",
      companyId,
      targetType: "Company",
      targetId: companyId,
      metadata: {
        companyName: company.name,
        returned: leads.length,
        matched: total,
        search: search || null,
        reason: reason.slice(0, 500) || null,
      },
    });

    return res.json({
      company,
      leads,
      total,
      truncated: total > leads.length,
      limit: SUPPORT_LEAD_LIMIT,
    });
  } catch (error) {
    console.error("[Platform getSupportLeads] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getSupportAccessLog = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;
    if (!prisma.auditLog) {
      return res.status(503).json({
        message:
          "AuditLog table is not available yet. Run `npx prisma db push`.",
      });
    }

    const companyId = req.query.companyId ? String(req.query.companyId) : "";
    const entries = await prisma.auditLog.findMany({
      where: {
        action: "SUPPORT_LEAD_ACCESS",
        ...(companyId ? { companyId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return res.json(entries);
  } catch (error) {
    console.error("[Platform getSupportAccessLog] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const SECRET_COLUMNS = [
  { model: "integration", label: "ERP / SMTP / SMS credentials", fields: ["apiKey", "secretKey"] },
  {
    model: "salesforceConnection",
    label: "Salesforce OAuth",
    fields: ["accessToken", "refreshToken", "clientSecret"],
  },
  { model: "calendarConnection", label: "Google Calendar OAuth", fields: ["accessToken", "refreshToken"] },
];

export const getSecurityPosture = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;

    const breakdown = [];
    let plaintext = 0;
    let stale = 0;
    let unreadable = 0;
    let current = 0;

    for (const target of SECRET_COLUMNS) {
      const delegate = prisma[target.model];
      if (!delegate) continue;

      const select = { id: true };
      for (const f of target.fields) select[f] = true;
      const rows = await delegate.findMany({ select });

      const counts = { label: target.label, plaintext: 0, stale: 0, unreadable: 0, current: 0 };
      for (const row of rows) {
        for (const field of target.fields) {
          const value = row[field];
          if (value == null || value === "") continue;
          if (!isEncrypted(value)) {
            counts.plaintext++;
            continue;
          }
          const detail = decryptDetailed(value);
          if (detail.failed) counts.unreadable++;
          else if (detail.stale) counts.stale++;
          else counts.current++;
        }
      }

      plaintext += counts.plaintext;
      stale += counts.stale;
      unreadable += counts.unreadable;
      current += counts.current;
      breakdown.push(counts);
    }

    const needsRotation = plaintext + stale;

    return res.json({
      encryptionKey: encryptionKeyStatus(),
      secrets: { current, plaintext, stale, unreadable, needsRotation, breakdown },
      remediation: needsRotation
        ? "Run `npm run rotate-keys` in server/ to re-encrypt these under the current key."
        : null,
    });
  } catch (error) {
    console.error("[Platform getSecurityPosture] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
