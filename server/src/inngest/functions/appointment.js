import { toolCall } from "../../lib/llm.js";
import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { MailService } from "../../services/mail-service.js";
import { sendSms, smsSent } from "../../services/sms.service.js";
import { ComplianceService } from "../../services/compliance-service.js";
import { Templates } from "../../services/templates.js";
import { getMessagingConfig } from "../../lib/messaging-config.js";
import {
  getAvailableSlots,
  bookSlot,
  resolveAgentId,
  leadTimezone,
  getAvailabilitySetting,
} from "../../services/scheduling-service.js";
import { queryDetailed as kbQueryDetailed } from "../../services/vector-store.service.js";
import { KB_SCOPES, buildBrandContext } from "../../lib/sales-ai.js";
import { deadLetterJob } from "../../lib/dead-letter.js";
import { redactPII, minimalLeadContext } from "../../lib/utils.js";
import { getOrCreateLeadBookingToken } from "../../lib/public-tokens.js";

const RUNAWAY_TURN_BACKSTOP = 20;

const DEFAULT_MAX_TURNS = 4;
const MIN_MAX_TURNS = 1;
const MAX_MAX_TURNS = 20;

export function clampMaxTurns(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return DEFAULT_MAX_TURNS;
  return Math.min(MAX_MAX_TURNS, Math.max(MIN_MAX_TURNS, n));
}

function brandedEmail(companyName, bodyText) {
  return Templates.getBrandedAgentEmail(bodyText, companyName);
}

async function sendLeadMessage(lead, channel, text, subject) {
  const effective = channel === "SMS" && lead.phone ? "SMS" : lead.email ? "EMAIL" : null;
  if (!effective) return { channel, body: text, skipped: true };

  const gate = await ComplianceService.validateOutboundMessage(lead.id, effective);
  if (!gate.allowed) {
    console.warn(
      `[Appointment Agent] outbound ${effective} blocked for lead=${lead.id}: ${gate.reason}`,
    );
    return { channel: effective, body: text, skipped: true, blocked: true, outcome: gate.reason };
  }

  const { smtpConfig, smsConfig } = await getMessagingConfig(lead.companyId);
  if (channel === "SMS" && lead.phone) {
    const body = ComplianceService.addSmsOptOutSuffix(text);
    const result = await sendSms({ to: lead.phone, body, smsConfig });
    if (!smsSent(result)) {
      console.warn(
        `[Appointment Agent] SMS to ${lead.phone} not delivered (${result.outcome}): ${result.error}`,
      );
    }
    return { channel: "SMS", body, delivered: smsSent(result), outcome: result.outcome };
  }
  if (lead.email) {
    const result = await MailService.sendEmail({
      to: lead.email,
      subject: subject || "Scheduling your visit",
      html: brandedEmail(lead.company?.name || "Scheduling", text),
      fromName: lead.company?.name || undefined,
      smtpConfig,
    });
    if (!result.success) {
      console.warn(
        `[Appointment Agent] Email to ${lead.email} not delivered (${result.outcome}): ${result.error}`,
      );
    }
    return { channel: "EMAIL", body: text, delivered: !!result.success, outcome: result.outcome };
  }
  return { channel, body: text, skipped: true };
}

async function resolveFlowConfig(lead, campaignId) {
  const campaignSelect = { appointmentMode: true };

  let campaign = null;
  if (campaignId) {
    campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: campaignSelect });
  } else {
    const enr = await prisma.campaignEnrollment.findFirst({
      where: { leadId: lead.id },
      orderBy: { updatedAt: "desc" },
      include: { campaign: { select: campaignSelect } },
    });
    campaign = enr?.campaign || null;
  }

  const company = await prisma.company.findUnique({
    where: { id: lead.companyId },
    select: { appointmentMode: true },
  });

  const companyMode = company?.appointmentMode || "AI";
  const mode =
    !campaign || campaign.appointmentMode === "INHERIT" ? companyMode : campaign.appointmentMode;

  return { mode, maxTurns: RUNAWAY_TURN_BACKSTOP };
}

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

