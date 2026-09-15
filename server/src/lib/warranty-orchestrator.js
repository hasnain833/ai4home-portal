import { toolCall } from "./llm.js";
import prisma from "./prisma.js";
import { queryDetailed as kbQueryDetailed } from "../services/warranty-vector.service.js";
import { getCoverageStatus, describeCoverage, COVERAGE } from "./coverage.js";
import { classifyClaim } from "./warranty-classify.js";
import { createWarrantyTicket, escalateWarrantyTicket, ticketUrlFor } from "./warranty-ticket.js";
import {
  INTAKE_SYSTEM_PROMPT,
  IDENTIFY_SYSTEM_PROMPT,
  DIAGNOSTIC_SYSTEM_PROMPT,
  RESOLUTION_SYSTEM_PROMPT,
  COMPLIANCE_MONITOR_PROMPT,
  COMPLIANCE_REVIEW_TEMPLATE,
  KB_EMPTY_CONTEXT,
  renderTemplate,
} from "../prompts/index.js";

const MAX_TRACKED_KB_REFS = 12;

const KB_PASSAGES = 8;

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

function recentContext(transcript, turns = 6) {
  return (transcript || [])
    .slice(-turns)
    .map((t) => `${t.role === "agent" ? "Assistant" : "Homeowner"}: ${String(t.content || "").trim()}`)
    .join("\n");
}

