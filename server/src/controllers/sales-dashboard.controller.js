import prisma from "../lib/prisma.js";
import { csvLine } from "../lib/utils.js";
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

const PERIOD_DAYS = { "7d": 7, "30d": 30, "90d": 90 };

export const getAgentPerformance = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const days = PERIOD_DAYS[req.query.period] || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [interactions, nurturedTouches, booked, newLeads, newLeadsBooked] = await Promise.all([
      prisma.schedulingConversation.count({ where: { lead: { companyId }, createdAt: { gte: since } } }),
      prisma.messageUsage.count({ where: { companyId, source: "nurture", outcome: "sent", createdAt: { gte: since } } }),
      prisma.salesAppointment.count({ where: { lead: { companyId }, createdAt: { gte: since } } }),
      prisma.lead.count({ where: { companyId, createdAt: { gte: since } } }),
      prisma.lead.count({ where: { companyId, createdAt: { gte: since }, appointments: { some: {} } } }),
    ]);

    return res.json({
      period: `${days}d`,
      interactions,
      nurturedTouches,
      bookedAppointments: booked,
      newLeads,
      successRate: newLeads > 0 ? round1((newLeadsBooked / newLeads) * 100) : null,
    });
  } catch (error) {
    console.error("Sales agent performance error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getDashboardStats = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const now = new Date();

    const isHomeowner = String(req.user.role || "").toUpperCase() === "HOMEOWNER";
    const leadWhere = isHomeowner
      ? { companyId, ownerId: req.user.id }
      : { companyId };
    const [
      leadStatusCounts,
      activeCampaignsCount,
      upcomingAppointments,
      salesforceConnection,
      activeCampaigns,
      upcomingCalendarItems,
      totalEnrolled,
      upcomingCount,
    ] = await Promise.all([
      prisma.lead.groupBy({ by: ["status"], where: leadWhere, _count: { _all: true } }),
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
      prisma.campaign.findMany({
        where: { companyId, status: "Active" },
        take: DASHBOARD_LIST_LIMIT,
        orderBy: { updatedAt: "desc" },
        select: { id: true, name: true, channel: true, status: true },
      }),
      prisma.contentCalendar.findMany({
        where: {
          companyId,
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
      prisma.salesAppointment.count({ where: { lead: leadWhere, time: { gte: now }, status: "CONFIRMED" } }),
    ]);

    const leadsByStatus = Object.fromEntries(
      leadStatusCounts.map((r) => [r.status, r._count._all]),
    );
    const totalLeads = leadStatusCounts.reduce((n, r) => n + r._count._all, 0);
    const newLeads = leadsByStatus.New || 0;
    const nurturingLeads = leadsByStatus[LEAD_STATUS.NURTURING] || 0;
    const appointmentSetLeads = leadsByStatus[LEAD_STATUS.APPOINTMENT_SET] || 0;
    const closedWonLeads = leadsByStatus[LEAD_STATUS.CLOSED_WON] || 0;

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
      upcomingCount,
      upcomingCalendarItems,
      crmSyncHealth: salesforceConnection || null,
    });
  } catch (error) {
    console.error("Sales dashboard error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const EXPORT_PAGE_SIZE = 1000;

// Yields one page of rows at a time (keyset on id), so an export never holds
// the whole table in memory.
async function* pages(findPage) {
  let cursor = null;
  for (;;) {
    const rows = await findPage({
      take: EXPORT_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length) yield rows;
    if (rows.length < EXPORT_PAGE_SIZE) return;
    cursor = rows[rows.length - 1].id;
  }
}

// Each exporter returns rows, or an async iterable of row batches for tables
// that can grow without bound.
const EXPORTERS = {
  leads: async function* (companyId) {
    const batches = pages((page) =>
      prisma.lead.findMany({
        where: { companyId },
        include: { owner: { select: { name: true, email: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...page,
      }),
    );
    for await (const leads of batches) yield leads.map((l) => ({
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
    // Enrollment counts come from groupBy, not by loading every enrollment row.
    const [campaigns, byStatus, convertedGroups] = await Promise.all([
      prisma.campaign.findMany({
        where: { companyId },
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { steps: true } } },
      }),
      prisma.campaignEnrollment.groupBy({
        by: ["campaignId", "status"],
        where: { campaign: { companyId } },
        _count: { _all: true },
      }),
      prisma.campaignEnrollment.groupBy({
        by: ["campaignId"],
        where: { campaign: { companyId }, status: "EXITED", exitedReason: { in: CONVERSION_EXIT_REASONS } },
        _count: { _all: true },
      }),
    ]);

    return campaigns.map((c) => {
      const count = (statuses) =>
        byStatus
          .filter((g) => g.campaignId === c.id && statuses.includes(g.status))
          .reduce((n, g) => n + g._count._all, 0);
      const enrolled = byStatus
        .filter((g) => g.campaignId === c.id)
        .reduce((n, g) => n + g._count._all, 0);
      const converted = convertedGroups.find((g) => g.campaignId === c.id)?._count._all || 0;

      return {
        CampaignID: c.id,
        Name: c.name,
        Status: c.status,
        Channel: c.channel,
        Steps: c._count.steps,
        Enrolled: enrolled,
        Active: count(["ACTIVE", "PAUSED"]),
        Completed: count(["COMPLETED"]),
        Exited: count(["EXITED"]),
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
  "failed-sends": async function* (companyId) {
    const batches = pages((page) =>
      prisma.deadLetter.findMany({
        where: { companyId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...page,
      }),
    );
    for await (const rows of batches) yield rows.map((d) => ({
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

    const result = build(req.user.companyId);
    const batches = result[Symbol.asyncIterator] ? result : [await result];

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${type}-export-${stamp}.csv`,
    );

    let header = null;
    for await (const rows of batches) {
      if (!rows.length) continue;
      if (!header) {
        header = Object.keys(rows[0]);
        res.write(csvLine(header));
      }
      res.write("\n" + rows.map((row) => csvLine(header.map((key) => row[key]))).join("\n"));
    }
    if (!header) res.write(csvLine(["No data"]));
    return res.end();
  } catch (error) {
    console.error("Sales dashboard export error:", error);
    // Mid-stream failure: the status is already sent, so cut the download
    // short rather than let a truncated file look complete.
    if (res.headersSent) return res.destroy(error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
