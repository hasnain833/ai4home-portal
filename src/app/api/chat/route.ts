import { NextResponse } from "next/server";
import { AIService, ChatMessage } from "@/lib/ai-service";
import prisma from "@/lib/prisma";
import { calculateWarrantyYear } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const { messages, companyId, homeownerId, conversationId } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ message: "Invalid messages" }, { status: 400 });
    }

    const lastUserMessage = messages[messages.length - 1];
    
    // 1. Get AI Response
    const response = await AIService.getChatResponse(messages, companyId || "demo-company");

    // 2. Persist Transcript (FR-17)
    if (homeownerId) {
      let conversation;
      
      if (conversationId) {
        conversation = await prisma.conversation.findUnique({
          where: { id: conversationId }
        });
      }

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: { homeownerId }
        });
      }

      // Store the last exchange
      await prisma.chatMessage.createMany({
        data: [
          {
            conversationId: conversation.id,
            role: lastUserMessage.role,
            content: lastUserMessage.content
          },
          {
            conversationId: conversation.id,
            role: "assistant",
            content: response.content
          }
        ]
      });

      let newTicket = null;
      if (response.createTicket) {
        // Find property to calculate warranty year
        const property = await prisma.property.findFirst({
          where: { homeownerId }
        });
        
        const warrantyYear = property ? calculateWarrantyYear(property.coeDate) : 1;

        newTicket = await prisma.ticket.create({
          data: {
            issueType: response.issueSummary || "General Issue",
            homeownerId,
            propertyId: property?.id,
            conversation: {
              connect: { id: conversation.id }
            },
            status: response.isEmergency ? "ESCALATED" : "OPEN",
            priority: response.isEmergency ? "URGENT" : "MEDIUM",
            isEmergency: response.isEmergency || false,
            warrantyYear,
          }
        });

        // Add a system message notifying user
        await prisma.chatMessage.create({
          data: {
            conversationId: conversation.id,
            role: "system",
            content: `Ticket #${newTicket.id} has been automatically generated for this issue.`
          }
        });
      }

      // Include conversationId and ticket info in response
      return NextResponse.json({ 
        ...response, 
        conversationId: conversation.id,
        ticketCreated: !!newTicket,
        ticketId: newTicket?.id
      });
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
