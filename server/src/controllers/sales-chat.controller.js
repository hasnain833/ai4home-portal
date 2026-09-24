import prisma from "../lib/prisma.js";
import { runClaudeTurn } from "../inngest/functions/appointment.js";
import { queryDetailed as kbQueryDetailed } from "../services/vector-store.service.js";
import {
  getAvailableSlots,
  getAvailabilitySetting,
  resolveAgentId,
  leadTimezone,
  bookSlot,
} from "../services/scheduling-service.js";
import { normalizePhone } from "../services/sms.service.js";
import { KB_SCOPES } from "../lib/sales-ai.js";
import { withInventory, homeCards } from "../lib/sales-homes.js";
import { hasPlatformAi } from "../lib/ai-config.js";
import { getSalesSuggestions } from "../services/sales-suggestions.service.js";

// The Sales workspace's own AI Assistant: the same agent, prompt and knowledge
// the SMS / email agent uses, talking in the portal as a web chat. The
// transcript lives in the browser and comes back with each turn, so there is no
// conversation row to keep — the agent's memory is the transcript itself.
//
// The agent picks the time; the buyer's details come from a form the chat shows
// when it does. The person signed in is often staff chatting on a buyer's
// behalf, so their own account is never taken to be the buyer.

const MAX_TURNS = 20;
const MAX_MESSAGE_CHARS = 4000;
const EMAIL_RE = /^[^\s@]+@([^\s@.,]+\.)+[^\s@.,]{2,}$/;
const SLOT_DAYS = 14;
const SLOT_LIMIT = 8;

function readTranscript(body) {
  const list = Array.isArray(body?.messages) ? body.messages.slice(-MAX_TURNS) : [];
  const transcript = [];
  for (const m of list) {
    const content = typeof m?.content === "string" ? m.content.trim() : "";
    if (!content) continue;
    if (content.length > MAX_MESSAGE_CHARS) return { error: `Messages must be under ${MAX_MESSAGE_CHARS} characters` };
    transcript.push({ role: m.role === "agent" ? "agent" : "lead", content });
  }
  if (!transcript.length || transcript[transcript.length - 1].role !== "lead") {
    return { error: "Send a message to reply to" };
  }
  return { transcript };
}

const isHomeowner = (user) => String(user?.role || "").toUpperCase() === "HOMEOWNER";

function firstNameOf(name) {
  return String(name || "").trim().split(/\s+/)[0] || null;
}

/** Open slots for a first-time lead of this company, labelled in its zone. */
async function openSlots(companyId) {
  const setting = await getAvailabilitySetting(companyId);
  const timezone = leadTimezone(null, setting);
  const agentId = await resolveAgentId({ companyId, ownerId: null });
  const slots = (
    await getAvailableSlots({ companyId, agentId, days: SLOT_DAYS, limit: SLOT_LIMIT, displayTz: timezone }).catch(() => [])
  ).map((s) => ({ iso: s.iso, label: s.label }));
  return { slots, timezone };
}

export const getSuggestions = async (req, res) => {
  try {
    return res.json({ suggestions: await getSalesSuggestions(req.user.companyId) });
  } catch (error) {
    console.error("[Sales Chat] Suggestions failed:", error);
    // Cosmetic: the chat works without them.
    return res.json({ suggestions: [] });
  }
};

export const postMessage = async (req, res) => {
  try {
    const { transcript, error } = readTranscript(req.body);
    if (error) return res.status(400).json({ message: error });

    if (!(await hasPlatformAi())) {
      return res.status(503).json({ message: "The AI Assistant is not available right now." });
    }

    const companyId = req.user.companyId;
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) return res.status(404).json({ message: "Company not found" });

    // Only a homeowner is chatting as themselves; for staff the buyer is unknown
    // until they fill in the booking form.
    const leadForPrompt = {
      id: "portal-chat",
      companyId,
      company,
      firstName: (isHomeowner(req.user) && firstNameOf(req.user.name)) || "not given yet",
    };

    const { slots, timezone } = await openSlots(companyId);

    const question = transcript[transcript.length - 1].content;
    let kbChunks = [];
    let retrievalMethod = null;
    try {
      const found = await kbQueryDetailed(companyId, question, 5, KB_SCOPES.scheduling);
      kbChunks = found.results || [];
      retrievalMethod = found.method || null;
    } catch (e) {
      console.warn("[Sales Chat] KB retrieval failed:", e.message);
    }
    kbChunks = await withInventory(companyId, kbChunks);

    const decision = await runClaudeTurn({
      lead: leadForPrompt,
      company,
      channel: "WEBCHAT",
      transcript,
      slots,
      timezone,
      kbChunks,
      retrievalMethod,
    });

    let reply = decision.message || "";
    let pendingBooking = null;

    if (decision.action === "book") {
      const offered = slots.find((s) => s.iso === decision.slot_iso);
      if (offered) {
        // Nothing is booked yet: the agent's "you're all set" would be untrue
        // until the buyer says who they are.
        pendingBooking = {
          slotIso: offered.iso,
          label: offered.label,
          locationType: decision.location_type === "ONSITE" ? "ONSITE" : "VIRTUAL",
        };
        reply = `Great — ${offered.label} it is. Just add your details below so I can lock it in and send you a confirmation.`;
      } else {
        reply =
          `Sorry — that time isn't open anymore.` +
          (slots.length
            ? ` Here are the next available options:\n${slots.slice(0, 3).map((s) => `• ${s.label}`).join("\n")}\nWhich one works?`
            : " I'll have a team member reach out to find a time that works.");
      }
    }

    return res.json({
      reply,
      action: decision.action || "reply",
      homes: await homeCards(companyId, decision.home_ids),
      pendingBooking,
      // Prefill only for someone booking for themselves.
      contactPrefill: isHomeowner(req.user)
        ? { name: req.user.name || "", email: req.user.email || "", phone: "" }
        : null,
    });
  } catch (error) {
    console.error("[Sales Chat] Turn failed:", error);
    return res.status(500).json({ message: "The assistant could not reply. Please try again." });
  }
};

