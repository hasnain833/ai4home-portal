import prisma from "../lib/prisma.js";
import { writeAuditLog } from "../lib/audit.js";
import {
  BUILTIN_NEWS_SOURCES,
  NEWS_DEFAULTS_KEY,
  normalizeNewsSources,
} from "../lib/news-sources.js";
import { decryptDetailed, encryptionKeyStatus, isEncrypted } from "../lib/crypto.js";
import { MailService } from "../services/mail-service.js";
import {
  DEFAULT_PRICING,
  PRICING_SETTING_KEY,
  getPricing,
  invalidatePricingCache,
} from "../lib/usage.js";
import { denyUnlessSuperAdmin } from "../middlewares/auth.js";


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

const MONTHS_BACK = 6;

export const getMessagingSpend = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;

    const since = new Date();
    since.setMonth(since.getMonth() - MONTHS_BACK);
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [byCompany, byChannel, recent, failures, companies, pricing] = await Promise.all([
      prisma.messageUsage.groupBy({
        by: ["companyId", "channel"],
        where: { createdAt: { gte: monthStart } },
        _sum: { units: true, costMicros: true },
      }),
      prisma.messageUsage.groupBy({
        by: ["channel", "outcome"],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
        _sum: { units: true, costMicros: true },
      }),
      prisma.messageUsage.findMany({
        where: { createdAt: { gte: since } },
        select: { channel: true, costMicros: true, units: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 5000,
      }),
      prisma.messageUsage.findMany({
        where: {
          createdAt: { gte: since },
          outcome: { not: "sent" },
        },
        select: {
          id: true,
          companyId: true,
          channel: true,
          provider: true,
          units: true,
          costMicros: true,
          outcome: true,
          source: true,
          recipient: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.company.findMany({ select: { id: true, name: true } }),
      getPricing(),
    ]);

    const nameOf = new Map(companies.map((c) => [c.id, c.name]));

    // Roll the per-channel rows up into one row per tenant for the table.
    const tenants = new Map();
    for (const row of byCompany) {
      const id = row.companyId || "unattributed";
      if (!tenants.has(id)) {
        tenants.set(id, {
          companyId: row.companyId,
          name: nameOf.get(row.companyId) || "Unattributed",
          costMicros: 0,
          channels: {},
        });
      }
      const t = tenants.get(id);
      t.costMicros += row._sum.costMicros || 0;
      t.channels[row.channel] = {
        units: row._sum.units || 0,
        costMicros: row._sum.costMicros || 0,
      };
    }

    // Month-by-month totals for the trend line.
    const monthly = new Map();
    for (const row of recent) {
      const key = `${row.createdAt.getFullYear()}-${String(row.createdAt.getMonth() + 1).padStart(2, "0")}`;
      monthly.set(key, (monthly.get(key) || 0) + (row.costMicros || 0));
    }

    const maskRecipient = (value) => {
      const recipient = String(value || "").trim();
      if (!recipient) return null;
      if (recipient.includes("@")) {
        const [local, domain] = recipient.split("@");
        return `${local.slice(0, 2)}***@${domain}`;
      }
      const digits = recipient.replace(/\D/g, "");
      return digits ? `***${digits.slice(-4)}` : "Hidden";
    };

    return res.json({
      monthToDate: {
        tenants: [...tenants.values()].sort((a, b) => b.costMicros - a.costMicros),
        totalCostMicros: [...tenants.values()].reduce((sum, t) => sum + t.costMicros, 0),
      },
      byChannel: byChannel.map((r) => ({
        channel: r.channel,
        outcome: r.outcome,
        units: r._sum.units || 0,
        costMicros: r._sum.costMicros || 0,
      })),
      monthly: [...monthly.entries()].sort().map(([month, costMicros]) => ({ month, costMicros })),
      pricing,
      emailSender: {
        configured: MailService.hasPlatformSender(),
        sendingAddress: MailService.SENDER_EMAIL,
      },
      failures: {
        categories: byChannel
          .filter((row) => row.outcome !== "sent")
          .map((row) => ({
            key: `${row.channel}:${row.outcome}`,
            channel: row.channel,
            outcome: row.outcome,
            attempts: row._count._all,
            units: row._sum.units || 0,
            costMicros: row._sum.costMicros || 0,
          }))
          .sort((a, b) => b.attempts - a.attempts),
        recent: failures.map((row) => ({
          ...row,
          companyName: nameOf.get(row.companyId) || "Unattributed",
          recipient: maskRecipient(row.recipient),
        })),
      },
    });
  } catch (error) {
    console.error("[Platform getMessagingSpend] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const setMessagingPricing = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;

    const incoming = req.body?.pricing;
    if (!incoming || typeof incoming !== "object") {
      return res.status(400).json({ message: "`pricing` must be an object" });
    }

    // Only known keys are stored, and only as non-negative numbers — a bad rate
    // silently corrupts every cost figure on the dashboard.
    const next = {};
    for (const key of Object.keys(DEFAULT_PRICING)) {
      const value = Number(incoming[key]);
      if (!Number.isFinite(value) || value < 0) {
        return res.status(400).json({ message: `${key} must be a number of 0 or more` });
      }
      next[key] = Math.round(value);
    }

    await prisma.platformSetting.upsert({
      where: { key: PRICING_SETTING_KEY },
      create: { key: PRICING_SETTING_KEY, value: next },
      update: { value: next },
    });
    invalidatePricingCache();

    await writeAuditLog({
      req,
      action: "PLATFORM_MESSAGING_PRICING_CHANGED",
      targetType: "PlatformSetting",
      targetId: PRICING_SETTING_KEY,
      metadata: next,
    });

    return res.json({ pricing: next });
  } catch (error) {
    console.error("[Platform setMessagingPricing] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Support contact shown to builders (Help menu, Communities pages).
export const SUPPORT_CONTACT_KEY = "support.contact";
// Placeholder until the client sends the real line.
export const DEFAULT_SUPPORT_CONTACT = { phone: "(800) 555-0142" };

// Any signed-in user may read this; only super admins edit it.
export const getSupportContact = async (req, res) => {
  try {
    const row = await prisma.platformSetting.findUnique({ where: { key: SUPPORT_CONTACT_KEY } });
    return res.json({ ...DEFAULT_SUPPORT_CONTACT, ...(row?.value || {}) });
  } catch (error) {
    console.error("[Platform getSupportContact] Error:", error);
    return res.json(DEFAULT_SUPPORT_CONTACT);
  }
};

export const updateSupportContact = async (req, res) => {
  try {
    if (denyUnlessSuperAdmin(req, res)) return;
    const phone = String(req.body?.phone || "").trim().slice(0, 40);
    if (!phone) return res.status(400).json({ message: "Phone number is required." });

    const value = { phone };
    await prisma.platformSetting.upsert({
      where: { key: SUPPORT_CONTACT_KEY },
      create: { key: SUPPORT_CONTACT_KEY, value },
      update: { value },
    });
    await writeAuditLog({
      req,
      action: "PLATFORM_SUPPORT_CONTACT_UPDATED",
      targetType: "PlatformSetting",
      targetId: SUPPORT_CONTACT_KEY,
      metadata: value,
    });
    return res.json(value);
  } catch (error) {
    console.error("[Platform updateSupportContact] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
