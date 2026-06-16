import prisma from "../lib/prisma.js";

export const getDashboardStats = async (req, res) => {
  try {
    const session = req.user;
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    // Scope all queries to the admin/staff's companyId
    const companyScope = { homeowner: { companyId: session.companyId } };

    // Fetch stats in parallel
    const [
      totalTickets,
      openTickets,
      inProgressTickets,
      resolvedTickets,
      escalatedTickets,
      resolvedThisWeek,
      resolvedTicketsData,
      recentTickets,
      activeIntegration,
      kbDocsCount,
      lastEscalationTicket
    ] = await prisma.$transaction([
      prisma.ticket.count({ where: companyScope }),
      prisma.ticket.count({ where: { status: "OPEN", ...companyScope } }),
      prisma.ticket.count({ where: { status: "IN_PROGRESS", ...companyScope } }),
      prisma.ticket.count({ where: { status: "RESOLVED", ...companyScope } }),
      prisma.ticket.count({ where: { status: "ESCALATED", ...companyScope } }),
      prisma.ticket.count({
        where: {
          status: "RESOLVED",
          updatedAt: { gte: oneWeekAgo },
          ...companyScope
        }
      }),
      prisma.ticket.findMany({
        where: { status: "RESOLVED", ...companyScope },
        select: { createdAt: true, updatedAt: true }
      }),
      prisma.ticket.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        where: companyScope,
        include: { 
          homeowner: { select: { name: true, email: true } },
          property: { select: { address: true } }
        }
      }),
      prisma.integration.findFirst({
        where: { companyId: session.companyId || "demo-company", isActive: true }
      }),
      prisma.knowledgeBaseDocument.count({
        where: { companyId: session.companyId || "demo-company" }
      }),
      prisma.ticket.findFirst({
        where: {
          status: { in: ["ESCALATED", "RESOLVED"] },
          homeowner: { companyId: session.companyId || "demo-company" }
        },
        orderBy: { updatedAt: "desc" }
      })
    ]);

    // Calculate avg resolution time dynamically based on duration
    let avgResolutionTimeStr = "0.0";
    if (resolvedTicketsData.length > 0) {
      const totalTime = resolvedTicketsData.reduce((acc, t) => {
        return acc + (new Date(t.updatedAt).getTime() - new Date(t.createdAt).getTime());
      }, 0);
      const avgMs = totalTime / resolvedTicketsData.length;
      if (avgMs === 0) {
        avgResolutionTimeStr = "Instant";
      } else if (avgMs < 1000 * 60) {
        avgResolutionTimeStr = "< 1 min";
      } else if (avgMs < 1000 * 60 * 60) {
        const mins = Math.round(avgMs / (1000 * 60));
        avgResolutionTimeStr = `${mins} min${mins > 1 ? "s" : ""}`;
      } else if (avgMs < 1000 * 60 * 60 * 24) {
        const hours = (avgMs / (1000 * 60 * 60)).toFixed(1);
        avgResolutionTimeStr = `${hours} hour${parseFloat(hours) !== 1 ? "s" : ""}`;
      } else {
        const days = (avgMs / (1000 * 60 * 60 * 24)).toFixed(1);
        avgResolutionTimeStr = `${days} day${parseFloat(days) !== 1 ? "s" : ""}`;
      }
    }

    const timeAgo = (date) => {
      const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
      if (seconds < 10) return "Just now";
      if (seconds < 60) return `${seconds}s ago`;
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `${minutes}m ago`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      return `${days}d ago`;
    };

    const stats = {
      totalTickets,
      openTickets,
      inProgressTickets,
      escalatedTickets,
      resolvedThisWeek,
      resolutionRate: totalTickets > 0 ? Math.round((resolvedTickets / totalTickets) * 100) : 0,
      avgResolutionTime: avgResolutionTimeStr,
      tokenConsumption: totalTickets * 1250, // Simulated: avg 1250 tokens per ticket lifecycle
      recentTickets: recentTickets.map(t => ({
        id: t.id,
        homeowner: { name: t.homeowner?.name || "Unknown", email: t.homeowner?.email || "" },
        property: t.property ? { address: t.property.address } : null,
        issueType: t.issueType,
        ticketType: t.ticketType || null,
        warrantyYear: t.warrantyYear,
        priority: t.priority,
        status: t.status,
        createdAt: t.createdAt
      })),
      systemHealth: {
        agentStatus: kbDocsCount > 0 ? "Operational" : "Operational", // Keep Phase 1 title as requested but dynamically managed if needed
        erpSync: activeIntegration
          ? `Connected to ${activeIntegration.platform === "BUILTOPIA" ? "Builtopia" : activeIntegration.platform === "BUILDERTREND" ? "Buildertrend" : "Hyphen"}`
          : "Not Connected",
        kbDocs: kbDocsCount > 0 ? `${kbDocsCount} Active Document${kbDocsCount > 1 ? "s" : ""} Scoped` : "No Documents Scoped",
        lastEscalation: lastEscalationTicket
          ? `${timeAgo(lastEscalationTicket.updatedAt)} · ${lastEscalationTicket.status === "ESCALATED" ? "escalated to staff" : "resolved by staff"}`
          : "No recent activity"
      }
    };

    return res.json(stats);
  } catch (error) {
    console.error("Dashboard stats error:", error);
    return res.status(500).json({ message: "Error fetching stats" });
  }
};
