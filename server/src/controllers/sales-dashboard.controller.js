import prisma from "../lib/prisma.js";
import { parseAsync } from "json2csv";
import { LEAD_STATUS } from "../lib/lead-statuses.js";

const DASHBOARD_LIST_LIMIT = 5;
const UPCOMING_CALENDAR_STATUSES = ["Draft", "Approved", "Scheduled"];
const CONVERSION_EXIT_REASONS = ["REPLY", "APPOINTMENT"];

const round1 = (n) => Math.round(n * 10) / 10;
function buildCampaignMetrics(campaigns, enrollmentGroups, convertedGroups) {
  return campaigns.map((c) => {
    const groups = enrollmentGroups.filter((g) => g.campaignId === c.id);
    const countFor = (statuses) =>
      groups
        .filter((g) => statuses.includes(g.status))
        .reduce((sum, g) => sum + (g._count?._all || 0), 0);

    const enrolled = groups.reduce((sum, g) => sum + (g._count?._all || 0), 0);
    const converted =
      convertedGroups.find((g) => g.campaignId === c.id)?._count?._all || 0;

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
    };
  });
}

export const getDashboardStats = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const now = new Date();

    // A homeowner sees only their own leads (SRS 4.12), so every lead figure on
    // this dashboard is narrowed to the ones they own. Without this they would
    // read the whole tenant lead count.
    const isHomeowner = String(req.user.role || "").toUpperCase() === "HOMEOWNER";
    const leadWhere = isHomeowner
      ? { companyId, ownerId: req.user.id }
      : { companyId };

    // Aggregate queries
    const [
      totalLeads,
      newLeads,
      nurturingLeads,
      appointmentSetLeads,
      closedWonLeads,
      activeCampaignsCount,
      upcomingAppointments,
      salesforceConnection,
      activeCampaigns,
      upcomingCalendarItems,
      totalEnrolled,
    ] = await prisma.$transaction([
      prisma.lead.count({ where: leadWhere }),
      prisma.lead.count({ where: { ...leadWhere, status: "New" } }),
      prisma.lead.count({ where: { ...leadWhere, status: LEAD_STATUS.NURTURING } }),
      prisma.lead.count({ where: { ...leadWhere, status: LEAD_STATUS.APPOINTMENT_SET } }),
      prisma.lead.count({ where: { ...leadWhere, status: LEAD_STATUS.CLOSED_WON } }),
      prisma.campaign.count({ where: { companyId, status: "Active" } }),
      prisma.salesAppointment.findMany({
        where: {
          lead: leadWhere,
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
          // Homeowners see only their own calendar items.
          ...(isHomeowner ? { ownerId: req.user.id } : {}),
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
      prisma.campaignEnrollment.count({ where: { campaign: { companyId } } }),
    ]);

    const campaignIds = activeCampaigns.map((c) => c.id);
    const [enrollmentGroups, convertedGroups] = campaignIds.length
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
        ])
      : [[], []];

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
        ),
      },
      upcomingAppointments,
      upcomingCalendarItems,
      crmSyncHealth: salesforceConnection || null,
    });
  } catch (error) {
    console.error("Sales dashboard error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

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

  campaigns: async (companyId) => {
    const campaigns = await prisma.campaign.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      include: {
        steps: { select: { id: true } },
        enrollments: { select: { status: true, exitedReason: true } },
      },
    });

    return campaigns.map((c) => {
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
        CreatedAt: c.createdAt.toISOString(),
      };
    });
  },

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
    }));
  },

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
      ScheduledAt: a.scheduledAt ? a.scheduledAt.toISOString() : "",
      SentAt: a.sentAt ? a.sentAt.toISOString() : "",
      CreatedAt: a.createdAt.toISOString(),
    }));
  },

  automations: async (companyId) => {
    const rules = await prisma.marketingRule.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { runs: true } } },
    });

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
        RuleRunCount: r.runCount,
        TotalRuns: totalRuns,
        MatchedRuns: matchedRuns,
        SkippedRuns: Math.max(0, totalRuns - matchedRuns),
        LastTriggeredAt: r.lastTriggeredAt ? r.lastTriggeredAt.toISOString() : "",
        CreatedAt: r.createdAt.toISOString(),
      };
    });
  },
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
    const { type } = req.query;
    const build = EXPORTERS[type];

    if (!build) {
      return res.status(400).json({
        message: `Invalid export type '${type || ""}'. Valid types: ${Object.keys(EXPORTERS).join(", ")}.`,
      });
    }

    const rows = await build(req.user.companyId);

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
