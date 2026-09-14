import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";

/**
 * Purges spent warranty conversations.
 *
 * A conversation row is the agent's working memory while a chat is in progress —
 * the phase, the identified property, the facts gathered so far. Once the chat is
 * over nothing reads it again: there is no history UI, and no endpoint lists or
 * reopens past conversations. Left alone the table grows forever, holding
 * homeowner addresses, emails and full transcripts that nothing will ever show.
 *
 * Conversations that filed a ticket are kept far longer. That transcript is the
 * diagnostic trail behind an open warranty claim, and a claim can stay live long
 * after the chat that started it went quiet.
 */

const DAY = 24 * 60 * 60 * 1000;

/** Chats that never became a claim. Dead weight almost immediately. */
const PLAIN_RETENTION_DAYS = Number(process.env.WARRANTY_CONVERSATION_RETENTION_DAYS || 30);

/** Chats that filed a ticket — kept while the claim could still be worked. */
const TICKETED_RETENTION_DAYS = Number(process.env.WARRANTY_TICKETED_RETENTION_DAYS || 180);

/** Ceiling per run, so a first run against a long-neglected table cannot lock it up. */
const BATCH_SIZE = 500;

export function cutoffFor(days, now = Date.now()) {
  return new Date(now - days * DAY);
}

/**
 * Deletes one capped batch and reports how many went.
 *
 * Ids are selected first rather than issuing a bare deleteMany, so the cap is
 * real: anything past it is simply collected on the next nightly run.
 */
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

      // updatedAt, not createdAt: the clock runs from the last thing that
      // happened in the chat, so a long-running conversation is never cut short.
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
