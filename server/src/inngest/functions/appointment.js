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
import {
  DEFAULT_SYSTEM_TEMPLATE,
  DEFAULT_TOOL_DESCRIPTION,
  DEFAULT_KB_EMPTY_TEXT,
  renderTemplate,
} from "../../lib/sales-agent-prompt.js";

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

/** Subject line an emailed agent reply goes out under. */
export function replySubject({ usedKb, companyName, slotCount }) {
  const name = companyName || "us";
  if (usedKb) return `Re: your question for ${name}`;
  if (slotCount) return "Scheduling your visit";
  return `A message from ${name}`;
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
  description: DEFAULT_TOOL_DESCRIPTION,
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

export function formatKbContext(chunks, retrievalMethod = null, emptyText = DEFAULT_KB_EMPTY_TEXT) {
  if (!chunks || chunks.length === 0) {
    return emptyText;
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

export function buildAgentPrompt({
  lead,
  company,
  channel,
  slots = [],
  timezone,
  kbChunks,
  retrievalMethod = null,
  promptOverride = null,
}) {
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
  const brandVoiceBlock = brandContext ? `\n## Brand voice\n${brandContext}\n` : "";

  const systemTemplate = promptOverride?.systemTemplate || DEFAULT_SYSTEM_TEMPLATE;
  const kbEmptyText = promptOverride?.kbEmptyText || DEFAULT_KB_EMPTY_TEXT;
  const toolDescription = promptOverride?.toolDescription || DEFAULT_TOOL_DESCRIPTION;

  const kbContext = formatKbContext(kbChunks, retrievalMethod, kbEmptyText);

  const system = renderTemplate(systemTemplate, {
    companyName: company?.name || "",
    brandVoiceBlock,
    pacingGuidance,
    kbContext,
    channelGuidance,
    slotList,
    leadFirstName: minimalLeadContext(lead).firstName,
    timezone,
  });

  const tool =
    toolDescription === RESPOND_TOOL.description
      ? RESPOND_TOOL
      : { ...RESPOND_TOOL, description: toolDescription };

  return { system, tool, slotList, kbContext };
}

export async function runClaudeTurn({
  lead,
  company,
  channel,
  transcript,
  slots,
  timezone,
  kbChunks,
  retrievalMethod = null,
  promptOverride = null,
  forcePlatformKey = false,
}) {
  const { system, tool } = buildAgentPrompt({
    lead,
    company,
    channel,
    slots,
    timezone,
    kbChunks,
    retrievalMethod,
    promptOverride,
  });

  const messages = toAnthropicMessages(transcript).map((m) =>
    typeof m.content === "string" ? { ...m, content: redactPII(m.content) } : m,
  );
  if (messages.length === 0) messages.push({ role: "user", content: "(the lead replied to our outreach expressing interest)" });

  const input = await toolCall({ companyId: company?.id, system, messages, tool, maxTokens: 700, forcePlatformKey });
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
      const subject = replySubject({
        usedKb: decision.used_kb,
        companyName: lead.company?.name,
        slotCount: slots.list.length,
      });
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