/**
 * Books the time the agent agreed, for the buyer named in the form. The buyer
 * becomes a lead — an existing one when their email or phone is already on
 * file, so a returning buyer does not end up twice in Leads.
 */
export const bookVisit = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const b = req.body || {};
    const name = String(b.name || "").trim().replace(/\s+/g, " ");
    const email = String(b.email || "").trim().toLowerCase();
    const phone = normalizePhone(b.phone);

    if (name.length < 2) return res.status(400).json({ message: "Enter the buyer's name" });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ message: "Enter a valid email address" });
    if (b.phone && (phone.length < 10 || phone.length > 15)) {
      return res.status(400).json({ message: "Enter a valid phone number, or leave it blank" });
    }

    // The slot must still be one this company offers — the client only echoes
    // back what the agent chose, and it may have been taken since.
    const { slots } = await openSlots(companyId);
    const slot = slots.find((s) => s.iso === b.slotIso);
    if (!slot) {
      return res.status(409).json({
        message: "That time was just taken.",
        slots: slots.slice(0, 3),
      });
    }

    const [firstName, ...rest] = name.split(" ");
    const lastName = rest.join(" ") || "-";
    const contactMatch = [{ email: { equals: email, mode: "insensitive" } }, ...(phone ? [{ phone }] : [])];

    let lead = await prisma.lead.findFirst({
      where: { companyId, archived: false, OR: contactMatch },
      orderBy: { updatedAt: "desc" },
    });
    if (lead) {
      // Fill gaps only; what is on file already wins over a chat form.
      const patch = {};
      if (!lead.phone && phone) patch.phone = phone;
      if (!lead.email) patch.email = email;
      if (!lead.tags.includes("ai-assistant")) patch.tags = [...lead.tags, "ai-assistant"];
      if (Object.keys(patch).length) lead = await prisma.lead.update({ where: { id: lead.id }, data: patch });
    } else {
      lead = await prisma.lead.create({
        data: {
          companyId,
          source: "MANUAL",
          firstName,
          lastName,
          email,
          phone: phone || null,
          tags: ["ai-assistant"],
          consentSource: "Sales AI Assistant (portal chat)",
        },
      });
    }

    const interest = Array.isArray(b.homes)
      ? b.homes.map((h) => String(h || "").trim()).filter(Boolean).slice(0, 6)
      : [];
    const notes = [
      `Booked through the Sales AI Assistant by ${req.user.name || req.user.email}.`,
      interest.length ? `Homes discussed: ${interest.join("; ")}.` : null,
    ].filter(Boolean).join("\n");

    const result = await bookSlot({
      leadId: lead.id,
      startTime: slot.iso,
      title: "Model Home Visit",
      locationType: b.locationType === "ONSITE" ? "ONSITE" : "VIRTUAL",
      bookedVia: "AI_CHAT",
      notes,
    });

    if (!result.success) {
      return res.status(result.conflict ? 409 : 400).json({ message: result.reason || "Could not book that time" });
    }

    const link = result.appointment.meetingLink;
    return res.status(201).json({
      reply:
        `You're booked, ${firstName} — ${slot.label}. A confirmation is on its way to ${email}.` +
        (link ? `\n\nVideo link: ${link}` : ""),
      booked: {
        when: slot.label,
        locationType: result.appointment.locationType,
        meetingLink: link || null,
        leadId: lead.id,
        leadName: `${lead.firstName} ${lead.lastName === "-" ? "" : lead.lastName}`.trim(),
      },
    });
  } catch (error) {
    console.error("[Sales Chat] Booking failed:", error);
    return res.status(500).json({ message: "The visit could not be booked. Please try again." });
  }
};
