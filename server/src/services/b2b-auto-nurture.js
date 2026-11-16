import prisma from "../lib/prisma.js";
import { inngest } from "../lib/inngest.js";
import { B2B_CLOSED_STATUSES } from "../lib/b2b.js";
import { B2B_PLAYBOOK_NAME, b2bPlaybookSteps } from "../lib/b2b-nurture-playbook.js";

// The one built-in campaign. A fixed id, so every caller finds it without a lookup table.
export const B2B_AUTO_ID = "b2b-auto-180";

// Manual and CSV leads made before auto-join existed stay manual, so turning it on didn't email the whole backlog.
const MANUAL_AUTO_JOIN_FROM = new Date("2026-11-13T00:00:00Z");
// Leads still in the old journey's sending stages move over. Ones that replied or booked are with the agent.
const JOURNEY_SENDING_STAGES = ["FIRST_TOUCH", "NO_RESPONSE", "QUARTERLY"];

export const ensureB2BAutoCampaign = () =>
  prisma.b2BCampaign.upsert({
    where: { id: B2B_AUTO_ID },
    create: { id: B2B_AUTO_ID, name: B2B_PLAYBOOK_NAME, status: "ACTIVE", steps: b2bPlaybookSteps() },
    update: {},
  });

export const startB2BEnrollments = async (ids) => {
  for (let i = 0; i < ids.length; i += 500) {
    await inngest.send(ids.slice(i, i + 500).map((enrollmentId) => ({ name: "b2b.enrollment.started", data: { enrollmentId } })));
  }
};

/**
 * Enrolls every lead the 180-day nurture should have and doesn't yet: new website, manual and CSV
 * leads we've never talked to, plus leads moving over from the old journey. Each lead joins once;
 * a lead that replied, booked or finished isn't added again. Runs on lead creation and every 15 minutes.
 */
export async function autoEnrollB2BLeads() {
  const campaign = await ensureB2BAutoCampaign();
  if (campaign.status !== "ACTIVE") return { enrolled: 0, skipped: "180-day nurture is switched off" };

  const leads = await prisma.b2BLead.findMany({
    where: {
      emailOptOut: false,
      status: { notIn: B2B_CLOSED_STATUSES },
      enrollments: { none: { campaignId: B2B_AUTO_ID } },
      OR: [
        { journeyStage: { in: JOURNEY_SENDING_STAGES } },
        {
          journeyEnteredAt: null,
          OR: [{ source: { startsWith: "WEBSITE_" } }, { source: { in: ["MANUAL", "CSV"] }, createdAt: { gte: MANUAL_AUTO_JOIN_FROM } }],
          // Speed-to-lead is for someone who has never heard from us, not a lead already in talks.
          messages: { none: { actor: { in: ["LEAD", "AGENT"] } } },
          appointments: { none: {} },
        },
      ],
    },
    select: { id: true },
    take: 500,
  });

  let ids = [];
  if (leads.length) {
    await prisma.b2BEnrollment.createMany({
      data: leads.map((l) => ({ leadId: l.id, campaignId: B2B_AUTO_ID, status: "ACTIVE", nextRunAt: new Date() })),
      skipDuplicates: true,
    });
    ids = (await prisma.b2BEnrollment.findMany({
      where: { campaignId: B2B_AUTO_ID, leadId: { in: leads.map((l) => l.id) }, status: "ACTIVE", sentCount: 0, currentStep: 0 },
      select: { id: true },
    })).map((e) => e.id);
    await startB2BEnrollments(ids);
  }
  // The journey is retired: clear its fields once every lead due to move over has moved.
  if (leads.length < 500) await prisma.b2BLead.updateMany({ where: { journeyStage: { not: null } }, data: { journeyStage: null, journeyNextAt: null, journeyHoldReason: null } });
  return { enrolled: ids.length };
}

/** For lead-creation paths: enrolling must never cost us the lead. */
export const autoEnrollSoon = () =>
  autoEnrollB2BLeads().catch((e) => console.error("[B2B nurture] Auto-enroll failed:", e.message));
