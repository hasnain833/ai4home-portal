import prisma from "../lib/prisma.js";
import { ERP_LIVE_PLATFORMS } from "../services/erp-service.js";

const AUTO_RESOLVED_TYPE = "AI Chat — Resolved in chat";
const ENGAGEMENT_TARGET = 98;

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : null);


async function warrantyAgentMetrics(companyId, since, until) {
  const inPeriod = { gte: since, lte: until };

  const [inquiries, diagnosed, resolvedByAi, visits, resolvedWithVisits] = await Promise.all([
    prisma.warrantyConversation.count({ where: { companyId, createdAt: inPeriod } }),
    prisma.warrantyConversation.count({ where: { companyId, createdAt: inPeriod, ticketId: { not: null } } }),
    prisma.ticket.count({ where: { homeowner: { companyId }, createdAt: inPeriod, ticketType: AUTO_RESOLVED_TYPE } }),
    prisma.ticketAppointment.findMany({
      where: { companyId, scheduledAt: inPeriod },
      select: { status: true, scheduledAt: true, remindersSent: true, rescheduleCount: true, tradeEmail: true },
    }),
    prisma.ticket.findMany({
      where: { homeowner: { companyId }, status: "RESOLVED", updatedAt: inPeriod, appointments: { some: { status: "COMPLETED" } } },
      select: { appointments: { where: { status: { not: "CANCELLED" } }, select: { id: true } } },
    }),
  ]);

  const homeownerReminders = visits.reduce((n, v) => n + v.remindersSent.length, 0);
  const tradeReminders = visits.reduce((n, v) => n + (v.tradeEmail ? v.remindersSent.length : 0), 0);
  const now = Date.now();
  const due = visits.filter((v) => v.scheduledAt.getTime() <= now && v.status !== "SCHEDULED");
  const kept = due.filter((v) => v.status === "COMPLETED").length;

  const firstVisitFixes = resolvedWithVisits.filter((t) => t.appointments.length === 1).length;

  return {
    inquiriesHandled: inquiries,
    inquiriesDiagnosed: diagnosed,
    inquiriesResolvedByAi: resolvedByAi,
    homeownerReminders,
    tradeReminders,
    appointmentKeptRate: pct(kept, due.length),
    appointmentsRescheduled: visits.filter((v) => v.rescheduleCount > 0).length,
    firstAppointmentResolutionRate: pct(firstVisitFixes, resolvedWithVisits.length),
  };
}

