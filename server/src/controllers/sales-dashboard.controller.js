import prisma from "../lib/prisma.js";
import { parseAsync } from "json2csv";

// How many active campaigns / calendar items the landing page shows.
const DASHBOARD_LIST_LIMIT = 5;

// SW-DSH-001 "upcoming calendar items": things that are actually going to happen.
// Excludes `Suggested` (AI-proposed and inert until a user accepts it, per
// SW-CAL-002), `Dismissed`, and the terminal states (Sent / Published / Failed).
const UPCOMING_CALENDAR_STATUSES = ["Draft", "Approved", "Scheduled"];

// A campaign counts as converted on the same basis as the campaign analytics
// endpoint (campaigns.controller.js) — exited because the lead replied or booked.
// Kept identical on purpose: two different conversion numbers between the
// dashboard and the campaign page would be worse than none.
const CONVERSION_EXIT_REASONS = ["REPLY", "APPOINTMENT"];

const round1 = (n) => Math.round(n * 10) / 10;

// Build per-campaign metrics from grouped aggregates. Deliberately avoids loading
// enrollment rows: a tenant at the SRS's 100k-lead target would otherwise pull tens
// of thousands of rows into memory just to render a dashboard card (NFR-P-001 wants
// this page under 2s at p95).
function buildCampaignMetrics(campaigns, enrollmentGroups, convertedGroups, stepSums) {
  return campaigns.map((c) => {
    const groups = enrollmentGroups.filter((g) => g.campaignId === c.id);
    const countFor = (statuses) =>
      groups
        .filter((g) => statuses.includes(g.status))
        .reduce((sum, g) => sum + (g._count?._all || 0), 0);

    const enrolled = groups.reduce((sum, g) => sum + (g._count?._all || 0), 0);
    const converted =
      convertedGroups.find((g) => g.campaignId === c.id)?._count?._all || 0;
    const sums = stepSums.find((g) => g.campaignId === c.id)?._sum || {};

    return {
      id: c.id,
      name: c.name,
      channel: c.channel,
      status: c.status,
      enrolled,
      active: countFor(["ACTIVE", "PAUSED"]),
      completed: countFor(["COMPLETED"]),
      exited: countFor(["EXITED"]),
      converted,
      conversionRate: enrolled > 0 ? round1((converted / enrolled) * 100) : 0,
      sent: sums.sentCount || 0,
      delivered: sums.deliveredCount || 0,
      opened: sums.openedCount || 0,
      clicked: sums.clickedCount || 0,
      replied: sums.repliedCount || 0,
    };
  });
}

