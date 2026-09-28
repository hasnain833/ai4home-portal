import prisma from "../lib/prisma.js";
import { hasPlatformAi } from "../lib/ai-config.js";

const ERP_LABELS = {
  BUILTOPIA: "Builtopia",
  BUILDERTREND: "Buildertrend",
  HYPHEN: "Hyphen",
};

export const getDashboardStats = async (req, res) => {
  try {
    const session = req.user;
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const period = req.query.period || "7d";
    const days = period === "30d" ? 30 : period === "90d" ? 90 : 7;
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);
    const periodCreatedAt = { createdAt: { gte: sinceDate } };

    // Scope all queries to the admin/staff's companyId
    const companyScope = { homeowner: { companyId: session.companyId } };
    const periodScope = { ...companyScope, ...periodCreatedAt };

    // Fetch stats in parallel
    const [
      totalTickets,
      openTickets,
      inProgressTickets,
      resolvedTickets,
      escalatedTickets,
      resolvedThisPeriod,
      resolvedTicketsData,
      recentTickets,
      activeIntegration,
      kbDocsCount,
      lastEscalationTicket,
      lastErpSync,
    ] = await prisma.$transaction([
      prisma.ticket.count({ where: periodScope }),
      prisma.ticket.count({ where: { status: "OPEN", ...periodScope } }),
      prisma.ticket.count({ where: { status: "DISPATCHED", ...periodScope } }),
      prisma.ticket.count({ where: { status: "RESOLVED", ...periodScope } }),
      prisma.ticket.count({ where: { isEmergency: true, ...periodScope } }),
      prisma.ticket.count({
        where: {
          status: "RESOLVED",
          updatedAt: { gte: sinceDate },
          ...companyScope
        }
      }),
      prisma.ticket.findMany({
        where: { status: "RESOLVED", ...periodScope },
        select: { createdAt: true, updatedAt: true }
      }),
      prisma.ticket.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        where: periodScope,
        include: { 
          homeowner: { select: { name: true, email: true } },
          property: { select: { address: true } }
        }
      }),
      prisma.integration.findFirst({
        where: { companyId: session.companyId || "demo-company", isActive: true }
      }),
      prisma.warrantyKB.count({
        where: {
          scope: "COMPANY",
          companyId: session.companyId || "demo-company",
          isActive: true,
          status: "READY",
        },
      }),
      prisma.ticket.findFirst({
        where: {
          isEmergency: true,
          homeowner: { companyId: session.companyId || "demo-company" },
        },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.syncLog.findFirst({
        where: {
          companyId: session.companyId || "demo-company",
          action: { startsWith: "ERP_SYNC:" },
        },
        orderBy: { createdAt: "desc" },
        select: { status: true, createdAt: true },
      }),
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

    const erpName = activeIntegration
      ? ERP_LABELS[activeIntegration.platform] || activeIntegration.platform
      : null;
    const erpHealthy = lastErpSync?.status === "SUCCESS";
    const erpSync = !activeIntegration
      ? "Not Connected"
      : !lastErpSync
        ? `${erpName} configured; no sync yet`
        : erpHealthy
          ? `${erpName} synced ${timeAgo(lastErpSync.createdAt)}`
          : `${erpName} sync failed ${timeAgo(lastErpSync.createdAt)}`;
    const agentHealthy = hasPlatformAi();

    const stats = {
      totalTickets,
      openTickets,
      inProgressTickets,
      escalatedTickets,
      resolvedThisPeriod,
      resolutionRate: totalTickets > 0 ? Math.round((resolvedTickets / totalTickets) * 100) : 0,
      avgResolutionTime: avgResolutionTimeStr,
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
        agentStatus: agentHealthy ? "Operational" : "Not Configured",
        agentHealthy,
        erpSync,
        erpHealthy,
        kbDocs: kbDocsCount > 0 ? `${kbDocsCount} Ready Document${kbDocsCount > 1 ? "s" : ""} Scoped` : "No Ready Documents",
        lastEscalation: lastEscalationTicket
          ? `${timeAgo(lastEscalationTicket.updatedAt)} - ${lastEscalationTicket.status === "RESOLVED" ? "resolved by staff" : "escalated to staff"}`
          : "No escalations yet"
      }
    };

    return res.json(stats);
  } catch (error) {
    console.error("Dashboard stats error:", error);
    return res.status(500).json({ message: "Error fetching stats" });
  }
};
