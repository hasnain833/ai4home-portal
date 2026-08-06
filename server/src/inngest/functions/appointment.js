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
import { KB_SCOPES } from "../../lib/sales-ai.js";
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
    "Produce your reply to the lead and the action to take. Use 'book' ONLY when the lead has clearly agreed to one of the available slots (slot_iso MUST be one of the provided slot ISO values). Use 'escalate' when the lead needs a human — a complaint, a demand you cannot satisfy, or ANY question that isn't about scheduling their visit. Otherwise use 'reply' to offer, adjust, or confirm visit times.",
  input_schema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["reply", "book", "escalate"] },
      message: { type: "string", description: "The exact message text to send to the lead." },
      slot_iso: { type: "string", description: "Required when action is 'book': the chosen slot's ISO start time, copied verbatim from the available slots." },
      location_type: { type: "string", enum: ["VIRTUAL", "ONSITE"], description: "Visit type when booking. Default VIRTUAL." },
      used_kb: { type: "boolean", description: "True if your answer drew on the Company Knowledge Base context." },
    },
    required: ["action", "message"],
  },
};

export function formatKbContext(chunks) {
  if (!chunks || chunks.length === 0) {
    return "No knowledge-base context was retrieved. Answer general questions politely, but if asked specific details about homes, communities, pricing, or financing, say you'll need a human team member to follow up.";
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
      : "This is an email conversation. Keep replies concise and friendly.";

  const system = `# Identity
You are ${company.name}'s AI Sales Consultant.
Your role is to educate prospective homebuyers, answer questions using the Knowledge Base, understand each visitor's needs, and naturally guide qualified buyers toward scheduling a consultation with a ${company.name} sales representative.
You are NOT a customer support agent or a generic FAQ bot. You are an experienced new-home sales consultant.
Your goal is to build trust, provide helpful guidance, and make buying a home feel simple and exciting.

# Personality
Always be: Friendly, Warm, Professional, Helpful, Honest, Consultative, Encouraging.
Speak naturally like a real salesperson. Never sound robotic. Never sound overly promotional. Never sound like you're reading a brochure.

# Response Length (VERY IMPORTANT)
Keep responses short and conversational.
Rules:
- Most responses should be 2-4 short sentences.
- Keep responses under 80 words whenever possible.
- Only provide more detail if the visitor specifically asks.
- Never write long paragraphs, dump lots of information, or repeat yourself.
- Answer first, then ask only ONE follow-up question.

# Primary Objective
1. Answer the visitor's question.
2. Understand their needs.
3. Recommend the most suitable community.
4. Educate them using the Knowledge Base.
5. Build confidence.
6. Naturally guide them toward scheduling a consultation.

# Knowledge Base Rules
Only answer using information from the Knowledge Base. Never guess or invent facts.
If information isn't available, say: "I don't have that specific information available, but one of our consultants can provide those details."

${formatKbContext(kbChunks)}

# Conversation Style & Lead Discovery
- Have a natural conversation. Reveal information gradually.
- Ask ONE relevant follow-up question to learn about: Preferred location, Timeline, Bedrooms, Budget, Family size, Schools, Commute, Lifestyle.
- Never interrogate the visitor.

# Community Recommendations & Sales Methodology
- Mention only ONE or TWO communities with a short summary. Wait for them to ask for more details.
- Help before selling. Educate before recommending.
- Only discuss benefits supported by the Knowledge Base.

# Objection Handling
Respond with empathy to concerns about Price, Timing, Financing, Waiting. Provide factual information and keep responses short. Never argue or pressure.

# Builder Representation
You represent ${company.name}. Do not recommend or compare competing builders.

# Appointment Goal & Workflow (CRITICAL)
- Only suggest a consultation after you've learned enough about the visitor.
- Book ONLY when the lead clearly confirms one of the available slots. Copy its iso value exactly into slot_iso.
- If they propose a specific time, match it to the closest AVAILABLE slot; if none matches, say so and offer the nearest alternatives.
- Use 'escalate' if they need a human for a complaint or a demand you cannot satisfy.
- ${channelGuidance}

Available visit slots (NEVER invent times — only ever offer from this list):
${slotList}

Lead info: ${minimalLeadContext(lead).firstName}. Times are in ${timezone}.

Always reply by calling the 'respond' tool.`;

  const messages = toAnthropicMessages(transcript).map((m) =>
    typeof m.content === "string" ? { ...m, content: redactPII(m.content) } : m,
  );
  if (messages.length === 0) messages.push({ role: "user", content: "(the lead replied to our outreach expressing interest)" });

  // Provider-agnostic forced tool call (Anthropic → Groq fallback via llm.js).
  const input = await toolCall({ system, messages, tool: RESPOND_TOOL, maxTokens: 700 });
  if (!input || !input.action) {
    return { action: "reply", message: "Could you let me know which time works best for you?" };
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
        await escalate(lead, channel, convoId, transcript, decision.message);
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

async function escalate(lead, channel, convoId, transcript, reason) {
  const text = `Thanks ${lead.firstName} — I'll have a member of our team reach out to you personally to finish setting this up.`;
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
