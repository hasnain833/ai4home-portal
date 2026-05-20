import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { calculateWarrantyYear } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const data = await request.json();
    const { 
      email, 
      propertyId, 
      issueType, 
      description, 
      isEmergency = false, 
      priority, 
      messages = [] 
    } = data;

    if (!email || !issueType || !description) {
      return NextResponse.json(
        { message: "email, issueType, and description are required fields" },
        { status: 400 }
      );
    }

    // 1. Resolve homeowner
    const homeowner = await prisma.user.findUnique({
      where: { email },
      include: { properties: true }
    });

    if (!homeowner) {
      return NextResponse.json(
        { message: `Homeowner with email ${email} not found` },
        { status: 404 }
      );
    }

    // 2. Resolve property
    let selectedPropertyId = propertyId;
    let warrantyYear = 1;

    if (!selectedPropertyId && homeowner.properties.length > 0) {
      // Default to homeowner's first property if not specified
      selectedPropertyId = homeowner.properties[0].id;
    }

    if (selectedPropertyId) {
      const property = homeowner.properties.find(p => p.id === selectedPropertyId) 
        || await prisma.property.findUnique({ where: { id: selectedPropertyId } });
        
      if (property && property.coeDate) {
        warrantyYear = calculateWarrantyYear(property.coeDate);
      }
    }

    // 3. Resolve ticket priority
    let ticketPriority = priority || "MEDIUM";
    if (isEmergency) {
      ticketPriority = "URGENT";
    }

    // 4. Create the Ticket
    const ticket = await prisma.ticket.create({
      data: {
        issueType,
        propertyId: selectedPropertyId || null,
        homeownerId: homeowner.id,
        isEmergency,
        priority: ticketPriority,
        warrantyYear,
        erpSyncStatus: "PENDING"
      }
    });

    // 5. Create linked conversation transcript
    const conversation = await prisma.conversation.create({
      data: {
        ticketId: ticket.id,
        homeownerId: homeowner.id,
      }
    });

    // 6. Save message transcripts if provided
    if (messages && Array.isArray(messages) && messages.length > 0) {
      // Add initial description message as a system note or user message if not already present
      const chatMessagesData = messages.map((msg: any) => ({
        conversationId: conversation.id,
        role: msg.role === "assistant" || msg.role === "bot" ? "assistant" : "user",
        content: msg.content || msg.text || "",
        timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date()
      }));

      await prisma.chatMessage.createMany({
        data: chatMessagesData
      });
    } else {
      // Fallback: create a single chat message containing the ticket description
      await prisma.chatMessage.create({
        data: {
          conversationId: conversation.id,
          role: "user",
          content: description
        }
      });
    }

    console.log(`[BOTPRESS INTEGRATION] Ticket #${ticket.id} generated successfully for ${email}`);

    return NextResponse.json({
      success: true,
      message: "Ticket and conversation transcript generated successfully",
      ticketId: ticket.id,
      warrantyYear
    });

  } catch (error) {
    console.error("Botpress ticket generation error:", error);
    return NextResponse.json(
      { message: "Internal server error during ticket generation" },
      { status: 500 }
    );
  }
}