export const getDashboardStats = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const companyId = req.user.companyId;
    const now = new Date();

    // Aggregate queries
    const [
      totalLeads,
      newLeads,
      nurturingLeads,
      appointmentSetLeads,
      closedWonLeads,
      activeCampaignsCount,
      recentTimelineEvents,
      upcomingAppointments,
      salesforceConnection,
      activeCampaigns,
      upcomingCalendarItems,
      totalEnrolled,
    ] = await prisma.$transaction([
      prisma.lead.count({ where: { companyId } }),
      prisma.lead.count({ where: { companyId, status: "New" } }),
      prisma.lead.count({ where: { companyId, status: "Nurturing" } }),
      prisma.lead.count({ where: { companyId, status: "Appointment Set" } }),
      prisma.lead.count({ where: { companyId, status: "Closed Won" } }),
      prisma.campaign.count({ where: { companyId, status: "Active" } }),
      prisma.leadTimeline.findMany({
        where: { lead: { companyId } },
        take: 10,
        orderBy: { createdAt: "desc" },
        include: { lead: { select: { firstName: true, lastName: true } } },
      }),
      prisma.salesAppointment.findMany({
        where: {
          lead: { companyId },
          time: { gte: now },
          status: "CONFIRMED",
        },
        take: DASHBOARD_LIST_LIMIT,
        orderBy: { time: "asc" },
        include: { lead: { select: { firstName: true, lastName: true } } },
      }),
      prisma.salesforceConnection.findUnique({
        where: { companyId },
        select: { lastSyncAt: true, lastSyncStatus: true, isActive: true },
      }),
      // SW-DSH-001: the active campaigns themselves, not just how many there are.
      prisma.campaign.findMany({
        where: { companyId, status: "Active" },
        take: DASHBOARD_LIST_LIMIT,
        orderBy: { updatedAt: "desc" },
        select: { id: true, name: true, channel: true, status: true },
      }),
      // SW-DSH-001: upcoming calendar items.
      prisma.contentCalendar.findMany({
        where: {
          companyId,
          scheduledAt: { gte: now },
          status: { in: UPCOMING_CALENDAR_STATUSES },
        },
        take: DASHBOARD_LIST_LIMIT,
        orderBy: { scheduledAt: "asc" },
        select: {
          id: true,
          title: true,
          channel: true,
          scheduledAt: true,
          status: true,
          isAiSuggested: true,
        },
      }),
      // Enrolled across every campaign. Counted here so the dashboard page doesn't
      // have to fetch all campaigns with all their enrollment rows just to sum them.
      prisma.campaignEnrollment.count({ where: { campaign: { companyId } } }),
    ]);

    // Metrics for the campaigns above. Bounded by DASHBOARD_LIST_LIMIT ids, and
    // grouped in the database rather than counted in JS.
    const campaignIds = activeCampaigns.map((c) => c.id);
    const [enrollmentGroups, convertedGroups, stepSums] = campaignIds.length
      ? await Promise.all([
          prisma.campaignEnrollment.groupBy({
            by: ["campaignId", "status"],
            where: { campaignId: { in: campaignIds } },
            _count: { _all: true },
          }),
          prisma.campaignEnrollment.groupBy({
            by: ["campaignId"],
            where: {
              campaignId: { in: campaignIds },
              status: "EXITED",
              exitedReason: { in: CONVERSION_EXIT_REASONS },
            },
            _count: { _all: true },
          }),
          prisma.campaignStep.groupBy({
            by: ["campaignId"],
            where: { campaignId: { in: campaignIds } },
            _sum: {
              sentCount: true,
              deliveredCount: true,
              openedCount: true,
              clickedCount: true,
              repliedCount: true,
            },
          }),
        ])
      : [[], [], []];

    return res.json({
      leads: {
        total: totalLeads,
        new: newLeads,
        nurturing: nurturingLeads,
        appointmentSet: appointmentSetLeads,
        closedWon: closedWonLeads,
      },
      campaigns: {
        activeCount: activeCampaignsCount,
        totalEnrolled,
        active: buildCampaignMetrics(
          activeCampaigns,
          enrollmentGroups,
          convertedGroups,
          stepSums,
        ),
      },
      recentActivity: recentTimelineEvents,
      upcomingAppointments,
      upcomingCalendarItems,
      crmSyncHealth: salesforceConnection || null,
    });
  } catch (error) {
    console.error("Sales dashboard error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// SW-DSH-002: "All reporting views shall be exportable as CSV." One builder per
// reporting view; each returns already-flattened rows ready for json2csv.
const EXPORTERS = {
  leads: async (companyId) => {
    const leads = await prisma.lead.findMany({
      where: { companyId },
      include: { owner: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
    });

    return leads.map((l) => ({
      ID: l.id,
      FirstName: l.firstName,
      LastName: l.lastName,
      Email: l.email,
      Phone: l.phone,
      Status: l.status,
      Source: l.source,
      Owner: l.owner ? l.owner.name || l.owner.email : "Unassigned",
      Archived: l.archived ? "Yes" : "No",
      EmailOptIn: l.emailOptIn ? "Yes" : "No",
      SmsOptIn: l.smsOptIn ? "Yes" : "No",
      CreatedAt: l.createdAt.toISOString(),
    }));
  },

  // Per-campaign totals — mirrors the campaign analytics view (SW-NUR-008).
  campaigns: async (companyId) => {
    const campaigns = await prisma.campaign.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      include: {
        steps: {
          select: {
            sentCount: true,
            deliveredCount: true,
            openedCount: true,
            clickedCount: true,
            repliedCount: true,
            bouncedCount: true,
            complaintCount: true,
          },
        },
        enrollments: { select: { status: true, exitedReason: true } },
      },
    });

    return campaigns.map((c) => {
      const sum = (field) => c.steps.reduce((a, s) => a + (s[field] || 0), 0);
      const enrolled = c.enrollments.length;
      const converted = c.enrollments.filter(
        (e) => e.status === "EXITED" && CONVERSION_EXIT_REASONS.includes(e.exitedReason),
      ).length;

      return {
        CampaignID: c.id,
        Name: c.name,
        Status: c.status,
        Channel: c.channel,
        Steps: c.steps.length,
        Enrolled: enrolled,
        Active: c.enrollments.filter((e) => ["ACTIVE", "PAUSED"].includes(e.status)).length,
        Completed: c.enrollments.filter((e) => e.status === "COMPLETED").length,
        Exited: c.enrollments.filter((e) => e.status === "EXITED").length,
        Converted: converted,
        ConversionRatePct: enrolled > 0 ? round1((converted / enrolled) * 100) : 0,
        Sent: sum("sentCount"),
        Delivered: sum("deliveredCount"),
        Opened: sum("openedCount"),
        Clicked: sum("clickedCount"),
        Replied: sum("repliedCount"),
        Bounced: sum("bouncedCount"),
        Complaints: sum("complaintCount"),
        CreatedAt: c.createdAt.toISOString(),
      };
    });
  },

  // Per-step breakdown — SW-NUR-008 asks for metrics "per sequence and per step",
  // and a step-level bounce/complaint spike is the thing you actually act on.
  "campaign-steps": async (companyId) => {
    const steps = await prisma.campaignStep.findMany({
      where: { campaign: { companyId } },
      orderBy: [{ campaignId: "asc" }, { position: "asc" }],
      include: { campaign: { select: { name: true, status: true } } },
    });

    return steps.map((s) => ({
      CampaignName: s.campaign?.name || "",
      CampaignStatus: s.campaign?.status || "",
      StepPosition: s.position,
      StepType: s.type,
      Subject: s.subject || "",
      DelayValue: s.delayValue ?? "",
      DelayUnit: s.delayUnit || "",
      Sent: s.sentCount,
      Delivered: s.deliveredCount,
      Opened: s.openedCount,
      Clicked: s.clickedCount,
      Replied: s.repliedCount,
      Bounced: s.bouncedCount,
      Complaints: s.complaintCount,
    }));
  },

  // SW-ANN-005: per announcement, broken down by the counters the pipeline keeps.
  announcements: async (companyId) => {
    const announcements = await prisma.announcement.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
    });

    return announcements.map((a) => ({
      AnnouncementID: a.id,
      Title: a.title,
      Subject: a.subject,
      Channel: a.channel,
      Status: a.status,
      AudienceType: a.audienceType,
      AudienceSize: a.audienceCount,
      Sent: a.sentCount,
      Delivered: a.deliveredCount,
      Failed: a.failedCount,
      Opened: a.openedCount,
      Clicked: a.clickedCount,
      Unsubscribed: a.unsubscribedCount,
      ScheduledAt: a.scheduledAt ? a.scheduledAt.toISOString() : "",
      SentAt: a.sentAt ? a.sentAt.toISOString() : "",
      CreatedAt: a.createdAt.toISOString(),
    }));
  },

  // SW-AMK-005: aggregate analytics per automation rule.
  automations: async (companyId) => {
    const rules = await prisma.marketingRule.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { runs: true } } },
    });

    // One grouped query for matched-run counts rather than per-rule counting.
    const matched = await prisma.marketingRuleRun.groupBy({
      by: ["ruleId"],
      where: { companyId, matched: true },
      _count: { _all: true },
    });

    return rules.map((r) => {
      const totalRuns = r._count?.runs || 0;
      const matchedRuns = matched.find((m) => m.ruleId === r.id)?._count?._all || 0;
      return {
        RuleID: r.id,
        Name: r.name,
        TriggerEvent: r.triggerEvent,
        Active: r.isActive ? "Yes" : "No",
        CooldownHours: r.cooldownHours,
        RateLimitCount: r.rateLimitCount,
        RateLimitWindow: r.rateLimitWindow,
        // runCount is the rule's own counter; TotalRuns counts logged run rows.
        // They can diverge if runs were pruned — both are reported rather than
        // silently picking one.
        RuleRunCount: r.runCount,
        TotalRuns: totalRuns,
        MatchedRuns: matchedRuns,
        SkippedRuns: Math.max(0, totalRuns - matchedRuns),
        LastTriggeredAt: r.lastTriggeredAt ? r.lastTriggeredAt.toISOString() : "",
        CreatedAt: r.createdAt.toISOString(),
      };
    });
  },

  // SW-ANN-002 companion: what's sitting in the dead-letter queue.
  "failed-sends": async (companyId) => {
    const rows = await prisma.deadLetter.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
    });

    return rows.map((d) => ({
      ID: d.id,
      Source: d.source,
      Channel: d.channel,
      Recipient: d.payload?.to || "",
      Subject: d.payload?.subject || "",
      Error: d.error,
      Attempts: d.attempts,
      Status: d.status,
      RefID: d.refId || "",
      ReplayedAt: d.replayedAt ? d.replayedAt.toISOString() : "",
      FailedAt: d.createdAt.toISOString(),
    }));
  },
};

export const exportDashboardCsv = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const { type } = req.query;
    const build = EXPORTERS[type];

    if (!build) {
      return res.status(400).json({
        message: `Invalid export type '${type || ""}'. Valid types: ${Object.keys(EXPORTERS).join(", ")}.`,
      });
    }

    const rows = await build(req.user.companyId);

    // json2csv infers columns from the data, so an empty result would produce an
    // empty file with no header. Send the header row instead — an export that
    // downloads a blank file reads as a bug.
    const csv = rows.length
      ? await parseAsync(rows)
      : await parseAsync([], { fields: ["No data"] });

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${type}-export-${stamp}.csv`,
    );
    return res.send(csv);
  } catch (error) {
    console.error("Sales dashboard export error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
