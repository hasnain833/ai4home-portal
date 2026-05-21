import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { syncTicketToERP } from "@/lib/erp-service";

// Helper to check authentication
function isAuthorized(request: Request): boolean {
  const url = new URL(request.url);
  const secretParam = url.searchParams.get("secret");
  const authHeader = request.headers.get("authorization");
  const apiKeyHeader = request.headers.get("x-api-key");

  const secret = process.env.BOTPRESS_API_SECRET || process.env.SESSION_SECRET || "super_secret_key_change_me_in_production";

  if (secretParam === secret) return true;
  if (apiKeyHeader === secret) return true;
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (token === secret) return true;
  }

  return false;
}

export async function POST(request: Request) {
  try {
    // 1. Verify Authentication
    if (!isAuthorized(request)) {
      return NextResponse.json({ message: "Unauthorized integration request" }, { status: 401 });
    }

    const body = await request.json();
    const { 
      ticketId, 
      conversationId, 
      status, 
      priority, 
      isEmergency, 
      messages = [],
      draftResponse
    } = body;

    if (!ticketId && !conversationId) {
      return NextResponse.json({ 
        message: "Either ticketId or conversationId must be specified to perform sync operations" 
      }, { status: 400 });
    }

    // 2. Resolve Ticket & Conversation records
    let conversation = null;
    let ticket = null;

    if (conversationId) {
      conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { ticket: true }
      });
      if (conversation) {
        ticket = conversation.ticket;
      }
    }

    if (!ticket && ticketId) {
      ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: { conversation: true }
      });
      if (ticket) {
        conversation = ticket.conversation;
      }
    }

    // Ensure we have a conversation linked
    if (!ticket) {
      return NextResponse.json({ 
        message: `Ticket record could not be resolved from inputs. Verify ticketId (${ticketId}) or conversationId (${conversationId})` 
      }, { status: 404 });
    }

    // If a conversation doesn't exist yet for this ticket, let's create one on the fly!
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          ticketId: ticket.id,
          homeownerId: ticket.homeownerId
        }
      });
    }

    // 3. Update Ticket Flags if specified
    const updatedData: any = {};
    if (status) updatedData.status = status;
    if (priority) updatedData.priority = priority;
    if (isEmergency !== undefined) {
      updatedData.isEmergency = !!isEmergency;
      if (isEmergency) {
        updatedData.priority = "URGENT";
        updatedData.status = "ESCALATED";
      }
    }
    if (draftResponse !== undefined) {
      updatedData.draftResponse = draftResponse;
    }

    if (Object.keys(updatedData).length > 0) {
      ticket = await prisma.ticket.update({
        where: { id: ticket.id },
        data: updatedData
      });

      // If synced to ERP or needed, trigger ERP synchronization to keep platforms unified
      if (ticket.erpSyncStatus === "SYNCED" || status === "RESOLVED") {
        try {
          await syncTicketToERP(ticket.id);
        } catch (erpError) {
          console.error(`[Orchestration Sync] Automated ERP sync update failed for Ticket #${ticket.id}:`, erpError);
        }
      }
    }

    // 4. Save message transcripts
    let syncedMessagesCount = 0;
    if (messages && Array.isArray(messages) && messages.length > 0) {
      const chatMessagesData = messages.map((msg: any) => ({
        conversationId: conversation.id,
        role: msg.role === "assistant" || msg.role === "bot" ? "assistant" : "user",
        content: msg.content || msg.text || "",
        timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date()
      }));

      await prisma.chatMessage.createMany({
        data: chatMessagesData
      });
      syncedMessagesCount = chatMessagesData.length;
    }

    return NextResponse.json({
      success: true,
      ticketId: ticket.id,
      conversationId: conversation.id,
      ticketStatus: ticket.status,
      ticketPriority: ticket.priority,
      isEmergency: ticket.isEmergency,
      syncedMessagesCount
    });

  } catch (error: any) {
    console.error("[Orchestration Sync] Error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
