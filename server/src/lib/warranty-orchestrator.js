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

/** How many knowledge-base documents to remember for the ticket's references. */
const MAX_TRACKED_KB_REFS = 12;

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

/** The last few turns, as plain text, for the classifier to disambiguate a terse description. */
function recentContext(transcript, turns = 6) {
  return (transcript || [])
    .slice(-turns)
    .map((t) => `${t.role === "agent" ? "Assistant" : "Homeowner"}: ${String(t.content || "").trim()}`)
    .join("\n");
}

/**
 * Resolves a homeowner's reply against a numbered property list.
 *
 * The Botpress flow presented properties as a numbered picker and converted the
 * choice deterministically. Asking the model to turn "2" back into an address it
 * can only see in its own earlier message is a needless round trip that fails
 * often, so the common answers are matched in code: a bare number, a number with
 * decoration ("#2", "option 2"), or any distinctive part of the address.
 */
export function matchPropertyChoice(message, choices) {
  const list = Array.isArray(choices) ? choices : [];
  if (list.length === 0) return null;

  const raw = String(message || "").trim();
  if (!raw) return null;

  const numeric = raw.match(/^\s*(?:#|option\s*|number\s*|no\.?\s*)?(\d{1,2})\b/i);
  if (numeric) {
    const index = Number(numeric[1]) - 1;
    if (index >= 0 && index < list.length) return list[index];
  }

  const lower = raw.toLowerCase();
  const byAddress = list.filter((c) => {
    const address = String(c.address || "").toLowerCase();
    if (!address) return false;
    // The reply containing the whole address is always meaningful. The reverse —
    // the address containing the reply — only is when the reply is long enough to
    // be a real fragment: "7" appears inside "1207 Marigold Way" and would
    // otherwise silently pick a home the homeowner never named.
    if (lower.includes(address)) return true;
    return lower.length >= 4 && address.includes(lower);
  });
  if (byAddress.length === 1) return byAddress[0];

  // Fall back to the street number, which is what people usually type.
  const streetNumber = lower.match(/\b(\d{1,6})\b/);
  if (streetNumber) {
    const hits = list.filter((c) => String(c.address || "").startsWith(streetNumber[1]));
    if (hits.length === 1) return hits[0];
  }

  return null;
}

/** Merges freshly retrieved passages into the running reference list, deduped by document. */
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

/** Retrieval for the phases that answer questions, scoped to the tenant and community. */
async function retrieveContext({ companyId, question, communityId, issueState }) {
  const q = String(question || "").trim();
  if (!q) return KB_EMPTY_CONTEXT;

  try {
    const { results } = await kbQueryDetailed(companyId, q, 3, null, communityId);
    if (results && results.length > 0) {
      trackKbRefs(issueState, results);
      return results.map((r, i) => `[${i + 1}] ${r.name}: ${r.text}`).join("\n\n");
    }
    return KB_EMPTY_CONTEXT;
  } catch (e) {
    console.error("KB retrieval failed:", e);
    return KB_EMPTY_CONTEXT;
  }
}

/**
 * Classifies and files the claim, and returns the line the homeowner is told.
 *
 * Both callers — the resolution step and the emergency path — go through here so
 * a ticket is always classified, always carries the transcript and the retrieved
 * references, and always reports the same way.
 */
async function fileClaim({
  company,
  convo,
  transcript,
  issueState,
  homeownerId,
  propertyId,
  description,
  forceEmergency = false,
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

  const { ticket, ticketUrl } = filed;
  const link = ticketUrl ? ` You can follow its progress here: ${ticketUrl}` : "";

  const line = ticket.isEmergency
    ? `I've logged this as an emergency ticket (${ticket.id}) and flagged it for our warranty team right away.${link}`
    : `Thank you — I've logged ticket ${ticket.id} for your issue. Our warranty team will be in touch with next steps.${link}`;

  await prisma.warrantyConversation.update({
    where: { id: convo.id },
    data: {
      ticketId: ticket.id,
      status: ticket.isEmergency ? "ESCALATED" : "RESOLVED",
    },
  });

  return { filed, classification, line, ticketId: ticket.id };
}

/** The message shown when the claim is ready but nobody has been identified yet. */
const NEEDS_IDENTITY =
  "I have everything I need about the issue. Before I can log it, could you share the email address on your warranty file so I can attach it to the right property?";

const EMERGENCY_NO_IDENTITY =
  "If anyone is in immediate danger, call 911 now. I have flagged this conversation as an emergency for our warranty team — please reply with your email address so I can file the ticket against your property.";

export async function processWarrantyTurn({ company, convo, newMsg }) {
  const transcript = [...(convo.transcript || []), { role: "user", content: newMsg, at: new Date().toISOString() }];
  const messages = toAnthropicMessages(transcript);

  let currentPhase = convo.phase || "INTAKE";
  let ticketId = convo.ticketId || null;
  let homeownerId = convo.homeownerId || null;
  let propertyId = convo.propertyId || null;

  // Everything gathered so far. Read by the identify and resolve prompts, and
  // drained into the ticket's extracted-info and knowledge-base references when
  // the claim is filed.
  const issueState = { ...(convo.issueState || {}) };

  // Which community's documents apply. Resolved from the identified property, so
  // it is null until the homeowner has been identified — at which point only
  // shared documents are eligible, never another community's rules.
  let communityId = null;
  let property = null;
  if (propertyId) {
    property = await prisma.property.findUnique({ where: { id: propertyId } }).catch(() => null);
    communityId = property?.communityId || null;
  }

  /** Records a resolved property: coverage, community scope, and conversation state. */
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

    await prisma.warrantyConversation.update({
      where: { id: convo.id },
      data: { propertyId, homeownerId, issueState },
    });

    return coverage;
  };

  /** Persists the turn and returns the reply. Used by the deterministic branches. */
  const finish = async (replyText, nextPhase) => {
    const finalTranscript = [...transcript, { role: "agent", content: replyText, at: new Date().toISOString() }];
    await prisma.warrantyConversation.update({
      where: { id: convo.id },
      data: {
        transcript: finalTranscript,
        phase: nextPhase,
        issueState,
        turnCount: { increment: 1 },
      },
    });
    return { reply: replyText, phase: nextPhase };
  };

  // --- Deterministic property picker -------------------------------------
  // A pending numbered list is resolved in code before the model is consulted,
  // exactly as the Botpress "select property" node did.
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

        // The text above is ours, not the model's, so it does not need the
        // compliance gate — that exists to review generated output.
        return finish(reply, "DIAGNOSE");
      }
    }
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

    kbContext = await retrieveContext({
      companyId: company.id,
      question: newMsg,
      communityId,
      issueState,
    });
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

    // A homeowner can still ask a question while wrapping up, so the resolution
    // step answers from the same documents rather than from nothing.
    kbContext = await retrieveContext({
      companyId: company.id,
      question: newMsg,
      communityId,
      issueState,
    });
  }

  const system = renderTemplate(systemPromptTemplate, {
    companyName: company.name,
    issueState: JSON.stringify(issueState || {}),
    kbContext,
    coverageStatus: issueState.coverage?.status || COVERAGE.UNKNOWN,
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
    if (!issueState.issueSummary && newMsg.trim().length > 12) {
      issueState.issueSummary = newMsg.trim().slice(0, 600);
    }
    if (input.transition_phase === "IDENTIFY") {
      nextPhase = "IDENTIFY";
    } else if (messages.length > 1) {
      // Auto transition to identify if message length suggests they provided issue
      nextPhase = "IDENTIFY";
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
        // Remember the list so the reply "2" can be resolved in code next turn.
        issueState.propertyChoices = properties.map((p) => ({ id: p.id, address: p.address }));
        const propList = properties.map((p, i) => `${i + 1}. ${p.address}`).join("\n");
        replyText = `I found multiple properties associated with that info. Which one is experiencing the issue?\n${propList}`;
      } else {
        replyText = `I couldn't find a property matching "${input.query}". Could you double-check the email address on your warranty file?`;
      }
    } else if (input.transition_phase === "DIAGNOSE") {
      nextPhase = "DIAGNOSE";
    }
  } else if (currentPhase === "DIAGNOSE") {
    if (input.action === "escalate_emergency") {
      const reason = input.emergency_reason || "Emergency reported during diagnosis.";

      if (ticketId) {
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
          await prisma.warrantyConversation.update({
            where: { id: convo.id },
            data: { status: "ESCALATED" },
          });
        }
      }
    } else if (input.transition_phase === "RESOLVE") {
      nextPhase = "RESOLVE";
    }
  } else if (currentPhase === "RESOLVE") {
    if (input.action === "create_ticket") {
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
    fast: true,
    temperature: 0,
  });

  if (safetyCheck && (!safetyCheck.is_safe || safetyCheck.is_emergency) && safetyCheck.corrected_message) {
    console.warn(`[Warranty Agent] Safety gate triggered: ${safetyCheck.reason}`);
    replyText = safetyCheck.corrected_message;

    if (safetyCheck.is_emergency) {
      const reason = safetyCheck.reason || "Emergency detected by safety gate.";

      if (ticketId) {
        await escalateWarrantyTicket(ticketId, { reason });
        replyText += `\n\nI've escalated your ticket (${ticketId}) to our emergency queue.`;
        nextPhase = "RESOLVE";
      } else {
        const result = await fileClaim({
          company,
          convo,
          transcript,
          issueState,
          homeownerId,
          propertyId,
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
          await prisma.warrantyConversation.update({
            where: { id: convo.id },
            data: { status: "ESCALATED" },
          });
        }
      }
    }
  }

  return finish(replyText, nextPhase);
}
