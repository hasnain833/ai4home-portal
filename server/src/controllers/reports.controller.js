import prisma from "../lib/prisma.js";

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

    const companyScope = { homeowner: { companyId: session.companyId || "demo-company" } };

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
        kbReferences: true,
        erpSyncStatus: true
      }
    });

    // NFR 6.5: ERP sync health — success rate + recent failure log for the dashboard.
    const companyId = session.companyId || "demo-company";
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
    const escalatedTickets = tickets.filter(t => t.status === "ESCALATED" || t.isEmergency);

    const autoResolutionRate = totalTickets > 0
      ? Math.round((resolvedTickets.length / totalTickets) * 100)
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

    const diyGuidanceTickets = tickets.filter(t => t.kbReferences).length;
    const diyGuidanceRate = totalTickets > 0 ? Math.round((diyGuidanceTickets / totalTickets) * 100) : 0;

    const agentPerformance = [
      { label: "Auto-resolved", value: autoResolutionRate },
      { label: "Escalated to staff", value: totalTickets > 0 ? Math.round((escalatedTickets.length / totalTickets) * 100) : 0 },
      { label: "DIY guidance", value: diyGuidanceRate }
    ];

    const activeSurveyCount = 0;
    const customerSatisfaction = 0.0;
    const readinessFromCsat = (customerSatisfaction / 5) * 50;
    const readinessFromAuto = (autoResolutionRate / 100) * 30;
    const readinessFromSpeed = avgResolutionTime > 0 ? Math.max(0, 20 - avgResolutionTime * 2) : 20;
    const surveyReadiness = Math.round(readinessFromCsat + readinessFromAuto + readinessFromSpeed);
    const predictedTickets = totalTickets > 0 ? Math.round(totalTickets * (period === "7d" ? 1.12 : period === "30d" ? 1.08 : 1.05)) : 0;
    const topIssue = issueBreakdown[0]?.category || "None";
    const predictedRiskArea = topIssue;
    const escalationRisk = escalatedTickets.length > (totalTickets * 0.4) ? "HIGH" : "LOW";

    return res.json({
      autoResolutionRate,
      avgResolutionTime: parseFloat(avgResolutionTime.toFixed(1)),
      avgResponseTime: parseFloat((avgResolutionTime * 24 * 60).toFixed(0)) || 0,
      tokensPerClaim: 0,
      customerSatisfaction,
      surveyCount: activeSurveyCount,
      issueBreakdown,
      agentPerformance,
      surveyReadiness,
      predictedTickets,
      predictedRiskArea,
      escalationRisk,
      erpSyncSuccessRate,
      erpSyncedCount,
      erpFailedCount,
      erpFailureLog
    });

  } catch (error) {
    console.error("Reports API error:", error);
    return res.status(500).json({ message: "Error fetching reports analytics" });
  }
};
