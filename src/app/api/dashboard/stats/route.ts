import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    // Fetch stats in parallel
    const [
      totalTickets,
      openTickets,
      inProgressTickets,
      resolvedTickets,
      escalatedTickets,
      recentTickets
    ] = await Promise.all([
      prisma.ticket.count(),
      prisma.ticket.count({ where: { status: "OPEN" } }),
      prisma.ticket.count({ where: { status: "IN_PROGRESS" } }),
      prisma.ticket.count({ where: { status: "RESOLVED" } }),
      prisma.ticket.count({ where: { status: "ESCALATED" } }),
      prisma.ticket.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        include: { homeowner: { select: { name: true } } }
      })
    ]);

    const stats = {
      totalTickets,
      openTickets,
      inProgressTickets,
      escalatedTickets,
      resolvedThisWeek: 0, // Default to 0
      resolutionRate: totalTickets > 0 ? Math.round((resolvedTickets / totalTickets) * 100) : 0,
      avgResolutionTime: "2.4 days", // Mock for now until we add logic to calculate from DB
      tokenConsumption: 0, // Default to 0
      recentTickets: recentTickets.map(t => ({
        id: t.id,
        homeowner: t.homeowner?.name || "Unknown",
        issue: t.issueType,
        status: t.status.toLowerCase(),
        date: t.createdAt
      }))
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error("Dashboard stats error:", error);
    return NextResponse.json({ message: "Error fetching stats" }, { status: 500 });
  }
}
