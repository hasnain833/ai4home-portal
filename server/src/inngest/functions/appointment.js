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

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
// Escalate to a human once the agent has taken this many turns without booking.
const MAX_TURNS = 4;

// ─── Outbound helper ──────────────────────────────────────────────────────────

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

// ─── Mode resolution ──────────────────────────────────────────────────────────

// OFF | SIMPLE | AI — campaign overrides company default unless it INHERITs.
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

// ─── Claude turn ──────────────────────────────────────────────────────────────

// Collapse a transcript into alternating Anthropic messages (merging consecutive
// same-role turns, which the API does not allow).
function toAnthropicMessages(transcript) {
  const msgs = [];
  for (const t of transcript) {
    const role = t.role === "agent" ? "assistant" : "user";
    const last = msgs[msgs.length - 1];
    if (last && last.role === role) last.content += `\n${t.content}`;
    else msgs.push({ role, content: t.content });
  }
  // Anthropic requires the first message to be from the user.
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  return msgs;
}

const RESPOND_TOOL = {
  name: "respond",
  description:
    "Produce your reply to the lead and the action to take. Use 'book' ONLY when the lead has clearly agreed to one of the available slots (slot_iso MUST be one of the provided slot ISO values). Use 'escalate' if the lead needs a human or is asking something you cannot handle. Otherwise use 'propose' to offer/confirm times or answer briefly.",
  input_schema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["propose", "book", "escalate"] },
      message: { type: "string", description: "The exact message text to send to the lead." },
      slot_iso: { type: "string", description: "Required when action is 'book': the chosen slot's ISO start time, copied verbatim from the available slots." },
      location_type: { type: "string", enum: ["VIRTUAL", "ONSITE"], description: "Visit type when booking. Default VIRTUAL." },
    },
    required: ["action", "message"],
  },
};

async function runClaudeTurn({ lead, company, channel, transcript, slots, timezone }) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const slotList = slots.map((s, i) => `${i + 1}. ${s.label}  [iso:${s.iso}]`).join("\n") || "(no slots currently available)";
  const channelGuidance =
    channel === "SMS"
      ? "This is an SMS conversation. Keep replies under 320 characters, plain text, no markdown."
      : "This is an email conversation. Keep replies concise and friendly.";

  const system = `You are an automated appointment-scheduling assistant for ${company.name}, a homebuilder. You are NOT a human and must make that clear if asked. Your only job is to help this lead book a model-home visit or sales consultation.

Lead: ${lead.firstName} ${lead.lastName}. Times are in ${timezone}.

Available slots (offer these; never invent times):
${slotList}

Rules:
- Offer 2-4 of the available slots at a time. If the lead proposes a specific time, match it to the closest AVAILABLE slot; if none matches, say so and offer the nearest alternatives.
- Book ONLY when the lead clearly confirms one of the available slots. Copy its iso value exactly into slot_iso.
- For off-topic questions (pricing, product details, complaints), answer very briefly if trivial, otherwise politely say a team member will follow up and use 'escalate'.
- Never promise anything beyond scheduling. Be warm, brief, professional.
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
    return { action: "propose", message: text || "Could you let me know which time works best for you?" };
  }
  return toolUse.input;
}

// ─── Function ─────────────────────────────────────────────────────────────────

export const appointmentSchedulingAgent = inngest.createFunction(
  {
    id: "appointment-scheduling-agent",
    // One turn per lead at a time so two fast replies can't double-book or interleave.
    concurrency: [{ key: "event.data.leadId", limit: 1 }],
    triggers: [{ event: "lead.reply.received" }],
  },
  async ({ event, step }) => {
    const { leadId, channel = "EMAIL", body = "", campaignId } = event.data;

    // 1) Load lead + decide mode + load/seed the conversation.
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

    // 2) SIMPLE mode: one-shot booking link, then close.
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

    // 3) AI mode. Record the inbound message first.
    const transcript = [...ctx.transcript, { role: "lead", content: body, at: new Date().toISOString() }];

    // Escalate if we've already exhausted our turn budget.
    if (ctx.turnCount >= MAX_TURNS) {
      await step.run("escalate-max-turns", async () => {
        await escalate(lead, channel, convoId, transcript, "Reached maximum automated turns without booking.");
      });
      return { status: "escalated", reason: "max-turns" };
    }

    // 4) Compute current availability (durable).
    const slots = await step.run("compute-slots", async () => {
      const setting = await getAvailabilitySetting(lead.companyId);
      const agentId = await resolveAgentId(lead);
      const tz = leadTimezone(lead, setting);
      const s = await getAvailableSlots({ companyId: lead.companyId, agentId, days: 14, limit: 8, displayTz: tz });
      return { tz, agentId, list: s.map((x) => ({ iso: x.iso, label: x.label })) };
    });

    // 5) Ask Claude what to do (durable; memoized on success).
    const decision = await step.run("claude-decide", async () => {
      return runClaudeTurn({
        lead,
        company: lead.company,
        channel,
        transcript,
        slots: slots.list,
        timezone: slots.tz,
      });
    });

    // 6) Act on the decision.
    if (decision.action === "escalate") {
      await step.run("act-escalate", async () => {
        await escalate(lead, channel, convoId, transcript, decision.message);
      });
      return { status: "escalated" };
    }

    if (decision.action === "book") {
      // Guardrail: the chosen slot must be one we actually offered/availability still has.
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
          // Slot was taken in the race — apologise and re-offer fresh slots.
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

    // action === "propose" (default)
    await step.run("respond-propose", async () => {
      const sent = await sendLeadMessage(lead, channel, decision.message, "Scheduling your visit");
      const finalTranscript = [...transcript, { role: "agent", content: decision.message, at: new Date().toISOString() }];
      await prisma.schedulingConversation.update({
        where: { id: convoId },
        data: { transcript: finalTranscript, offeredSlots: slots.list.map((s) => s.iso), turnCount: { increment: 1 } },
      });
      await logAgentReply(lead, sent);
    });

    return { status: "proposed" };
  }
);

// ─── Reminders (cron) ─────────────────────────────────────────────────────────
// Runs every 15 minutes and sends 24h / 1h reminders for upcoming confirmed
// appointments. Each reminder is sent at most once via the reminder24Sent /
// reminder1Sent flags. Honours the company's configured reminderHours (defaults
// [24, 1]); only the 24h and 1h reminders are backed by flags.

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

async function logAgentReply(lead, sent) {
  await prisma.leadTimeline.create({
    data: {
      leadId: lead.id,
      type: sent.channel === "SMS" ? "SMS_SENT" : "EMAIL_SENT",
      description: `Appointment agent replied: "${(sent.body || "").slice(0, 80)}${(sent.body || "").length > 80 ? "..." : ""}"`,
      metadata: { channel: sent.channel },
    },
  });
}

async function escalate(lead, channel, convoId, transcript, reason) {
  // Tell the lead a human will follow up.
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

  // Notify the owning agent / company so a human picks it up.
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