export const getAnalytics = async (req, res) => {
  try {
    const session = req.user;
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const period = req.query.period || "7d";
    const startDateParam = req.query.startDate;
    const endDateParam = req.query.endDate;

    let sinceDate = new Date();
    let untilDate = new Date();

    if (period === "custom" && startDateParam) {
      sinceDate = new Date(startDateParam);
      sinceDate.setHours(0, 0, 0, 0);
      if (endDateParam) {
        untilDate = new Date(endDateParam);
        untilDate.setHours(23, 59, 59, 999);
      }
    } else {
      const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
      sinceDate.setDate(sinceDate.getDate() - days);
    }

    const companyScope = { homeowner: { companyId: session.companyId } };

    const tickets = await prisma.ticket.findMany({
      where: {
        createdAt: {
          gte: sinceDate,
          lte: untilDate
        },
        ...companyScope
      },
      select: {
        status: true,
        issueType: true,
        isEmergency: true,
        createdAt: true,
        updatedAt: true,
        erpSyncStatus: true,
        ticketType: true,
        assignedStaffId: true,
        appointments: { where: { status: { not: "CANCELLED" } }, select: { id: true } }
      }
    });

    const agentMetrics = await warrantyAgentMetrics(session.companyId, sinceDate, untilDate);

    // NFR 6.5: ERP sync health — success rate + recent failure log for the dashboard.
    const companyId = session.companyId;
    const erpSyncedCount = tickets.filter((t) => t.erpSyncStatus === "SYNCED").length;
    const erpFailedCount = tickets.filter((t) => t.erpSyncStatus === "FAILED").length;
    const erpAttempted = erpSyncedCount + erpFailedCount;
    const erpSyncSuccessRate = erpAttempted > 0 ? Math.round((erpSyncedCount / erpAttempted) * 100) : 100;

    let erpFailureLog = [];
    try {
      const failures = await prisma.syncLog.findMany({
        where: { companyId, direction: "OUTBOUND", status: "FAILED", createdAt: { gte: sinceDate, lte: untilDate } },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { action: true, message: true, createdAt: true, metadata: true },
      });
      erpFailureLog = failures.map((f) => ({
        platform: (f.action || "").replace("ERP_SYNC:", ""),
        message: f.message,
        ticketId: f.metadata?.ticketId || null,
        at: f.createdAt,
      }));
    } catch (e) {
      console.error("[Reports] Failed to load ERP failure log:", e.message);
    }

    const totalTickets = tickets.length;
    const resolvedTickets = tickets.filter(t => t.status === "RESOLVED");
    const escalatedTickets = tickets.filter(t => t.isEmergency);
    const openTickets = tickets.filter(t => t.status === "OPEN" || t.status === "DISPATCHED");

    const resolutionRate = totalTickets > 0
      ? Math.round((resolvedTickets.length / totalTickets) * 100)
      : 0;
    const escalationRate = totalTickets > 0
      ? Math.round((escalatedTickets.length / totalTickets) * 100)
      : 0;

    let avgResolutionTime = 0;
    if (resolvedTickets.length > 0) {
      const totalTime = resolvedTickets.reduce((acc, t) => {
        return acc + (new Date(t.updatedAt).getTime() - new Date(t.createdAt).getTime());
      }, 0);
      avgResolutionTime = totalTime / resolvedTickets.length / (1000 * 60 * 60 * 24);
    }

    const issueCounts = {};
    tickets.forEach(t => {
      const cat = t.issueType || "Other";
      issueCounts[cat] = (issueCounts[cat] || 0) + 1;
    });

    const issueBreakdown = Object.entries(issueCounts)
      .map(([category, count]) => ({
        category,
        percentage: totalTickets > 0 ? Math.round((count / totalTickets) * 100) : 0
      }))
      .sort((a, b) => b.percentage - a.percentage);

    // Auto-resolved: the AI closed it in chat (both chat paths stamp this ticketType).
    // Escalated: everything else, i.e. it needed the builder's team. The two sum to 100.
    const autoResolved = tickets.filter(t => t.ticketType === AUTO_RESOLVED_TYPE).length;
    const autoResolutionRate = totalTickets > 0 ? Math.round((autoResolved / totalTickets) * 100) : 0;
    const escalatedToTeamRate = totalTickets > 0 ? 100 - autoResolutionRate : 0;

    const agentPerformance = [
      { label: "Auto-resolution", value: autoResolutionRate },
      { label: "Escalated", value: escalatedToTeamRate }
    ];

    // Dispatch may go to no trade, so assignedStaffId alone misses those claims.
    // Visits only exist after a dispatch, and a reopen clears both.
    // ponytail: misses a no-trade dispatch resolved before any visit was booked; add Ticket.dispatchedAt if that matters.
    const wasDispatched = (t) => t.status === "DISPATCHED" || !!t.assignedStaffId || t.appointments.length > 0;
    const dispatched = tickets.filter(wasDispatched);
    const tradeResolved = dispatched.filter(t => t.status === "RESOLVED").length;
    const tradeResolutionRate = dispatched.length > 0 ? Math.round((tradeResolved / dispatched.length) * 100) : 0;

    // Engagement: of claims sent to a trade, how many homeowners got a visit booked.
    const engaged = dispatched.filter(t => t.appointments.length > 0).length;
    const homeownerEngagement = dispatched.length > 0 ? Math.round((engaged / dispatched.length) * 100) : 0;

    return res.json({
      totalTickets,
      resolvedTickets: resolvedTickets.length,
      openTickets: openTickets.length,
      escalatedTickets: escalatedTickets.length,
      resolutionRate,
      escalationRate,
      avgResolutionTime: parseFloat(avgResolutionTime.toFixed(1)),
      avgResponseTime: parseFloat((avgResolutionTime * 24 * 60).toFixed(0)) || 0,
      issueBreakdown,
      agentPerformance,
      autoResolutionRate,
      tradeResolutionRate,
      dispatchedTickets: dispatched.length,
      homeownerEngagement,
      engagementTarget: ENGAGEMENT_TARGET,
      erpAvailable: ERP_LIVE_PLATFORMS.length > 0,
      erpSyncSuccessRate,
      erpSyncedCount,
      erpFailedCount,
      erpFailureLog,
      agentMetrics: {
        ...agentMetrics,
        claimsDispatched: dispatched.length,
        ticketsWrittenToErp: erpSyncedCount,
      },
    });

  } catch (error) {
    console.error("Reports API error:", error);
    return res.status(500).json({ message: "Error fetching reports analytics" });
  }
};