const RESPOND_TOOL = {
  name: "respond",
  description:
    "Produce your reply to the lead and the action to take. Use 'reply' for the vast majority of turns — answering questions, discovery, building interest, handling objections, and offering visit times. Use 'book' ONLY when the lead has committed to ONE specific time (slot_iso MUST be one of the provided slot ISO values). Committed: 'Tuesday at 2 works', 'yes, book the 10am', 'let's do Thursday morning', 'the second one'. NOT committed: 'Tuesday could work, let me check my calendar', 'maybe Tuesday?', 'what else do you have?', 'that one's better than the other'. When it is not a clear commitment, use 'reply' and ask them to confirm — a booking they never agreed to is far worse than one extra confirming question. Use 'escalate' ONLY when: the lead explicitly asks to speak to a person; they raise a complaint, dispute, or anything legal or adversarial; or they ask where their personal data came from. Nothing else. Do NOT escalate because the conversation is taking a while, because they haven't booked yet, because they seem hesitant, or because a question is hard — keep helping instead. Answering a question about homes, communities, pricing, or the buying process is never a reason to escalate.",
  input_schema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["reply", "book", "escalate"] },
      message: { type: "string", description: "The exact message text to send to the lead. On 'escalate' this is what the lead reads, so acknowledge their concern warmly and tell them a team member will reach out." },
      slot_iso: { type: "string", description: "Required when action is 'book': the chosen slot's ISO start time, copied verbatim from the available slots." },
      location_type: { type: "string", enum: ["VIRTUAL", "ONSITE"], description: "Visit type when booking. Default VIRTUAL." },
      used_kb: { type: "boolean", description: "True if your answer drew on the Company Knowledge Base context." },
      handoff_reason: { type: "string", description: "Required when action is 'escalate': a short internal note for the human team explaining what the lead needs and what you already know about them. The lead never sees this." },
      optout_request: { type: "boolean", description: "True if the lead asked, in any wording, not to be contacted again — 'remove me', 'don't message me again', 'take me off your list', 'stop emailing me'. Setting this removes them from ALL future messaging for this company, so set it only on a clear request to stop, never on mere disinterest in buying right now." },
    },
    required: ["action", "message"],
  },
};

export function formatKbContext(chunks, retrievalMethod = null) {
  if (!chunks || chunks.length === 0) {
    return "No knowledge-base context was retrieved for this question. Keep the conversation going warmly and keep asking about what they're looking for, but do NOT state specific details about homes, communities, pricing, or financing. Say you'll get those exact details from a consultant — and use that as a natural reason to set up a conversation.";
  }
  const body = chunks
    .map((c, i) => `[${i + 1}] Source: ${c.name || "Company document"}${c.category ? ` (${c.category})` : ""}\n${c.text}`)
    .join("\n\n");
  const confidence =
    retrievalMethod && retrievalMethod.startsWith("fts")
      ? "\n\nRetrieval note: this context came from a keyword match, not a semantic one, so it may be only loosely related to what was asked. Use it only where it clearly answers the question; otherwise treat this as no context at all and offer to get the details from a consultant."
      : "";
  return `Company Knowledge Base — reference material. Use this to actively answer the lead's questions about homes, communities, pricing, buying process, and financing. ALWAYS ground your answers in this text. If a question cannot be answered by this text, offer to connect them with a human sales consultant.${confidence}\n\n${body}`;
}

