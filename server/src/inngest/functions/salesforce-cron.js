import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { runIncrementalSync } from "../../services/salesforce-sync.js";

// SW-CRM-006: scheduled per-tenant incremental Salesforce sync. The cron ticks
// every 15 minutes; each active connection is synced only when it is due per its
// own `syncInterval` (default 15 min). Per-tenant failures are isolated so one
// bad connection doesn't stop the others.
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