export function matchPropertyChoice(message, choices) {
  const list = Array.isArray(choices) ? choices : [];
  if (list.length === 0) return null;

  const raw = String(message || "").trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();

  const exact = list.find((c) => String(c.address || "").trim().toLowerCase() === lower);
  if (exact) return exact;

  const numeric = raw.match(/^\s*(?:#|option\s*|number\s*|no\.?\s*)?(\d{1,2})\b/i);
  if (numeric) {
    const index = Number(numeric[1]) - 1;
    if (index >= 0 && index < list.length) return list[index];
  }

  const byAddress = list.filter((c) => {
    const address = String(c.address || "").toLowerCase();
    if (!address) return false;
    if (lower.includes(address)) return true;
    return lower.length >= 4 && address.includes(lower);
  });
  if (byAddress.length === 1) return byAddress[0];

  const streetNumber = lower.match(/\b(\d{1,6})\b/);
  if (streetNumber) {
    const hits = list.filter((c) => String(c.address || "").startsWith(streetNumber[1]));
    if (hits.length === 1) return hits[0];
  }

  return null;
}

function trackKbRefs(issueState, results) {
  const existing = Array.isArray(issueState.kbRefs) ? issueState.kbRefs : [];
  const seen = new Set(existing.map((r) => r.documentId));
  const merged = [...existing];

  for (const r of results || []) {
    if (!r?.documentId || seen.has(r.documentId)) continue;
    seen.add(r.documentId);
    merged.push({
      documentId: r.documentId,
      name: r.name || "",
      category: r.category || null,
      scope: r.scope || null,
    });
  }

  issueState.kbRefs = merged.slice(-MAX_TRACKED_KB_REFS);
}

async function retrieveContext({ companyId, question, communityId, issueState, includeSandbox = false }) {
  const q = String(question || "").trim();
  if (!q) return { context: KB_EMPTY_CONTEXT, results: [] };

  try {
    const { results } = await kbQueryDetailed(companyId, q, KB_PASSAGES, null, communityId, includeSandbox);
    if (results && results.length > 0) {
      trackKbRefs(issueState, results);
      return {
        context: results.map((r, i) => `[${i + 1}] ${r.name}: ${r.text}`).join("\n\n"),
        results,
      };
    }
    return { context: KB_EMPTY_CONTEXT, results: [] };
  } catch (e) {
    console.error("KB retrieval failed:", e);
    return { context: KB_EMPTY_CONTEXT, results: [] };
  }
}

function claimLine(isEmergency) {
  return isEmergency
    ? `Your issue has been recorded and flagged as urgent. Our warranty team will contact you as soon as possible.`
    : `Your issue has been recorded. Our warranty team will review it and contact you with next steps shortly.`;
}

async function fileClaim({
  company,
  convo,
  transcript,
  issueState,
  homeownerId,
  propertyId,
  description,
  forceEmergency = false,
  sandboxMode = false,
}) {
  const classification = await classifyClaim({
    companyId: company.id,
    description,
    context: recentContext(transcript),
  });

  if (forceEmergency) classification.isEmergency = true;
  if (classification.isEmergency) classification.priority = "URGENT";

  issueState.issueSummary = classification.summary;
  issueState.issueType = classification.issueType;
  issueState.priority = classification.priority;
  issueState.symptom = classification.symptom;
  issueState.location = classification.location;
  issueState.isEmergency = classification.isEmergency;
  issueState.classifiedAt = new Date().toISOString();

  // The lab must not write. Classification still runs — judging how an issue is
  // categorised and prioritised is most of what a tester is here for — but it
  // stops short of creating a ticket, emailing the homeowner, or updating the
  // conversation row, which does not exist for the sandbox's synthetic id.
  //
  // The homeowner gate is mirrored rather than skipped: "share the email on your
  // file first" is a real branch, and a sandbox that always files would never
  // show it.
  if (sandboxMode) {
    const homeowner = homeownerId
      ? await prisma.user.findUnique({ where: { id: homeownerId }, select: { id: true } })
      : null;
    if (!homeowner) return { filed: null, classification };

    return {
      filed: { sandbox: true },
      classification,
      line: claimLine(classification.isEmergency),
      // Deliberately null: nothing was created, so there is no ticket for a
      // later turn to escalate.
      ticketId: null,
    };
  }

  const filed = await createWarrantyTicket({
    companyId: company.id,
    homeownerId,
    propertyId,
    classification,
    description,
    transcript,
    kbRefs: issueState.kbRefs,
    coverage: issueState.coverage,
  });

  if (!filed) return { filed: null, classification };

  const { ticket } = filed;

  await prisma.warrantyConversation.update({
    where: { id: convo.id },
    data: {
      ticketId: ticket.id,
      status: ticket.isEmergency ? "ESCALATED" : "RESOLVED",
    },
  });

  return { filed, classification, line: claimLine(ticket.isEmergency), ticketId: ticket.id };
}

const NEEDS_IDENTITY =
  "I have everything I need about the issue. Before I can log it, could you share the email address on your warranty file so I can attach it to the right property?";

const EMERGENCY_NO_IDENTITY =
  "If anyone is in immediate danger, call 911 now. I have flagged this conversation as an emergency for our warranty team — please reply with your email address so I can file the ticket against your property.";

export async function processWarrantyTurn({ company, convo, newMsg, sandboxMode = false, draftPrompts = null, sandboxCommunityId = null }) {
  const transcript = [...(convo.transcript || []), { role: "user", content: newMsg, at: new Date().toISOString() }];
  const messages = toAnthropicMessages(transcript);

  let currentPhase = convo.phase || "INTAKE";
  let ticketId = convo.ticketId || null;
  let homeownerId = convo.homeownerId || null;
  let propertyId = convo.propertyId || null;
  const issueState = { ...(convo.issueState || {}) };
  let communityId = null;
  let property = null;
  let kbHits = [];
  let turnOptions = [];

  const kbCompanyId = sandboxMode ? (sandboxCommunityId ? company.id : null) : company.id;
  if (sandboxMode && sandboxCommunityId) {
    communityId = sandboxCommunityId;
  }
  if (propertyId) {
    property = await prisma.property.findUnique({ where: { id: propertyId } }).catch(() => null);
    communityId = property?.communityId || null;
  }

  const adoptProperty = async (chosen) => {
    property = chosen;
    propertyId = chosen.id;
    homeownerId = chosen.homeownerId;
    communityId = chosen.communityId || null;

    const coverage = getCoverageStatus(chosen);
    issueState.coverage = {
      status: coverage.status,
      endDate: coverage.endDate ? coverage.endDate.toISOString() : null,
      daysRemaining: coverage.daysRemaining,
    };
    issueState.propertyAddress = chosen.address || null;
    delete issueState.propertyChoices;

    if (!sandboxMode) {
      await prisma.warrantyConversation.update({
        where: { id: convo.id },
        data: { propertyId, homeownerId, issueState },
      });
    }

    return coverage;
  };


  const finish = async (replyText, nextPhase) => {
    const finalTranscript = [...transcript, { role: "agent", content: replyText, at: new Date().toISOString() }];
    if (!sandboxMode) {
      await prisma.warrantyConversation.update({
        where: { id: convo.id },
        data: {
          transcript: finalTranscript,
          phase: nextPhase,
          issueState,
          turnCount: { increment: 1 },
        },
      });
    }
    return { reply: replyText, phase: nextPhase, kbHits, options: turnOptions };
  };

  if (currentPhase === "IDENTIFY" && Array.isArray(issueState.propertyChoices)) {
    const choice = matchPropertyChoice(newMsg, issueState.propertyChoices);
    if (choice) {
      const chosen = await prisma.property.findUnique({ where: { id: choice.id } }).catch(() => null);
      if (chosen && chosen.companyId === company.id) {
        const coverage = await adoptProperty(chosen);
        const coverageLine = describeCoverage(coverage);
        const reply = [
          `Thanks — I've got your home at ${chosen.address}.`,
          coverageLine,
          "Could you tell me a bit more about the issue: where in the home it is, and when you first noticed it?",
        ].filter(Boolean).join(" ");
        return finish(reply, "DIAGNOSE");
      }
    }
  }

  let systemPromptTemplate = "";
  let tool = ORCHESTRATOR_TOOLS.RESPOND;
  let kbContext = "";

  // Phase prompts: use draftPrompts from the lab if provided, else the shipped defaults.
  const phasePrompts = {
    INTAKE:   (draftPrompts?.INTAKE   ?? INTAKE_SYSTEM_PROMPT),
    IDENTIFY: (draftPrompts?.IDENTIFY ?? IDENTIFY_SYSTEM_PROMPT),
    DIAGNOSE: (draftPrompts?.DIAGNOSE ?? DIAGNOSTIC_SYSTEM_PROMPT),
    RESOLVE:  (draftPrompts?.RESOLVE  ?? RESOLUTION_SYSTEM_PROMPT),
  };

  // 2. Select Agent based on Phase
  if (currentPhase === "INTAKE") {
    systemPromptTemplate = phasePrompts.INTAKE;
  } else if (currentPhase === "IDENTIFY") {
    systemPromptTemplate = phasePrompts.IDENTIFY;
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
    systemPromptTemplate = phasePrompts.DIAGNOSE;
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

    ({ context: kbContext, results: kbHits } = await retrieveContext({
      includeSandbox: sandboxMode,
      companyId: kbCompanyId,
      question: newMsg,
      communityId,
      issueState,
    }));
  } else if (currentPhase === "RESOLVE") {
    systemPromptTemplate = phasePrompts.RESOLVE;
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
    ({ context: kbContext, results: kbHits } = await retrieveContext({
      includeSandbox: sandboxMode,
      companyId: kbCompanyId,
      question: newMsg,
      communityId,
      issueState,
    }));
  }

  const system = renderTemplate(systemPromptTemplate, {
    companyName: company.name,
    issueState: JSON.stringify(issueState || {}),
    kbContext,
    coverageStatus: issueState.coverage?.status || COVERAGE.UNKNOWN,
  });

  const input = await toolCall({
    companyId: company.id,
    system,
    messages,
    tool,
    maxTokens: 900,
    temperature: 0.2,
  });

  if (!input) {
    return {
      reply: "I'm having trouble connecting to my system. Please try again in a moment.",
      kbHits,
      options: turnOptions,
    };
  }

  let replyText = input.message || "";
  let nextPhase = currentPhase;

  if (currentPhase === "INTAKE") {
    if (!issueState.issueSummary && newMsg.trim().length > 12) {
      issueState.issueSummary = newMsg.trim().slice(0, 600);
    }
    if (input.transition_phase === "IDENTIFY") {
      nextPhase = "IDENTIFY";
    } else if (input.transition_phase !== "STAY" && issueState.issueSummary) {
      nextPhase = "IDENTIFY";
    }
  } else if (currentPhase === "IDENTIFY") {
    if (input.action === "lookup_property" && !String(input.query || "").trim()) {
      replyText = input.message || "Could you share the email address on your warranty file so I can locate your property?";
    } else if (input.action === "lookup_property") {
      const properties = await prisma.property.findMany({
        where: {
          companyId: company.id,
          OR: [
            { address: { contains: input.query, mode: 'insensitive' } },
            { homeowner: { email: { equals: input.query, mode: 'insensitive' } } }
          ]
        },
        orderBy: { createdAt: "desc" },
      });

      if (properties.length === 1) {
        const coverage = await adoptProperty(properties[0]);
        const coverageLine = describeCoverage(coverage);
        replyText = [
          `Thanks! I've located your property at ${properties[0].address}.`,
          coverageLine,
          "To help me understand the issue, could you tell me where in the home it is and when it started?",
        ].filter(Boolean).join(" ");
        nextPhase = "DIAGNOSE";
      } else if (properties.length > 1) {
        issueState.propertyChoices = properties.map((p) => ({ id: p.id, address: p.address }));
        turnOptions = properties.map((p) => p.address);
        replyText = "I found multiple properties associated with that info. Which one is experiencing the issue?";
      } else {
        replyText = `I couldn't find a property matching "${input.query}". Could you double-check the email address on your warranty file?`;
      }
    } else if (input.transition_phase === "DIAGNOSE") {
      nextPhase = "DIAGNOSE";
    }
  } else if (currentPhase === "DIAGNOSE") {
    if (input.action === "escalate_emergency") {
      const reason = input.emergency_reason || "Emergency reported during diagnosis.";

      if (ticketId && !sandboxMode) {
        await escalateWarrantyTicket(ticketId, { reason });
        replyText = `${input.message}\n\nI've escalated your existing ticket (${ticketId}) to our emergency queue.`;
        nextPhase = "RESOLVE";
      } else {
        const result = await fileClaim({
          company,
          convo,
          transcript,
          issueState,
          homeownerId,
          propertyId,
          sandboxMode,
          description: reason,
          forceEmergency: true,
        });

        if (result.filed) {
          ticketId = result.ticketId;
          replyText = `${input.message}\n\n${result.line}`;
          nextPhase = "RESOLVE";
        } else {
          replyText = `${input.message}\n\n${EMERGENCY_NO_IDENTITY}`;
          nextPhase = "IDENTIFY";
          if (!sandboxMode) {
            await prisma.warrantyConversation.update({
              where: { id: convo.id },
              data: { status: "ESCALATED" },
            });
          }
        }
      }
    } else if (input.transition_phase === "RESOLVE") {
      nextPhase = "RESOLVE";
    }
  } else if (currentPhase === "RESOLVE") {
    if (input.action === "create_ticket" && ticketId) {
      replyText =
        `Your issue has already been recorded. Our warranty team will be in touch with you shortly.`;
    } else if (input.action === "create_ticket") {
      if (sandboxMode) {
        // In sandbox mode, don't file a real ticket — just confirm the flow.
        replyText = input.message || "[Sandbox] Your issue has been recorded. Our warranty team will contact you with next steps.";
      } else {
        const description =
          String(input.issue_summary || "").trim() ||
          issueState.issueSummary ||
          newMsg.trim();

        const result = await fileClaim({
          company,
          convo,
          transcript,
          issueState,
          homeownerId,
          propertyId,
          sandboxMode,
          description,
        });

        if (result.filed) {
          ticketId = result.ticketId;
          replyText = result.line;
        } else {
          replyText = NEEDS_IDENTITY;
          nextPhase = "IDENTIFY";
        }
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
      {
        role: "user",
        content: renderTemplate(COMPLIANCE_REVIEW_TEMPLATE, {
          homeownerMessage: newMsg,
          recentContext: recentContext(transcript.slice(0, -1), 4) || "(start of conversation)",
          message: replyText,
        }),
      },
    ],
    tool: {
      name: "safety_verdict",
      description: "Verdict on message safety.",
      input_schema: {
        type: "object",
        properties: {
          is_safe: { type: "boolean" },
          is_emergency: { type: "boolean", description: "Does the HOMEOWNER's message describe a live life-safety emergency?" },
          reason: { type: "string" },
          corrected_message: { type: "string", description: "Required when is_safe is false or is_emergency is true: the full replacement reply to send instead, in the agent's voice." }
        },
        required: ["is_safe", "is_emergency"]
      }
    },
    maxTokens: 600,
    fast: true,
    temperature: 0,
  });
  const gateTriggered = !!safetyCheck && (safetyCheck.is_safe === false || !!safetyCheck.is_emergency);

  if (gateTriggered) {
    console.warn(
      `[Warranty Agent] Safety gate triggered (unsafe=${safetyCheck.is_safe === false}, ` +
      `emergency=${!!safetyCheck.is_emergency}): ${safetyCheck.reason || "no reason given"}`,
    );

    const replacement = String(safetyCheck.corrected_message || "").trim();
    if (replacement) {
      replyText = replacement;
    } else if (safetyCheck.is_emergency) {
      replyText =
        "If anyone is in immediate danger, please call 911 now. " +
        "I'm flagging this for our warranty team straight away.";
    } else {
      replyText =
        "Thanks for letting me know — I want to make sure I get this right, so I'll pass the " +
        "details to our warranty team and they'll follow up with you directly.";
    }

    if (safetyCheck.is_emergency) {
      const reason = safetyCheck.reason || "Emergency detected by safety gate.";

      if (ticketId && !sandboxMode) {
        await escalateWarrantyTicket(ticketId, { reason });
        replyText += `\n\nYour issue has been flagged as urgent and our warranty team will contact you as soon as possible.`;
        nextPhase = "RESOLVE";
      } else {
        const result = await fileClaim({
          company,
          convo,
          transcript,
          issueState,
          homeownerId,
          propertyId,
          sandboxMode,
          description: reason,
          forceEmergency: true,
        });

        if (result.filed) {
          ticketId = result.ticketId;
          replyText += `\n\n${result.line}`;
          nextPhase = "RESOLVE";
        } else {
          replyText += `\n\n${EMERGENCY_NO_IDENTITY}`;
          nextPhase = "IDENTIFY";
          if (!sandboxMode) {
            await prisma.warrantyConversation.update({
              where: { id: convo.id },
              data: { status: "ESCALATED" },
            });
          }
        }
      }
    }
  }

  return finish(replyText, nextPhase);
}
