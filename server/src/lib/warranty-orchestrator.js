import { toolCall } from "./llm.js";
import prisma from "./prisma.js";
import { queryDetailed as kbQueryDetailed } from "../services/warranty-vector.service.js";
import {
  INTAKE_SYSTEM_PROMPT,
  IDENTIFY_SYSTEM_PROMPT,
  DIAGNOSTIC_SYSTEM_PROMPT,
  RESOLUTION_SYSTEM_PROMPT,
  COMPLIANCE_MONITOR_PROMPT,
  COMPLIANCE_REVIEW_TEMPLATE,
  renderTemplate,
} from "../prompts/index.js";

const ORCHESTRATOR_TOOLS = {
  RESPOND: {
    name: "respond",
    description: "Reply to the homeowner.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "The message to send to the homeowner." },
        transition_phase: { type: "string", enum: ["STAY", "IDENTIFY", "DIAGNOSE", "RESOLVE"], description: "Whether to transition to the next phase if the current phase's goal is met." }
      },
      required: ["message", "transition_phase"],
    },
  },
  LOOKUP_PROPERTY: {
    name: "lookup_property",
    description: "Lookup a property by address or name.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The address or name to search for." },
      },
      required: ["query"],
    },
  },
  CREATE_TICKET: {
    name: "create_ticket",
    description: "Create a warranty ticket.",
    input_schema: {
      type: "object",
      properties: {
        issue_summary: { type: "string", description: "Summary of the issue." },
      },
      required: ["issue_summary"],
    },
  },
  ESCALATE_EMERGENCY: {
    name: "escalate_emergency",
    description: "Escalate immediately for a life-safety emergency.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Reason for emergency escalation." },
      },
      required: ["reason"],
    },
  }
};

