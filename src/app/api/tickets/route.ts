import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const homeownerId = searchParams.get("homeownerId");

    const tickets = await prisma.ticket.findMany({
      where: homeownerId ? { homeownerId } : {},
      include: {
        homeowner: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json(tickets);
  } catch (error) {
    console.error("Failed to fetch tickets:", error);
    return NextResponse.json(
      { message: "Failed to fetch tickets" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const data = await request.json();
    const { issueType, address, homeownerId, priority, warrantyYear } = data;

    const ticket = await prisma.ticket.create({
      data: {
        issueType,
        address,
        homeownerId,
        priority: priority || "MEDIUM",
        warrantyYear: warrantyYear || 1,
        status: "OPEN",
      },
    });

    return NextResponse.json(ticket);
  } catch (error) {
    console.error("Failed to create ticket:", error);
    return NextResponse.json(
      { message: "Failed to create ticket" },
      { status: 500 }
    );
  }
}
