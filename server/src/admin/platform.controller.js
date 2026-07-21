import prisma from "../lib/prisma.js";
import { writeAuditLog } from "../lib/audit.js";
import {
  BUILTIN_NEWS_SOURCES,
  NEWS_DEFAULTS_KEY,
  normalizeNewsSources,
} from "../lib/news-sources.js";

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

    // Recent sync failures per tenant, so "healthy" isn't just "last run was OK".
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
      // Stale = no successful run within a generous multiple of its own interval.
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

// ─── News: manage default sources ─────────────────────────────────────────────

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

    // How many tenants actually fall back to these — the number that makes the
    // Platform Admin's edit here meaningful rather than theoretical.
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

    // Same normalizer the per-tenant path uses: http(s) only, deduped, capped.
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

// ─── Leads: support access (audited) ──────────────────────────────────────────

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
