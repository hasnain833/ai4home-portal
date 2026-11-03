import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { deliverWebsiteInquiry } from "../../services/website-inquiry-mail.js";

export const websiteInquiryDelivery = inngest.createFunction(
  { id: "b2b-website-inquiry-delivery", concurrency: 1, triggers: [{ event: "b2b.website-inquiry.saved" }, { cron: "*/5 * * * *" }] },
  async ({ event, step }) => {
    await step.run("expire-website-transcripts", async () => {
      const before = new Date(Date.now() - 30 * 86400000);
      await prisma.websiteConversation.deleteMany({ where: { updatedAt: { lt: before } } });
      await prisma.auditLog.deleteMany({ where: { action: { startsWith: "website_agent." }, createdAt: { lt: before } } });
    });
    const ids = await step.run("find-pending", async () => {
      const rows = await prisma.b2BInquiry.findMany({
        where: {
          ...(event.data?.inquiryId ? { id: event.data.inquiryId } : {}),
          nextAttemptAt: { lte: new Date() },
          OR: [{ adminSentAt: null }, { visitorSentAt: null }, { attempts: 0, type: { in: ["BOOKING", "CONSULTATION"] }, OR: [{ adminSmsSentAt: null }, { visitorSmsSentAt: null }] }],
        },
        orderBy: { nextAttemptAt: "asc" }, select: { id: true }, take: 25,
      });
      return rows.map((row) => row.id);
    });
    for (const id of ids) await step.run(`deliver-${id}`, () => deliverWebsiteInquiry(id));
    return { processed: ids.length };
  },
);
