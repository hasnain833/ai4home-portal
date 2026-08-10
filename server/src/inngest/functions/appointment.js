import { toolCall } from "../../lib/llm.js";
import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { MailService } from "../../services/mail-service.js";
import { sendSms } from "../../services/sms.service.js";
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
import { query as kbQuery } from "../../services/vector-store.service.js";
import { KB_SCOPES, buildBrandContext } from "../../lib/sales-ai.js";
import { deadLetterJob } from "../../lib/dead-letter.js";
import { redactPII, minimalLeadContext } from "../../lib/utils.js";
import { getOrCreateLeadBookingToken } from "../../lib/public-tokens.js";

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
  const { smtpConfig, smsConfig } = await getMessagingConfig(lead.companyId);
  if (channel === "SMS" && lead.phone) {
    const body = ComplianceService.addSmsOptOutSuffix(text);
    await sendSms({ to: lead.phone, body, smsConfig });
    return { channel: "SMS", body };
  }
  if (lead.email) {
    await MailService.sendEmail({
      to: lead.email,
      subject: subject || "Scheduling your visit",
      html: brandedEmail(lead.company?.name || "Scheduling", text),
      fromName: lead.company?.name || undefined,
      smtpConfig,
    });
    return { channel: "EMAIL", body: text };
  }
  return { channel, body: text, skipped: true };
}

async function resolveFlowConfig(lead, campaignId) {
  const campaignSelect = { appointmentMode: true, agentMaxTurns: true };

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
    select: { appointmentMode: true, agentMaxTurns: true },
  });

  const companyMode = company?.appointmentMode || "AI";
  const mode =
    !campaign || campaign.appointmentMode === "INHERIT" ? companyMode : campaign.appointmentMode;
  const rawMaxTurns =
    campaign?.agentMaxTurns ?? company?.agentMaxTurns ?? DEFAULT_MAX_TURNS;

  return { mode, maxTurns: clampMaxTurns(rawMaxTurns) };
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
    "Produce your reply to the lead and the action to take. Use 'reply' for the vast majority of turns — answering questions, discovery, building interest, handling objections, and offering visit times. Use 'book' ONLY when the lead has clearly agreed to one of the available slots (slot_iso MUST be one of the provided slot ISO values). Use 'escalate' only when a human must take over: a complaint or dispute, anything legal or adversarial, a demand you cannot satisfy, or an explicit request to speak with a person right now. Answering a question about homes, communities, pricing, or the buying process is NOT a reason to escalate.",
  input_schema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["reply", "book", "escalate"] },
      message: { type: "string", description: "The exact message text to send to the lead. On 'escalate' this is what the lead reads, so acknowledge their concern warmly and tell them a team member will reach out." },
      slot_iso: { type: "string", description: "Required when action is 'book': the chosen slot's ISO start time, copied verbatim from the available slots." },
      location_type: { type: "string", enum: ["VIRTUAL", "ONSITE"], description: "Visit type when booking. Default VIRTUAL." },
      used_kb: { type: "boolean", description: "True if your answer drew on the Company Knowledge Base context." },
      handoff_reason: { type: "string", description: "Required when action is 'escalate': a short internal note for the human team explaining what the lead needs and what you already know about them. The lead never sees this." },
    },
    required: ["action", "message"],
  },
};

export function formatKbContext(chunks) {
  if (!chunks || chunks.length === 0) {
    return "No knowledge-base context was retrieved for this question. Keep the conversation going warmly and keep asking about what they're looking for, but do NOT state specific details about homes, communities, pricing, or financing. Say you'll get those exact details from a consultant — and use that as a natural reason to set up a conversation.";
  }
  const body = chunks
    .map((c, i) => `[${i + 1}] Source: ${c.name || "Company document"}${c.category ? ` (${c.category})` : ""}\n${c.text}`)
    .join("\n\n");
  return `Company Knowledge Base — reference material. Use this to actively answer the lead's questions about homes, communities, pricing, buying process, and financing. ALWAYS ground your answers in this text. If a question cannot be answered by this text, offer to connect them with a human sales consultant.\n\n${body}`;
}

export async function runClaudeTurn({ lead, company, channel, transcript, slots, timezone, kbChunks }) {
  const slotList = slots.map((s, i) => `${i + 1}. ${s.label}  [iso:${s.iso}]`).join("\n") || "(no slots currently available)";
  const channelGuidance =
    channel === "SMS"
      ? "This is an SMS conversation. Keep replies under 320 characters, plain text, no markdown."
      : channel === "WEBCHAT"
        ? "This is a live web chat. Keep replies short and snappy — a couple of sentences, plain text, no markdown."
        : "This is an email conversation. Keep replies concise and friendly.";

  const brandContext = buildBrandContext(company);

  const system = `# Identity
You are ${company.name}'s AI Sales Consultant — an experienced new-home sales professional, not a support agent and not a generic FAQ bot.
You help people picture themselves in the right home. You learn what they actually need, show them why ${company.name} fits, and guide genuinely interested buyers to a consultation with a ${company.name} sales representative.
Every conversation has one destination: an excited, qualified buyer with a booked consultation.

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
They're ready when you know at least what they're looking for, roughly where, and their timeline — AND they've shown real interest: asking follow-up questions, reacting positively, or asking about price, availability, or next steps.
Go straight to scheduling, regardless of stage, if they ask to see a home, ask to talk to someone, or ask what the next step is.
Hold off and keep helping if they're only browsing with no timeline, or still giving short guarded answers. Stay useful and warm — a lead who isn't ready today may be ready next month.

# Making the Ask
Be confident and specific, and frame it as value for them, not a favor for you:
"The best next step is 30 minutes with one of our consultants — they can walk you through the floor plans and what's actually available in that price range. I've got a couple of times open this week."
Then offer real times from the list below. If they hesitate, don't ask twice in a row — go back to being helpful, then try again later in the conversation.

# Knowledge Base Rules
Only state facts that come from the Knowledge Base. Never guess, never invent, never estimate a price, date, or availability.
When you don't have something, turn the gap into a reason to meet: "I don't have that exact detail in front of me — our consultant can pull it up for you. Want me to set that up?"

${formatKbContext(kbChunks)}

# Recommending Communities
- Mention only ONE or TWO communities, with a short reason tied to what THEY told you. Wait for them to ask for more.
- Help before selling. Educate before recommending.
- Only claim benefits the Knowledge Base supports.

# Objection Handling
Empathize first, reframe with a real fact, then move forward. Common ones: price, timing, financing, waiting for rates, "just looking".
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

  const input = await toolCall({ system, messages, tool: RESPOND_TOOL, maxTokens: 700 });
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
          `Reached the ${maxTurns}-turn automated limit without booking.`,
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
      if (!q) return { chunks: [] };
      try {
        // SW-KB-004: scope the scheduling agent to FAQs/policy/community docs.
        const chunks = await kbQuery(lead.companyId, q, 5, KB_SCOPES.scheduling, "appointment-agent");
        return { chunks };
      } catch (e) {
        console.error("[Appointment Agent] KB retrieval failed:", e.message);
        return { chunks: [] };
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
      });
    });

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
  // The agent's own wording is used when it has it (it acknowledges the specific concern —
  // important for complaints, where the generic scheduling line reads as tone-deaf).
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
