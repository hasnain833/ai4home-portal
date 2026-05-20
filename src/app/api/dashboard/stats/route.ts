import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "@/lib/session";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(request);
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
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
      recentTickets
    ] = await Promise.all([
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
        include: { homeowner: { select: { name: true } } }
      })
    ]);

    // Calculate avg resolution time in days
    let avgDays = 0;
    if (resolvedTicketsData.length > 0) {
      const totalTime = resolvedTicketsData.reduce((acc, t) => {
        return acc + (t.updatedAt.getTime() - t.createdAt.getTime());
      }, 0);
      avgDays = totalTime / resolvedTicketsData.length / (1000 * 60 * 60 * 24);
    }

    const stats = {
      totalTickets,
      openTickets,
      inProgressTickets,
      escalatedTickets,
      resolvedThisWeek,
      resolutionRate: totalTickets > 0 ? Math.round((resolvedTickets / totalTickets) * 100) : 0,
      avgResolutionTime: avgDays > 0 ? `${avgDays.toFixed(1)} days` : "N/A",
      tokenConsumption: totalTickets * 1250, // Simulated: avg 1250 tokens per ticket lifecycle
      recentTickets: recentTickets.map(t => ({
        id: t.id,
        homeowner: t.homeowner?.name || "Unknown",
        issue: t.issueType,
        status: t.status,
        date: t.createdAt
      }))
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error("Dashboard stats error:", error);
    return NextResponse.json({ message: "Error fetching stats" }, { status: 500 });
  }
}

