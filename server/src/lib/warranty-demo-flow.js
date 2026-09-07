import { toolCall } from "./llm.js";
import { queryDetailed as kbQueryDetailed } from "../services/warranty-vector.service.js";
import { getCoverageStatus, describeCoverage } from "./coverage.js";
import { classifyClaimHeuristic } from "./warranty-classify.js";
import { DEMO_PROPERTIES, DEMO_HOMEOWNER_EMAIL, demoTicketConfirmation } from "./warranty-demo.js";
import { matchPropertyChoice } from "./warranty-orchestrator.js";
import { KB_EMPTY_CONTEXT } from "../prompts/index.js";

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;

const CLAIM_INTENT =
  /\b(file|log|submit|open|raise|start)\b.*\b(claim|ticket|request|report)\b|\b(claim|ticket)\b.*\b(please|now)\b|\bsomeone come\b|\bneed (a )?(repair|technician|someone)\b/i;

const DEMO_BANNER = "Demo mode — sample data only, nothing is saved and no ticket is filed.";

function reply(text, phase, state) {
  return { reply: text, phase, state };
}

async function answerFromPlatformKb(question) {
  let context = KB_EMPTY_CONTEXT;
  try {
    const { results } = await kbQueryDetailed(null, question, 3, null, null);
    if (results?.length) {
      context = results.map((r, i) => `[${i + 1}] ${r.name}: ${r.text}`).join("\n\n");
    }
  } catch (err) {
    console.error("[Warranty Demo] KB retrieval failed:", err.message);
  }

  const input = await toolCall({
    companyId: null,
    forcePlatformKey: true,
    system:
      "You are a home warranty assistant answering from the documents below. " +
      "Answer only from them; if they do not cover the question, say so and offer to log a request. " +
      "Never promise coverage.\n\nDocuments:\n" +
      context,
    messages: [{ role: "user", content: question }],
    tool: {
      name: "respond",
      description: "Reply to the homeowner.",
      input_schema: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
    },
    maxTokens: 400,
  });

  if (input?.message) return input.message;

  return (
    "I don't have that detail in the sample warranty documents. In a live workspace I'd answer from " +
    "your builder's own documents, or log a request for the warranty team. Want to see a claim filed?"
  );
}
export async function processDemoTurn({ state = {}, message }) {
  const next = { ...state };
  const text = String(message || "").trim();
  const phase = next.phase || "INTAKE";

  if (phase === "INTAKE") {
    next.phase = "IDENTIFY";
    if (text) next.issue = text;
    return reply(
      `${DEMO_BANNER}\n\nHi — I'm the warranty assistant. I can look up a home, check its coverage, ` +
        `answer questions from the warranty documents, and file a claim.\n\n` +
        `To try it, give me the email on the sample file: ${DEMO_HOMEOWNER_EMAIL}`,
      "IDENTIFY",
      next,
    );
  }

  if (phase === "IDENTIFY") {
    if (Array.isArray(next.propertyChoices) && next.propertyChoices.length) {
      const picked = matchPropertyChoice(text, next.propertyChoices);
      if (picked) {
        const property = DEMO_PROPERTIES.find((p) => p.id === picked.id);
        return selectProperty(property, next);
      }
      return reply(
        `I didn't catch which home that was. Reply with 1 or 2:\n` +
          next.propertyChoices.map((p, i) => `${i + 1}. ${p.address}`).join("\n"),
        "IDENTIFY",
        next,
      );
    }

    const email = EMAIL_RE.exec(text)?.[0];
    if (!email) {
      return reply(
        `I'll need the email on the warranty file to look the home up. For this demo, use ${DEMO_HOMEOWNER_EMAIL}.`,
        "IDENTIFY",
        next,
      );
    }

    if (email.toLowerCase() !== DEMO_HOMEOWNER_EMAIL.toLowerCase()) {
      return reply(
        `I couldn't find a warranty file for "${email}". In a live workspace I'd invite you to try another ` +
          `address or hand you to the builder. For this demo, try ${DEMO_HOMEOWNER_EMAIL}.`,
        "IDENTIFY",
        next,
      );
    }

    next.email = email;
    next.propertyChoices = DEMO_PROPERTIES.map((p) => ({ id: p.id, address: p.address }));
    return reply(
      `Found the file. There are two homes on it — which one is this about?\n` +
        next.propertyChoices.map((p, i) => `${i + 1}. ${p.address}`).join("\n") +
        `\n\nJust reply with the number.`,
      "IDENTIFY",
      next,
    );
  }

  if (phase === "DIAGNOSE") {
    if (CLAIM_INTENT.test(text) || next.readyToFile) {
      next.issue = next.issue || text;
      next.phase = "RESOLVE";
      return reply(
        "Happy to log that. In one line, what should the warranty team know about the issue?",
        "RESOLVE",
        next,
      );
    }

    if (!next.issue) next.issue = text;
    const answer = await answerFromPlatformKb(text);
    return reply(`${answer}\n\nIf you'd like, say "file a claim" and I'll show you that part.`, "DIAGNOSE", next);
  }

  if (phase === "RESOLVE") {
    const description = text || next.issue || "";
    const classification = classifyClaimHeuristic(description);
    next.phase = "DONE";
    next.classification = classification;

    return reply(demoTicketConfirmation(classification, classification.isEmergency), "DONE", next);
  }

  return reply(
    "That's the full journey: identify, coverage check, grounded answers, and a classified claim. " +
      "Send /reset to run it again, or point the widget at a real company ID to use live data.",
    "DONE",
    next,
  );
}

function selectProperty(property, state) {
  const next = { ...state };
  const coverage = getCoverageStatus(property);

  next.propertyChoices = null;
  next.propertyId = property.id;
  next.propertyAddress = property.address;
  next.coverage = { status: coverage.status, endDate: coverage.endDate };
  next.phase = "DIAGNOSE";

  const line = describeCoverage(coverage);
  return reply(
    [
      `Got it — ${property.address}.`,
      line,
      "Ask me anything about the warranty, or tell me what's wrong and I'll file a claim.",
    ]
      .filter(Boolean)
      .join(" "),
    "DIAGNOSE",
    next,
  );
}
