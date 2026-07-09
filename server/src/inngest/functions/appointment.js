import Anthropic from "@anthropic-ai/sdk";
import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { MailService } from "../../services/mail-service.js";
import { sendSms } from "../../services/sms.service.js";
import { ComplianceService } from "../../services/compliance-service.js";
import { getMessagingConfig } from "../../lib/messaging-config.js";
import {
  getAvailableSlots,
  bookSlot,
  resolveAgentId,
  leadTimezone,
  getAvailabilitySetting,
} from "../../services/scheduling-service.js";
import { query as kbQuery } from "../../services/vector-store.service.js";

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const MAX_TURNS = 8;

function brandedEmail(companyName, bodyText) {
  return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border:1px solid #eaeaea;border-radius:12px;overflow:hidden;">
      <div style="background:#0F3B3D;padding:24px 40px;border-bottom:3px solid #b48c3c;">
        <h1 style="color:#fff;margin:0;font-size:20px;">${companyName}</h1>
      </div>
      <div style="padding:32px 40px;color:#334155;line-height:1.7;font-size:16px;">
        ${bodyText.replace(/\n/g, "<br />")}
      </div>
      <div style="padding:0 40px 24px;color:#94a3b8;font-size:12px;">This is an automated scheduling assistant.</div>
    </div>`;
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

async function resolveMode(lead, campaignId) {
  let campaign = null;
  if (campaignId) {
    campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { appointmentMode: true } });
  } else {
    const enr = await prisma.campaignEnrollment.findFirst({
      where: { leadId: lead.id },
      orderBy: { updatedAt: "desc" },
      include: { campaign: { select: { appointmentMode: true } } },
    });
    campaign = enr?.campaign || null;
  }
  const company = await prisma.company.findUnique({ where: { id: lead.companyId }, select: { appointmentMode: true } });
  const companyMode = company?.appointmentMode || "AI";
  if (!campaign || campaign.appointmentMode === "INHERIT") return companyMode;
  return campaign.appointmentMode;
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
    "Produce your reply to the lead and the action to take. Use 'book' ONLY when the lead has clearly agreed to one of the available slots (slot_iso MUST be one of the provided slot ISO values). Use 'escalate' if the lead genuinely needs a human (a complaint, a demand you cannot satisfy, or a factual question the knowledge base does not answer). Otherwise use 'reply' to answer the lead's question(s) and/or offer/confirm visit times.",
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
    return "No knowledge-base context was retrieved for this message. Answer only from what you are certain of; if you don't know, offer to have a team member follow up.";
  }
  const body = chunks
    .map((c, i) => `[${i + 1}] Source: ${c.name || "Company document"}${c.category ? ` (${c.category})` : ""}\n${c.text}`)
    .join("\n\n");
  return `Company Knowledge Base — use ONLY this to answer factual questions about the company, homes, communities, pricing, process, and warranty. Do not invent facts beyond it:\n\n${body}`;
}

export async function runClaudeTurn({ lead, company, channel, transcript, slots, timezone, kbChunks }) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const slotList = slots.map((s, i) => `${i + 1}. ${s.label}  [iso:${s.iso}]`).join("\n") || "(no slots currently available)";
  const channelGuidance =
    channel === "SMS"
      ? "This is an SMS conversation. Keep replies under 320 characters, plain text, no markdown."
      : "This is an email conversation. Keep replies concise and friendly.";

  const system = `You are the automated sales assistant for ${company.name}, a homebuilder. You are NOT a human and must say so if asked. You have two jobs, in this order of priority based on what the lead needs:
1. ANSWER the lead's questions about ${company.name} — who we are, our homes and communities, pricing, the buying process, and warranty — using the Company Knowledge Base below. Leads often know nothing about us, so be genuinely helpful.
2. HELP the lead book a model-home visit or sales consultation when they show interest or ask to meet.

Lead: ${lead.firstName} ${lead.lastName}. Times are in ${timezone}.

${formatKbContext(kbChunks)}

Available visit slots (offer these; NEVER invent times):
${slotList}

Rules:
- If the lead asks a question, answer it first using the Knowledge Base. Set used_kb=true when you relied on it. If the Knowledge Base doesn't cover it and it's a factual question you can't answer, don't guess — say a team member will follow up (use 'escalate' if they clearly need a person).
- When the lead wants to meet/visit/book, offer 2-4 available slots. If they propose a specific time, match it to the closest AVAILABLE slot; if none matches, say so and offer the nearest alternatives.
- Book ONLY when the lead clearly confirms one of the available slots. Copy its iso value exactly into slot_iso. Booking uses this lead's own details automatically — you do not need to ask for their name/email.
- You may answer a question and offer times in the same reply when it's natural to do so.
- Never promise anything the Knowledge Base doesn't support. Be warm, brief, professional.
- ${channelGuidance}

Always reply by calling the 'respond' tool.`;

  const messages = toAnthropicMessages(transcript);
  if (messages.length === 0) messages.push({ role: "user", content: "(the lead replied to our outreach expressing interest)" });

  const resp = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 700,
    system,
    tools: [RESPOND_TOOL],
    tool_choice: { type: "tool", name: "respond" },
    messages,
  });

  const toolUse = resp.content.find((b) => b.type === "tool_use" && b.name === "respond");
  if (!toolUse) {
    const text = resp.content.find((b) => b.type === "text")?.text;
    return { action: "reply", message: text || "Could you let me know which time works best for you?" };
  }
  return toolUse.input;
}


export const appointmentSchedulingAgent = inngest.createFunction(
  {
    id: "appointment-scheduling-agent",
    concurrency: [{ key: "event.data.leadId", limit: 1 }],
    triggers: [{ event: "lead.reply.received" }],
  },
  async ({ event, step }) => {
    const { leadId, channel = "EMAIL", body = "", campaignId } = event.data;

    const ctx = await step.run("load-context", async () => {
      const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { company: true } });
      if (!lead) return { stop: "lead-not-found" };

      const mode = await resolveMode(lead, campaignId);
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
      return { lead, mode, convoId: convo.id, transcript: convo.transcript || [], turnCount: convo.turnCount || 0 };
    });

    if (ctx.stop) return { status: "skipped", reason: ctx.stop };
    const { lead, mode, convoId } = ctx;

    if (mode === "SIMPLE") {
      await step.run("send-booking-link", async () => {
        const portal = process.env.NEXT_PUBLIC_URL || "http://localhost:3000";
        const link = `${portal}/book/${lead.id}`;
        const text = `Hi ${lead.firstName}, thanks for your interest! Pick a time that works for you here: ${link}`;
        const sent = await sendLeadMessage(lead, channel, text, "Book your visit");
        await prisma.leadTimeline.create({
          data: {
            leadId: lead.id,
            type: sent.channel === "SMS" ? "SMS_SENT" : "EMAIL_SENT",
            description: `Appointment agent (simple mode) sent booking link`,
            metadata: { link, channel: sent.channel },
          },
        });
        await prisma.schedulingConversation.update({ where: { id: convoId }, data: { status: "CLOSED", mode } });
      });
      return { status: "sent-booking-link" };
    }

    const transcript = [...ctx.transcript, { role: "lead", content: body, at: new Date().toISOString() }];

    if (ctx.turnCount >= MAX_TURNS) {
      await step.run("escalate-max-turns", async () => {
        await escalate(lead, channel, convoId, transcript, "Reached maximum automated turns without booking.");
      });
      return { status: "escalated", reason: "max-turns" };
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
        // Postgres full-text search already returns only term-matching rows,
        // ranked by ts_rank — take the top matches directly.
        const chunks = await kbQuery(lead.companyId, q, 5);
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
          const sent = await sendLeadMessage(lead, channel, confirm, "Your visit is confirmed");
          const finalTranscript = [...transcript, { role: "agent", content: confirm, at: new Date().toISOString() }];
          await prisma.schedulingConversation.update({
            where: { id: convoId },
            data: { transcript: finalTranscript, status: "BOOKED" },
          });
          await prisma.leadTimeline.create({
            data: {
              leadId: lead.id,
              type: sent.channel === "SMS" ? "SMS_SENT" : "EMAIL_SENT",
              description: `Appointment agent confirmed booking`,
              metadata: { channel: sent.channel, appointmentId: booking.appointment.id },
            },
          });
        } else {
          const reoffer = `Sorry — that time was just taken. Here are the next available options:\n${slots.list
            .slice(0, 3)
            .map((s) => `• ${s.label}`)
            .join("\n")}\nWhich one works?`;
          const sent = await sendLeadMessage(lead, channel, reoffer, "Let's find another time");
          const finalTranscript = [
            ...transcript,
            { role: "agent", content: reoffer, at: new Date().toISOString() },
          ];
          await prisma.schedulingConversation.update({
            where: { id: convoId },
            data: { transcript: finalTranscript, offeredSlots: slots.list.map((s) => s.iso), turnCount: { increment: 1 } },
          });
          await logAgentReply(lead, sent);
        }
      });
      return { status: booking.success ? "booked" : "reoffered" };
    }

    await step.run("respond-reply", async () => {
      const subject = slots.list.length ? "Scheduling your visit" : `Re: your question for ${lead.company?.name || "us"}`;
      const sent = await sendLeadMessage(lead, channel, decision.message, subject);
      const finalTranscript = [...transcript, { role: "agent", content: decision.message, at: new Date().toISOString() }];
      await prisma.schedulingConversation.update({
        where: { id: convoId },
        data: { transcript: finalTranscript, offeredSlots: slots.list.map((s) => s.iso), turnCount: { increment: 1 } },
      });
      const citations =
        decision.used_kb && kb.chunks.length
          ? [...new Set(kb.chunks.map((c) => c.name).filter(Boolean))]
          : [];
      await logAgentReply(lead, sent, citations);
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

      let sent = 0;
      for (const appt of upcoming) {
        const msToStart = appt.time.getTime() - now;
        const hours = msToStart / (60 * 60 * 1000);
        const setting = await getAvailabilitySetting(appt.lead.companyId);
        const reminderHours = setting.reminderHours || [24, 1];
        const tz = appt.leadTimezone || setting.timezone;

        let window = null;
        if (reminderHours.includes(24) && !appt.reminder24Sent && hours <= 24 && hours > 1) window = "24h";
        else if (reminderHours.includes(1) && !appt.reminder1Sent && hours <= 1 && hours > 0) window = "1h";
        if (!window) continue;

        const { formatSlotLabel } = await import("../../lib/scheduling.js");
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

async function logAgentReply(lead, sent, citations = []) {
  await prisma.leadTimeline.create({
    data: {
      leadId: lead.id,
      type: sent.channel === "SMS" ? "SMS_SENT" : "EMAIL_SENT",
      description: `Sales agent replied: "${(sent.body || "").slice(0, 80)}${(sent.body || "").length > 80 ? "..." : ""}"`,
      metadata: { channel: sent.channel, ...(citations.length ? { kbCitations: citations } : {}) },
    },
  });
}

async function escalate(lead, channel, convoId, transcript, reason) {
  const text = `Thanks ${lead.firstName} — I'll have a member of our team reach out to you personally to finish setting this up.`;
  const sent = await sendLeadMessage(lead, channel, text, "A team member will follow up");
  const finalTranscript = [...transcript, { role: "agent", content: text, at: new Date().toISOString() }];

  await prisma.schedulingConversation.update({
    where: { id: convoId },
    data: { transcript: finalTranscript, status: "ESCALATED" },
  });
  await prisma.leadTimeline.create({
    data: {
      leadId: lead.id,
      type: "SYNC_UPDATE",
      description: `Appointment agent escalated to human. Reason: ${reason}`,
      metadata: { channel: sent.channel, reason },
    },
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
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <p>The scheduling assistant could not finish booking <strong>${lead.firstName} ${lead.lastName}</strong> (${lead.email || lead.phone || "no contact"}).</p>
          <p><strong>Reason:</strong> ${reason}</p>
          <p>Please follow up to complete the appointment.</p>
        </div>`,
        smtpConfig,
      });
    }
  } catch (e) {
    console.error("[Appointment Agent] escalation notify failed:", e.message);
  }
}
