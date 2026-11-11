import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { runIncrementalSync } from "../../services/salesforce-sync.js";
import { runSyncPhase, shortError, SYNC_PHASES } from "../../services/b2b-salesforce-sync.js";
import {
  PLATFORM_SYNC_LOG_ID,
  platformSalesforceConnection,
  platformSalesforceSettings,
  platformSalesforceSyncState,
  savePlatformSalesforceSyncState,
} from "../../lib/platform-salesforce.js";

export const salesforceSyncCron = inngest.createFunction(
  {
    id: "salesforce-incremental-sync-cron",
    triggers: [{ cron: "*/15 * * * *" }],
  },
  async ({ step }) => {
    const connections = await step.run("load-active-connections", () =>
      prisma.salesforceConnection.findMany({
        where: { isActive: true },
        select: { companyId: true, syncInterval: true, lastSyncAt: true },
      }),
    );

    const now = Date.now();
    const due = connections.filter((c) => {
      const intervalMs = Math.max(1, c.syncInterval || 15) * 60 * 1000;
      return !c.lastSyncAt || now - new Date(c.lastSyncAt).getTime() >= intervalMs;
    });

    const results = [];
    for (const c of due) {
      const r = await step.run(`sync-${c.companyId}`, async () => {
        try {
          return await runIncrementalSync(c.companyId);
        } catch (e) {
          return { ok: false, message: e?.message || String(e) };
        }
      });
      results.push({ companyId: c.companyId, ...r });
    }

    return { activeConnections: connections.length, due: due.length, results };
  },
);

// ---------- AI4Home's own org: Business Leads, meetings and conversations ----------

const PLATFORM_SYNC_EVENT = "platform.salesforce.sync";
const MAX_BATCHES = 10;

export const requestPlatformSalesforceSync = () => inngest.send({ name: PLATFORM_SYNC_EVENT, data: {} });

export const platformSalesforceSync = inngest.createFunction(
  {
    id: "platform-salesforce-sync",
    // The cron and "Sync now" must never overlap: both would send the same changes.
    concurrency: [{ limit: 1 }],
    retries: 0,
    triggers: [{ cron: "*/5 * * * *" }, { event: PLATFORM_SYNC_EVENT }],
  },
  async ({ step }) => {
    const ready = await step.run("check", async () => {
      const [settings, conn] = await Promise.all([platformSalesforceSettings(), platformSalesforceConnection()]);
      return !!(settings.enabled && conn && !conn.error);
    });
    if (!ready) return { skipped: "Salesforce sync is off or not connected" };

    const totals = { created: 0, updated: 0, deletedHere: 0, cancelledHere: 0, deletes: 0, leads: 0, meetings: 0, messages: 0 };
    const errors = [];
    let stopped = null;
    for (const phase of SYNC_PHASES) {
      for (let i = 0; i < MAX_BATCHES && !stopped; i++) {
        const r = await step.run(`${phase}-${i}`, async () => {
          try {
            return await runSyncPhase(phase);
          } catch (e) {
            return { fatal: shortError(e) };
          }
        });
        if (r.fatal) {
          stopped = r.fatal;
          break;
        }
        totals.created += r.created || 0;
        totals.updated += r.updated || 0;
        totals.deletedHere += r.deleted || 0;
        totals.cancelledHere += r.cancelled || 0;
        if (phase in totals) totals[phase] += r.pushed || 0;
        errors.push(...(r.errors || []));
        if (!r.more) break;
      }
    }

    return step.run("record", async () => {
      const status = stopped ? "ERROR" : errors.length ? "WARNING" : "SUCCESS";
      const message = stopped
        ? `Stopped: ${stopped}`
        : `From Salesforce: ${totals.created} new, ${totals.updated} updated, ${totals.deletedHere} deleted, ${totals.cancelledHere} meetings cancelled. To Salesforce: ${totals.leads} leads, ${totals.meetings} meetings, ${totals.messages} messages, ${totals.deletes} deleted.`;
      const state = await platformSalesforceSyncState();
      const lastRun = { at: new Date().toISOString(), status, message, totals, errors: errors.slice(0, 30) };
      await savePlatformSalesforceSyncState({ ...state, lastRun });
      await prisma.syncLog.create({
        data: {
          companyId: PLATFORM_SYNC_LOG_ID,
          direction: "BOTH",
          action: "B2B_SYNC",
          status,
          recordCount: Object.values(totals).reduce((a, b) => a + b, 0),
          errorCount: errors.length + (stopped ? 1 : 0),
          message,
          metadata: errors.length ? { errors: errors.slice(0, 50) } : undefined,
        },
      });
      return lastRun;
    });
  },
);