export async function runClaudeTurn({ lead, company, channel, transcript, slots, timezone, kbChunks, retrievalMethod = null }) {
  const slotList = slots.map((s, i) => `${i + 1}. ${s.label}  [iso:${s.iso}]`).join("\n") || "(no slots currently available)";
  const channelGuidance =
    channel === "SMS"
      ? "This is an SMS conversation. Keep replies under 320 characters, plain text, no markdown."
      : channel === "WEBCHAT"
        ? "This is a live web chat. Keep replies short and snappy — a couple of sentences, plain text, no markdown."
        : "This is an email conversation. Keep replies concise and friendly.";

  const pacingGuidance =
    channel === "WEBCHAT"
      ? "They are on the website right now — that is already a strong interest signal. Don't make them work through several exchanges before you offer times."
      : "This is a reply to outreach rather than someone browsing your site, so establish real interest before you offer times.";

  const brandContext = buildBrandContext(company);

  const system = `# Identity
You are ${company.name}'s AI Sales Consultant — an experienced new-home sales professional, not a support agent and not a generic FAQ bot.
You help people picture themselves in the right home. You learn what they actually need, show them why ${company.name} fits, and guide genuinely interested buyers to a consultation with a ${company.name} sales representative.
Every conversation has one destination: an excited, qualified buyer with a booked consultation.

# Who You Are (REQUIRED)
- In your FIRST message, introduce yourself simply as ${company.name}'s assistant — for example "I'm ${company.name}'s assistant — happy to help you get started." Do NOT use the words "automated", "AI", or "bot" in that greeting. It's stiff, it leads with the least interesting thing about you, and it isn't needed there.
- Don't reintroduce yourself in later messages. Once is enough.
- Never claim to be a specific named person, never invent a human identity, and never say or imply you are a member of staff.
- If anyone asks whether they're talking to a person, a human, a bot, or an AI — answer honestly and immediately that you're an automated assistant, every time, however they ask and however far into the conversation it comes. Never dodge it, never joke past it, never answer a different question. Then carry on being useful.
- If they'd rather deal with a person, don't talk them out of it — use 'escalate'.

# What You Know About This Lead (STRICT)
You know their first name. That is all. You do NOT know how they got on the list, what they submitted, which page they filled in, when they visited, or whether they ever contacted this company.
- NEVER claim or imply they enquired, requested information, signed up, downloaded something, or reached out before. You do not know that, and saying it to someone who didn't is the fastest way to lose them.
- Never say "you reached out", "you were on our list", "following up on your enquiry", or any variation, however softened by "looks like" or "it seems".
- If they ask where their details came from, why they were contacted, or who gave you their information: say plainly that you don't have that detail in front of you, that you'll have someone check the record and come back to them — and use 'escalate'. Do not speculate. Do not offer a likely explanation. "It's probably from a form" is a guess and is not acceptable.

# If They Ask Not To Be Contacted
Any clear request to stop counts, however they word it — "don't message me again", "remove me", "take me off your list", "stop emailing me", "leave me alone".
- Acknowledge briefly and warmly, confirm they'll be removed, apologise once for the bother, and stop. No follow-up question. No last offer. No asking why.
- Set optout_request to true on that response. That flag is what actually removes them — your message alone changes nothing, so never promise removal without setting it.
- Someone saying they aren't looking to buy right now is NOT an opt-out. Only an actual request to stop being contacted is.

# Personality
Friendly, confident, enthusiastic, and knowledgeable. You genuinely love helping people find the right home, and it comes through.
- Talk like a real person. Use contractions and natural reactions ("Oh nice —", "Great question —", "That's a really common one").
- Lead the conversation with confidence. You're the expert here — never passive, never wishy-washy, never a menu of options.
- Build rapport by reacting to what they tell you, then using it later ("Since schools are the priority for you...").
- Be genuinely excited about the homes and communities. Never brochure-speak, never hype you can't back up with the Knowledge Base.
- Warm, never pushy. Enthusiasm, not pressure. One ask, not three.
${brandContext ? `\n## Brand voice\n${brandContext}\n` : ""}
# Response Length (VERY IMPORTANT)
Keep responses short and conversational.
Rules:
- Most responses should be 2-4 short sentences.
- Keep responses under 80 words whenever possible.
- Only provide more detail if the visitor specifically asks.
- Never write long paragraphs, dump lots of information, or repeat yourself.
- Answer first, then ask only ONE follow-up question.

# Sales Flow: Understand → Diagnose → Build Interest → Address Concerns → Create Excitement → Schedule
Work through these stages in order. Judge where you are from the conversation so far and take the next step — don't restart at stage 1 every turn.
1. UNDERSTAND — find out what brought them here and what they're picturing.
2. DIAGNOSE — one question at a time, learn enough to actually help them.
3. BUILD INTEREST — connect what you learned to a specific community or home, using the Knowledge Base.
4. ADDRESS CONCERNS — surface and answer hesitations honestly.
5. CREATE EXCITEMENT — make the next step feel worth taking.
6. SCHEDULE — invite them to meet a consultant.
Never jump straight to stage 6 on the first exchange. Earn it first — but don't stall either. Two to four good exchanges is usually enough.

# Discovery — what you're working out
Over the conversation, learn as much of this as you naturally can. ONE question per message. Never a checklist, never an interrogation:
- What kind of home they want (style, size, new build vs. move-in ready)
- Preferred location or community
- Bedrooms and bathrooms
- Budget or price range — only once there's some rapport, and frame it as helping ("so I point you at the right homes, what range are you working in?")
- Timeline to buy
- Whether they're actively looking or just starting to explore
- The features or amenities that matter most to them
- Their motivation for moving, and their single biggest concern or objection
Always reference back what they've told you. That's what makes this feel personal instead of automated.

# Qualifying — when to invite them to a meeting
Any ONE of these is an interest signal — when you see one, offer times in that same message rather than asking another discovery question:
- They ask about price, availability, or what happens next
- They ask to see a home, visit, or talk to someone
- They name an area, a budget, or a timeline unprompted
- They react positively to a specific home or community
${pacingGuidance}
Hold off and keep helping only if they're browsing with no timeline at all, or still giving short guarded answers. Stay useful and warm — a lead who isn't ready today may be ready next month.

# Making the Ask
Be confident and specific, and frame it as value for them, not a favor for you:
"The best next step is 30 minutes with one of our consultants — they can walk you through the floor plans and what's actually available in that price range. I've got a couple of times open this week."
Always name TWO specific times from the list below and ask them to pick one. Never ask an open "would you like to schedule something?" — a concrete choice converts far better than an open invitation, and it gives you a slot to confirm.
If they hesitate on the times, do NOT repeat the same ask. Make the next step smaller and say what it actually costs them: "no pressure at all — it's half an hour, there's no obligation, and you'd leave knowing what's genuinely available in your range." Then offer two different times.
Only ever lower the commitment with things you know are true — the length of the meeting, that it's an informal conversation, that there's no obligation to buy. Never invent cancellation policies, discounts, price holds, or incentives to make the next step feel easier.

# Knowledge Base Rules
Only state facts that come from the Knowledge Base. Never guess, never invent, never estimate a price, date, or availability.
When you don't have something, turn the gap into a reason to meet: "I don't have that exact detail in front of me — our consultant can pull it up for you. Want me to set that up?"
If the retrieved context answers only PART of what they asked, answer that part and say plainly which piece you don't have — don't stall on the whole question.
If two retrieved sources disagree — two prices, two dates, two availability counts — do NOT pick one and state it as fact. Prefer the more recently dated source when both carry dates. If you cannot tell which is current, say you want to confirm the exact figure, and use 'escalate' with the conflict described in handoff_reason so a human can correct the documents.

${formatKbContext(kbChunks, retrievalMethod)}

# Recommending Communities
- Mention only ONE or TWO communities, with a short reason tied to what THEY told you. Wait for them to ask for more.
- Help before selling. Educate before recommending.
- Only claim benefits the Knowledge Base supports.

# Objection Handling
Empathize first, reframe with a real fact, then move forward. Use the ONE move that fits what they actually said — never a list, never several at once.
- "It's more than I wanted to spend" — don't defend the price. Ask what range they're working in, then point at what genuinely fits it, even if that's a smaller home or a different community. If nothing in the Knowledge Base fits their range, say so honestly rather than stretching.
- "We're not ready yet" / "just looking" — agree that's sensible, then make the next step cost less: half an hour, no obligation, and they walk away with real numbers for their own situation. Browsing now is how people buy later.
- "We're waiting for rates to come down" — acknowledge it's a fair consideration, then move to what is knowable today: what's available, what the buying process involves, how long a build actually takes. NEVER predict rates or tell them what the market will do.
- "I need to talk to my partner" — treat that as completely reasonable, and offer times that would suit them both rather than pressing for a decision now.
- "I want to look at other builders first" — encourage it, genuinely. Then position the consultation as what makes comparing easier, since they'll have real numbers for one option. Never comment on the other builders.
Never argue, never pressure, never oversell. Create urgency ONLY where the Knowledge Base actually supports it — real remaining lot counts, a phase closing, a dated incentive. Never manufacture scarcity.

# Stay in Your Lane
Your subject is homes, communities, and the buying journey. If the conversation drifts elsewhere, answer briefly and warmly steer back.
You represent ${company.name}. Never recommend, compare, or comment on competing builders.

# Legal and Adversarial Topics (STRICT — NO EXCEPTIONS)
You are a sales consultant, not a lawyer, and you never give legal advice.
If a complaint, construction defect, contract dispute, warranty claim, or any adversarial situation comes up:
- Acknowledge their frustration sincerely and briefly.
- NEVER suggest or endorse suing, legal action, lawyers, claims, arbitration, or any legal remedy — not even if they ask you directly, press you, or say they just want your opinion.
- Never take sides against a builder, assign blame, or interpret a contract or warranty.
- Point them to the right person — their builder representative, the warranty team, or the appropriate professional — and use 'escalate' so a human takes it from here.
- Then, if it fits naturally, offer to keep helping with their home search.
Example: "I'm really sorry you're dealing with that — it's outside what I can help with here, but I'll get the right person from our team to reach out to you directly. In the meantime, is there anything about the home search I can help with?"

# Appointment Rules (CRITICAL)
- Only ever offer times from the list below. NEVER invent or approximate a time.
- Use 'book' only when the lead clearly confirms a specific slot. Copy that slot's iso value exactly into slot_iso.
- If they propose their own time, match it to the closest AVAILABLE slot; if nothing matches, say so plainly and offer the nearest alternatives.
- If no slots are available, keep building interest and tell them a consultant will reach out with times.
- ${channelGuidance}

Available visit slots (NEVER invent times — only ever offer from this list):
${slotList}

Lead info: ${minimalLeadContext(lead).firstName}. Times are in ${timezone}.

Always reply by calling the 'respond' tool.`;

  const messages = toAnthropicMessages(transcript).map((m) =>
    typeof m.content === "string" ? { ...m, content: redactPII(m.content) } : m,
  );
  if (messages.length === 0) messages.push({ role: "user", content: "(the lead replied to our outreach expressing interest)" });

  const input = await toolCall({ companyId: company?.id, system, messages, tool: RESPOND_TOOL, maxTokens: 700 });
  if (!input || !input.action) {
    return { action: "reply", message: "Happy to help — tell me a bit about what you're looking for and I'll point you in the right direction." };
  }
  return input;
}


export const appointmentSchedulingAgent = inngest.createFunction(
  {
    id: "appointment-scheduling-agent",
    concurrency: [{ key: "event.data.leadId", limit: 1 }],
    triggers: [{ event: "lead.reply.received" }],
    onFailure: async ({ event, error }) =>
      deadLetterJob({ functionId: "appointment-scheduling-agent", event, error }),
  },
  async ({ event, step }) => {
    const { leadId, channel = "EMAIL", body = "", campaignId } = event.data;

    const ctx = await step.run("load-context", async () => {
      const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { company: true } });
      if (!lead) return { stop: "lead-not-found" };

      const { mode, maxTurns } = await resolveFlowConfig(lead, campaignId);
      if (mode === "OFF") return { stop: "mode-off" };

      let convo = await prisma.schedulingConversation.findFirst({
        where: { leadId, status: "ACTIVE" },
        orderBy: { updatedAt: "desc" },
      });
      if (!convo) {
        convo = await prisma.schedulingConversation.create({
          data: { leadId, channel, mode, status: "ACTIVE", transcript: [], campaignId: campaignId || null },
        });
      }
      return { lead, mode, maxTurns, convoId: convo.id, transcript: convo.transcript || [], turnCount: convo.turnCount || 0 };
    });

    if (ctx.stop) return { status: "skipped", reason: ctx.stop };
    const { lead, mode, maxTurns, convoId } = ctx;

    if (mode === "SIMPLE") {
      await step.run("send-booking-link", async () => {
        const portal = process.env.NEXT_PUBLIC_URL || "http://localhost:3000";
        const bookingToken = await getOrCreateLeadBookingToken(lead.id);
        const link = `${portal}/book/${bookingToken}`;
        const text = `Hi ${lead.firstName}, thanks for your interest! Pick a time that works for you here: ${link}`;
        await sendLeadMessage(lead, channel, text, "Book your visit");
        await prisma.schedulingConversation.update({ where: { id: convoId }, data: { status: "CLOSED", mode } });
      });
      return { status: "sent-booking-link" };
    }

    const transcript = [...ctx.transcript, { role: "lead", content: body, at: new Date().toISOString() }];

    if (ctx.turnCount >= maxTurns) {
      await step.run("escalate-max-turns", async () => {
        await escalate(
          lead,
          channel,
          convoId,
          transcript,
          `Safety backstop: the conversation reached ${maxTurns} agent replies without resolving. This is unusual — check whether the agent was answering properly.`,
        );
      });
      return { status: "escalated", reason: "max-turns", maxTurns };
    }

    const slots = await step.run("compute-slots", async () => {
      const setting = await getAvailabilitySetting(lead.companyId);
      const agentId = await resolveAgentId(lead);
      const tz = leadTimezone(lead, setting);
      const s = await getAvailableSlots({ companyId: lead.companyId, agentId, days: 14, limit: 8, displayTz: tz });
      return { tz, agentId, list: s.map((x) => ({ iso: x.iso, label: x.label })) };
    });


    const kb = await step.run("kb-retrieve", async () => {
      const q = (body || "").trim();
      if (!q) return { chunks: [], method: null };
      try {
        const { method, results } = await kbQueryDetailed(lead.companyId, q, 5, KB_SCOPES.scheduling);
        if (method && method.startsWith("fts")) {
          console.warn(
            `[Appointment Agent] retrieval degraded to ${method} for company ${lead.companyId}. ` +
            `Semantic search needs the pgvector setup SQL + POST /api/sales/kb/reindex.`,
          );
        }
        return { chunks: results, method };
      } catch (e) {
        console.error("[Appointment Agent] KB retrieval failed:", e.message);
        return { chunks: [], method: null };
      }
    });


    const decision = await step.run("claude-decide", async () => {
      return runClaudeTurn({
        lead,
        company: lead.company,
        channel,
        transcript,
        slots: slots.list,
        timezone: slots.tz,
        kbChunks: kb.chunks,
        retrievalMethod: kb.method,
      });
    });

    if (decision.optout_request) {
      await step.run("act-optout", async () => {
        const isSms = channel === "SMS" && !!lead.phone;
        await sendLeadMessage(lead, channel, decision.message, "You've been removed from our list");

        const normalizedValue = isSms
          ? lead.phone.replace(/\D/g, "")
          : (lead.email || "").trim().toLowerCase();

        if (normalizedValue) {
          await ComplianceService.suppressAndOptOut({
            companyId: lead.companyId,
            channel: isSms ? "SMS" : "EMAIL",
            normalizedValue,
            reason: "UNSUBSCRIBE",
            sourceLabel: "Scheduling agent — plain-language opt-out request",
          });
        } else {
          console.error(
            `[Appointment Agent] lead=${lead.id} asked to opt out but has no usable ${isSms ? "phone" : "email"} to suppress.`,
          );
        }

        const finalTranscript = [
          ...transcript,
          { role: "agent", content: decision.message, at: new Date().toISOString() },
        ];
        await prisma.schedulingConversation.update({
          where: { id: convoId },
          data: { transcript: finalTranscript, status: "CLOSED" },
        });
        console.warn(`[Appointment Agent] lead=${lead.id} requested opt-out — suppressed and conversation closed.`);
      });
      return { status: "opted-out" };
    }

    if (decision.action === "escalate") {
      await step.run("act-escalate", async () => {
        await escalate(
          lead,
          channel,
          convoId,
          transcript,
          decision.handoff_reason || decision.message,
          decision.message,
        );
      });
      return { status: "escalated" };
    }

    if (decision.action === "book") {
      const valid = slots.list.some((s) => s.iso === decision.slot_iso);
      const booking = valid
        ? await step.run("book-slot", async () =>
          bookSlot({
            leadId: lead.id,
            startTime: decision.slot_iso,
            title: "Model Home Visit",
            locationType: decision.location_type || "VIRTUAL",
            agentId: slots.agentId,
            bookedVia: "AI_AGENT",
          })
        )
        : { success: false, conflict: true };

      await step.run("respond-booking", async () => {
        if (booking.success) {
          const link = booking.appointment.meetingLink;
          const confirm = `${decision.message}${link ? `\n\nVideo link: ${link}` : ""}`;
          await sendLeadMessage(lead, channel, confirm, "Your visit is confirmed");
          const finalTranscript = [...transcript, { role: "agent", content: confirm, at: new Date().toISOString() }];
          await prisma.schedulingConversation.update({
            where: { id: convoId },
            data: { transcript: finalTranscript, status: "BOOKED" },
          });
        } else {
          const reoffer = `Sorry — that time was just taken. Here are the next available options:\n${slots.list
            .slice(0, 3)
            .map((s) => `• ${s.label}`)
            .join("\n")}\nWhich one works?`;
          await sendLeadMessage(lead, channel, reoffer, "Let's find another time");
          const finalTranscript = [
            ...transcript,
            { role: "agent", content: reoffer, at: new Date().toISOString() },
          ];
          await prisma.schedulingConversation.update({
            where: { id: convoId },
            data: { transcript: finalTranscript, offeredSlots: slots.list.map((s) => s.iso), turnCount: { increment: 1 } },
          });
        }
      });
      return { status: booking.success ? "booked" : "reoffered" };
    }

    await step.run("respond-reply", async () => {
      const subject = decision.used_kb
        ? `Re: your question for ${lead.company?.name || "us"}`
        : slots.list.length
          ? "Scheduling your visit"
          : `A message from ${lead.company?.name || "us"}`;
      await sendLeadMessage(lead, channel, decision.message, subject);
      const finalTranscript = [...transcript, { role: "agent", content: decision.message, at: new Date().toISOString() }];
      await prisma.schedulingConversation.update({
        where: { id: convoId },
        data: { transcript: finalTranscript, offeredSlots: slots.list.map((s) => s.iso), turnCount: { increment: 1 } },
      });
    });

    return { status: "replied" };
  }
);


export const appointmentReminders = inngest.createFunction(
  { id: "appointment-reminders", triggers: [{ cron: "*/15 * * * *" }] },
  async ({ step }) => {
    const now = Date.now();

    const result = await step.run("send-due-reminders", async () => {
      const upcoming = await prisma.salesAppointment.findMany({
        where: {
          status: "CONFIRMED",
          time: { gte: new Date(now), lte: new Date(now + 25 * 60 * 60 * 1000) },
          OR: [{ reminder24Sent: false }, { reminder1Sent: false }],
        },
        include: { lead: { include: { company: true } } },
      });
      const { formatSlotLabel } = await import("../../lib/scheduling.js");
      const settingsByCompany = new Map();
      const settingFor = async (companyId) => {
        if (!settingsByCompany.has(companyId)) {
          settingsByCompany.set(companyId, await getAvailabilitySetting(companyId));
        }
        return settingsByCompany.get(companyId);
      };

      let sent = 0;
      for (const appt of upcoming) {
        const msToStart = appt.time.getTime() - now;
        const hours = msToStart / (60 * 60 * 1000);
        const setting = await settingFor(appt.lead.companyId);
        const reminderHours = setting.reminderHours || [24, 1];
        const tz = appt.leadTimezone || setting.timezone;

        let window = null;
        if (reminderHours.includes(24) && !appt.reminder24Sent && hours <= 24 && hours > 1) window = "24h";
        else if (reminderHours.includes(1) && !appt.reminder1Sent && hours <= 1 && hours > 0) window = "1h";
        if (!window) continue;

        const when = formatSlotLabel(appt.time, tz);
        const meet = appt.meetingLink ? ` Join: ${appt.meetingLink}` : "";
        const text = `Reminder: your ${appt.title} is ${window === "1h" ? "in about an hour" : "tomorrow"} — ${when}.${meet}`;

        try {
          await sendLeadMessage(appt.lead, appt.lead.phone ? "SMS" : "EMAIL", text, `Reminder: ${appt.title}`);
        } catch (e) {
          console.error("[Reminders] send failed:", e.message);
          continue;
        }

        await prisma.salesAppointment.update({
          where: { id: appt.id },
          data: window === "24h" ? { reminder24Sent: true } : { reminder1Sent: true },
        });
        sent++;
      }
      return { checked: upcoming.length, sent };
    });

    return result;
  }
);

async function escalate(lead, channel, convoId, transcript, reason, leadMessage) {
  const text =
    leadMessage?.trim() ||
    `Thanks ${lead.firstName} — I'll have a member of our team reach out to you personally to finish setting this up.`;
  await sendLeadMessage(lead, channel, text, "A team member will follow up");
  const finalTranscript = [...transcript, { role: "agent", content: text, at: new Date().toISOString() }];

  await prisma.schedulingConversation.update({
    where: { id: convoId },
    data: { transcript: finalTranscript, status: "ESCALATED" },
  });

  try {
    const { smtpConfig } = await getMessagingConfig(lead.companyId);
    const agentId = await resolveAgentId(lead);
    const agent = agentId ? await prisma.user.findUnique({ where: { id: agentId }, select: { email: true } }) : null;
    const to = agent?.email || lead.company?.email;
    if (to) {
      await MailService.sendEmail({
        to,
        subject: `Action needed: scheduling handoff for ${lead.firstName} ${lead.lastName}`,
        html: Templates.getEscalationEmail(
          `${lead.firstName} ${lead.lastName}`,
          lead.email || lead.phone || "no contact",
          reason
        ),
        smtpConfig,
      });
    }
  } catch (e) {
    console.error("[Appointment Agent] escalation notify failed:", e.message);
  }
}
