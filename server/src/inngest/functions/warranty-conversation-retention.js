import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";


const DAY = 24 * 60 * 60 * 1000;
const PLAIN_RETENTION_DAYS = Number(process.env.WARRANTY_CONVERSATION_RETENTION_DAYS || 30);
const TICKETED_RETENTION_DAYS = Number(process.env.WARRANTY_TICKETED_RETENTION_DAYS || 180);
const BATCH_SIZE = 500;

export function cutoffFor(days, now = Date.now()) {
  return new Date(now - days * DAY);
}


async function purge(where, label) {
  const rows = await prisma.warrantyConversation.findMany({
    where,
    select: { id: true },
    orderBy: { updatedAt: "asc" },
    take: BATCH_SIZE,
  });

  if (rows.length === 0) return 0;

  const { count } = await prisma.warrantyConversation.deleteMany({
    where: { id: { in: rows.map((r) => r.id) } },
  });

  console.log(`[Warranty Retention] removed ${count} ${label} conversation(s).`);
  return count;
}

export const warrantyConversationRetention = inngest.createFunction(
  { id: "warranty-conversation-retention", triggers: [{ cron: "30 3 * * *" }] },
  async ({ step }) =>
    step.run("purge-expired-warranty-conversations", async () => {
      const now = Date.now();
      const withoutTicket = await purge(
        { ticketId: null, updatedAt: { lt: cutoffFor(PLAIN_RETENTION_DAYS, now) } },
        "unticketed",
      );

      const withTicket = await purge(
        { ticketId: { not: null }, updatedAt: { lt: cutoffFor(TICKETED_RETENTION_DAYS, now) } },
        "ticketed",
      );

      const deleted = withoutTicket + withTicket;
      if (deleted === 0) console.log("[Warranty Retention] nothing to remove.");

      return { deleted, withoutTicket, withTicket, batchSize: BATCH_SIZE };
    }),
);