function toAnthropicMessages(transcript) {
  const msgs = [];
  for (const t of transcript) {
    const role = t.role === "agent" ? "assistant" : "user";
    const last = msgs[msgs.length - 1];
    if (last && last.role === role) last.content += `\n${t.content}`;
    else msgs.push({ role, content: t.content });
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  return msgs;
}

async function fileTicket({ companyId, homeownerId, propertyId, issueType, description, isEmergency = false }) {
  if (!homeownerId) return null;
  return prisma.ticket.create({
    data: {
      companyId,
      homeownerId,
      propertyId: propertyId || null,
      issueType,
      description,
      isEmergency,
      status: "OPEN",
    },
  });
}

export async function processWarrantyTurn({ company, convo, newMsg }) {
  const transcript = [...(convo.transcript || []), { role: "user", content: newMsg, at: new Date().toISOString() }];
  const messages = toAnthropicMessages(transcript);

  let currentPhase = convo.phase || "INTAKE";
  let ticketId = convo.ticketId || null;
  let homeownerId = convo.homeownerId || null;
  let propertyId = convo.propertyId || null;

  // Which community's documents apply. Resolved from the identified property, so
  // it is null until the homeowner has been identified — at which point only
  // shared documents are eligible, never another community's rules.
  let communityId = null;
  if (propertyId) {
    const prop = await prisma.property
      .findUnique({ where: { id: propertyId }, select: { communityId: true } })
      .catch(() => null);
    communityId = prop?.communityId || null;
  }
  let systemPromptTemplate = "";
  let tool = ORCHESTRATOR_TOOLS.RESPOND;
  let kbContext = "";

  // 2. Select Agent based on Phase
  if (currentPhase === "INTAKE") {
    systemPromptTemplate = INTAKE_SYSTEM_PROMPT;
  } else if (currentPhase === "IDENTIFY") {
    systemPromptTemplate = IDENTIFY_SYSTEM_PROMPT;
    tool = {
      name: "identify_tools",
      description: "Respond or lookup property.",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["respond", "lookup_property"] },
          message: { type: "string", description: "Message to send." },
          query: { type: "string", description: "Email address or property address for lookup." }
        },
        required: ["action"]
      }
    };
  } else if (currentPhase === "DIAGNOSE") {
    systemPromptTemplate = DIAGNOSTIC_SYSTEM_PROMPT;
    tool = {
      name: "diagnose_tools",
      description: "Respond or escalate emergency.",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["respond", "escalate_emergency"] },
          message: { type: "string", description: "Message to send." },
          transition_phase: { type: "string", enum: ["STAY", "RESOLVE"] },
          emergency_reason: { type: "string", description: "Reason for escalation." }
        },
        required: ["action", "message"]
      }
    };

    // RAG Lookup
    const q = newMsg.trim();
    if (q) {
      try {
        const { results } = await kbQueryDetailed(company.id, q, 3, null, communityId);
        if (results && results.length > 0) {
          kbContext = results.map((r, i) => `[${i + 1}] ${r.name}: ${r.text}`).join("\n\n");
        } else {
          kbContext = "No specific context found.";
        }
      } catch (e) {
        console.error("KB retrieval failed:", e);
        kbContext = "Knowledge base currently unavailable.";
      }
    }
  } else if (currentPhase === "RESOLVE") {
    systemPromptTemplate = RESOLUTION_SYSTEM_PROMPT;
    tool = {
      name: "resolve_tools",
      description: "Respond or create ticket.",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["respond", "create_ticket"] },
          message: { type: "string", description: "Message to send." },
          issue_summary: { type: "string", description: "Summary for ticket." }
        },
        required: ["action"]
      }
    };
  }

  const system = renderTemplate(systemPromptTemplate, {
    companyName: company.name,
    issueState: JSON.stringify(convo.issueState || {}),
    kbContext,
  });

  // 3. Execute LLM Turn
  const input = await toolCall({
    companyId: company.id,
    system,
    messages,
    tool,
    maxTokens: 500,
  });

  if (!input) {
    return { reply: "I'm having trouble connecting to my system. Please try again in a moment." };
  }

  let replyText = input.message || "";
  let nextPhase = currentPhase;

  // 4. Handle Tool Outcomes & State Transitions
  if (currentPhase === "INTAKE") {
    if (input.transition_phase === "IDENTIFY") {
      nextPhase = "IDENTIFY";
    } else {
      // Auto transition to identify if message length suggests they provided issue
      if (messages.length > 1) {
        nextPhase = "IDENTIFY";
      }
    }
  } else if (currentPhase === "IDENTIFY") {
    if (input.action === "lookup_property" && !String(input.query || "").trim()) {
      replyText = input.message || "Could you share the email address on your warranty file so I can locate your property?";
    } else if (input.action === "lookup_property") {
      // Look up by address or email
      const properties = await prisma.property.findMany({
        where: {
          companyId: company.id,
          OR: [
            { address: { contains: input.query, mode: 'insensitive' } },
            { homeowner: { email: { equals: input.query, mode: 'insensitive' } } }
          ]
        }
      });

      if (properties.length === 1) {
        replyText = `Thanks! I've located your property at ${properties[0].address}. To help me diagnose the issue you mentioned earlier, could you provide a few more details (like when it started or if there's any visible damage)?`;
        propertyId = properties[0].id;
        homeownerId = properties[0].homeownerId;
        communityId = properties[0].communityId || null;
        await prisma.warrantyConversation.update({
          where: { id: convo.id },
          data: { propertyId, homeownerId }
        });
        nextPhase = "DIAGNOSE";
      } else if (properties.length > 1) {
        const propList = properties.map((p, i) => `${i + 1}. ${p.address}`).join("\n");
        replyText = `I found multiple properties associated with that info. Which one is experiencing the issue?\n${propList}`;
      } else {
        replyText = `I couldn't find a property matching "${input.query}". Could you double-check the email address?`;
      }
    } else if (input.transition_phase === "DIAGNOSE") {
      nextPhase = "DIAGNOSE";
    }
  } else if (currentPhase === "DIAGNOSE") {
    if (input.action === "escalate_emergency") {
      const ticket = await fileTicket({
        companyId: company.id,
        homeownerId,
        propertyId,
        issueType: "Emergency",
        isEmergency: true,
        description: input.emergency_reason || "Emergency reported during diagnosis.",
      });
      if (ticket) {
        ticketId = ticket.id;
        replyText = input.message + `\n\nI have immediately logged an emergency ticket (Ticket #${ticket.id.slice(-6)}) for our team.`;
      } else {
        replyText = input.message + `\n\nIf anyone is in immediate danger, call 911 now. I have flagged this conversation as an emergency for our warranty team — please reply with your email address so I can file the ticket against your property.`;
      }
      nextPhase = ticket ? "RESOLVE" : "IDENTIFY";
      await prisma.warrantyConversation.update({
        where: { id: convo.id },
        data: { ...(ticketId ? { ticketId } : {}), status: "ESCALATED" }
      });
    } else if (input.transition_phase === "RESOLVE") {
      nextPhase = "RESOLVE";
    }
  } else if (currentPhase === "RESOLVE") {
    if (input.action === "create_ticket") {
      const ticket = await fileTicket({
        companyId: company.id,
        homeownerId,
        propertyId,
        issueType: "General Warranty",
        description: input.issue_summary,
      });
      if (ticket) {
        ticketId = ticket.id;
        replyText = `I've logged a ticket for your issue (Ticket #${ticket.id.slice(-6)}). Our warranty team will be in touch soon.`;
        await prisma.warrantyConversation.update({
          where: { id: convo.id },
          data: { ticketId, status: "RESOLVED" }
        });
      } else {
        replyText = `I have everything I need about the issue. Before I can log it, could you share the email address on your warranty file so I can attach it to the right property?`;
        nextPhase = "IDENTIFY";
      }
    }
  }

  if (!replyText) {
    replyText = "I'm sorry, I didn't quite catch that. Could you please rephrase?";
  }

  const safetyCheck = await toolCall({
    companyId: company.id,
    system: COMPLIANCE_MONITOR_PROMPT,
    messages: [
      { role: "user", content: renderTemplate(COMPLIANCE_REVIEW_TEMPLATE, { message: replyText }) }
    ],
    tool: {
      name: "safety_verdict",
      description: "Verdict on message safety.",
      input_schema: {
        type: "object",
        properties: {
          is_safe: { type: "boolean" },
          is_emergency: { type: "boolean", description: "Does the situation indicate a life-safety emergency?" },
          reason: { type: "string" },
          corrected_message: { type: "string", description: "If unsafe or emergency, provide a safe alternative message." }
        },
        required: ["is_safe"]
      }
    },
    maxTokens: 200,
  });

  if (safetyCheck && (!safetyCheck.is_safe || safetyCheck.is_emergency) && safetyCheck.corrected_message) {
    console.warn(`[Warranty Agent] Safety gate triggered: ${safetyCheck.reason}`);
    replyText = safetyCheck.corrected_message;
    
    if (safetyCheck.is_emergency && !ticketId) {
      const ticket = await fileTicket({
        companyId: company.id,
        homeownerId,
        propertyId,
        issueType: "Emergency",
        isEmergency: true,
        description: safetyCheck.reason || "Emergency detected by safety gate.",
      });
      if (ticket) {
        ticketId = ticket.id;
        replyText += `\n\nI have also immediately logged an emergency ticket (Ticket #${ticket.id.slice(-6)}) for our warranty team.`;
      } else {
        replyText += `\n\nIf anyone is in immediate danger, call 911 now. I have flagged this conversation as an emergency for our warranty team — please reply with your email address so I can file the ticket against your property.`;
      }
      nextPhase = ticket ? "RESOLVE" : "IDENTIFY";
      await prisma.warrantyConversation.update({
        where: { id: convo.id },
        data: { ...(ticketId ? { ticketId } : {}), status: "ESCALATED" }
      });
    }
  }

  const finalTranscript = [...transcript, { role: "agent", content: replyText, at: new Date().toISOString() }];
  await prisma.warrantyConversation.update({
    where: { id: convo.id },
    data: {
      transcript: finalTranscript,
      phase: nextPhase,
      turnCount: { increment: 1 }
    }
  });

  return { reply: replyText, phase: nextPhase };
}