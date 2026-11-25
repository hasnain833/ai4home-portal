import { bookB2BMeeting, getPlatformSlots as openSlots } from "../services/website-sales.js";
import prisma from "../lib/prisma.js";
import { isLeadPhoneError } from "../lib/lead-phone.js";
import { queueSalesforceDeletion } from "../services/b2b-salesforce-sync.js";
import { adminHandler } from "../middlewares/auth.js";
import { PHONE_ERROR, sendSms, smsSent, toE164 } from "../services/sms.service.js";
import { renderB2BStep } from "../inngest/functions/b2b-campaign.js";
import { MailService } from "../services/mail-service.js";
import { Templates } from "../services/templates.js";
import { missingChannelsForSteps, notConfiguredMessage } from "../lib/messaging-config.js";
import { formatSlotLabel } from "../lib/scheduling.js";
import { updatePlatformAppointment, setAppointmentAssignee } from "../services/website-sales.js";
import { escapeHtml } from "../lib/utils.js";
import { toolCall, hasLLM, aiUnavailableMessage } from "../lib/llm.js";
import { renderTemplate } from "../prompts/template.js";
import { B2B_STEP_SYSTEM, B2B_EMAIL_RULES, B2B_SMS_RULES } from "../prompts/content.js";
import { PLATFORM_GUIDE } from "../prompts/help-agent.js";
import { randomUUID } from "node:crypto";
import { inngest } from "../lib/inngest.js";
import { journeyOnMeetingStatus } from "../lib/b2b-journey.js";
import { B2B_AUTO_ID, autoEnrollSoon } from "../services/b2b-auto-nurture.js";
import {
  B2B_LEAD_STATUSES,
  B2B_CLOSED_STATUSES,
  appUrl,
  getB2BAvailability,
  saveB2BAvailability,
  NOT_INTERESTED_REASON,
  endB2BJourney,
  meetingInvite,
  findLeadByUnsubscribeToken,
  remapStepIndex,
  validateSteps,
  validSendTime,
  cleanSteps,
  unknownPlaceholders,
  STARTER_TEMPLATES,
  exitB2BEnrollments,
  completeFinishedCampaigns,
  notifySuperAdmin,
  resolveShortLink,
} from "../lib/b2b.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;


const wrap = adminHandler("B2B");

/** Normalises a lead payload; returns { data } or { error }. */
function leadData(body, { partial = false } = {}) {
  const data = {};
  const str = (k) => (body[k] === undefined ? undefined : String(body[k] ?? "").trim());
  for (const k of ["companyName", "contactName", "website", "city", "notes"]) {
    const v = str(k);
    if (v !== undefined) data[k] = v || (k === "companyName" || k === "contactName" ? v : null);
  }
  if (body.email !== undefined) data.email = String(body.email || "").trim().toLowerCase();
  if (body.phone !== undefined) {
    const raw = String(body.phone || "").trim();
    if (raw && !toE164(raw)) return { error: PHONE_ERROR };
    data.phone = raw ? toE164(raw) : null;
  }
  // A CSV sends text; "no" must not count as consent.
  if (body.smsConsent !== undefined) data.smsConsentAt = /^(true|yes|y|1)$/i.test(String(body.smsConsent).trim()) ? new Date() : null;
  if (body.status !== undefined) {
    if (!B2B_LEAD_STATUSES.includes(body.status)) return { error: "Unknown status." };
    data.status = body.status;
  }
  if (!partial || data.companyName !== undefined) {
    if (!data.companyName) return { error: "Company name is required." };
  }
  if (!partial || data.email !== undefined) {
    if (!EMAIL_RE.test(data.email || "")) return { error: "A valid email is required." };
  }
  return { data };
}

// ---------- Leads ----------

const SEGMENT_PREFIX = "b2b.segment.";
const DEFAULT_SEGMENTS = [
  { id: "all", name: "All leads", filters: { status: "ALL", query: "", nurtureOnly: false }, builtIn: true },
  { id: "pipeline", name: "Sales pipeline", filters: { status: "INTERESTED", query: "", nurtureOnly: false }, builtIn: true },
];

export function b2bSegmentWhere(filters) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters) ||
      !["ALL", ...B2B_LEAD_STATUSES].includes(filters.status) ||
      typeof filters.query !== "string" || filters.query.length > 200 ||
      typeof filters.nurtureOnly !== "boolean" || Object.keys(filters).some((key) => !["status", "query", "nurtureOnly"].includes(key))) {
    throw new Error("Invalid segment filters.");
  }
  const where = {};
  if (filters.status !== "ALL") where.status = filters.status;
  if (filters.nurtureOnly) Object.assign(where, { marketingOptIn: true, emailOptOut: false });
  const query = filters.query.trim();
  if (query) where.OR = ["companyName", "contactName", "email", "city"].map((field) => ({ [field]: { contains: query, mode: "insensitive" } }));
  return where;
}

export async function findSegment(id) {
  const builtIn = DEFAULT_SEGMENTS.find((segment) => segment.id === id);
  if (builtIn) return builtIn;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = await prisma.platformSetting.findUnique({ where: { key: SEGMENT_PREFIX + id } });
  return row ? { id, ...row.value, builtIn: false } : null;
}

export const listSegments = wrap("Segments", async (_req, res) => {
  const rows = await prisma.platformSetting.findMany({ where: { key: { startsWith: SEGMENT_PREFIX } }, orderBy: { updatedAt: "desc" } });
  const segments = [...DEFAULT_SEGMENTS, ...rows.map((row) => ({ ...row.value, id: row.key.slice(SEGMENT_PREFIX.length), builtIn: false }))];
  res.json(await Promise.all(segments.map(async (segment) => ({ ...segment, count: await prisma.b2BLead.count({ where: b2bSegmentWhere(segment.filters) }) }))));
});

export const createSegment = wrap("Segment create", async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name || name.length > 80) return res.status(400).json({ message: "Enter a segment name of 1–80 characters." });
  try { b2bSegmentWhere(req.body.filters); } catch (error) { return res.status(400).json({ message: error.message }); }
  const filters = { ...req.body.filters, query: req.body.filters.query.trim() };
  const id = randomUUID();
  await prisma.platformSetting.create({ data: { key: SEGMENT_PREFIX + id, value: { name, filters } } });
  res.status(201).json({ id, name, filters, builtIn: false });
});

export const deleteSegment = wrap("Segment delete", async (req, res) => {
  const segment = await findSegment(req.params.id);
  if (!segment) return res.status(404).json({ message: "Segment not found." });
  if (segment.builtIn) return res.status(400).json({ message: "Built-in segments cannot be deleted." });
  await prisma.platformSetting.delete({ where: { key: SEGMENT_PREFIX + segment.id } });
  res.json({ success: true });
});

export const listLeads = wrap("Leads", async (req, res) => {
  const leads = await prisma.b2BLead.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      // ponytail: every lead loads at once with light inquiries; move to server paging past a few thousand leads.
      inquiries: req.query.lite ? false : { orderBy: { createdAt: "desc" }, take: 5 },
      enrollments: {
        where: { status: "ACTIVE" },
        select: { campaign: { select: { id: true, name: true } } },
      },
      appointments: {
        where: { status: "CONFIRMED", startTime: { gte: new Date() } },
        orderBy: { startTime: "asc" },
        take: 1,
        select: { startTime: true },
      },
    },
  });
  res.json(
    leads.map(({ enrollments, appointments, ...l }) => ({
      ...l,
      inquiries: l.inquiries || [],
      activeCampaigns: enrollments.map((e) => e.campaign),
      nextAppointment: appointments[0]?.startTime || null,
    })),
  );
});

export const createLead = wrap("Lead create", async (req, res) => {
  const { data, error } = leadData({ ...req.body, status: undefined });
  if (error) return res.status(400).json({ message: error });
  const exists = await prisma.b2BLead.findUnique({ where: { email: data.email } });
  if (exists) return res.status(409).json({ message: "A lead with that email already exists." });
  const lead = await prisma.b2BLead.create({ data: { ...data, source: "MANUAL" } });
  await autoEnrollSoon();
  res.status(201).json(lead);
});

export const importLeads = wrap("Lead import", async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 5000) : [];
  const valid = [];
  const seen = new Set();
  let invalid = 0;
  for (const row of rows) {
    let parsed = leadData({ ...row, status: undefined });
    // A malformed phone shouldn't cost us the lead; keep it email-only.
    if (parsed.error && row.phone) parsed = leadData({ ...row, phone: "", status: undefined });
    const { data, error } = parsed;
    if (error || seen.has(data.email)) {
      invalid++;
      continue;
    }
    seen.add(data.email);
    valid.push({ ...data, source: "CSV" });
  }
  let count = 0;
  const errors = [];
  for (let i = 0; i < valid.length; i += 100) {
    const batch = valid.slice(i, i + 100);
    try {
      const result = await prisma.b2BLead.createMany({ data: batch, skipDuplicates: true });
      count += result.count;
    } catch (error) {
      if (!isLeadPhoneError(error)) throw error;
      // The failed batch was rolled back. Isolate its conflicting rows while
      // keeping the normal path efficient for large files.
      for (const data of batch) {
        try {
          const result = await prisma.b2BLead.createMany({ data: [data], skipDuplicates: true });
          count += result.count;
        } catch (rowError) {
          if (!isLeadPhoneError(rowError)) throw rowError;
          errors.push({ email: data.email, reason: rowError.message });
        }
      }
    }
  }
  if (count) await autoEnrollSoon();
  res.json({ imported: count, duplicates: valid.length - count - errors.length, invalid, errors });
});

export const updateLead = wrap("Lead update", async (req, res) => {
  const { data, error } = leadData(req.body || {}, { partial: true });
  if (error) return res.status(400).json({ message: error });
  const lead = await prisma.b2BLead.findUnique({ where: { id: req.params.id } });
  if (!lead) return res.status(404).json({ message: "Lead not found." });
  if (data.email && data.email !== lead.email) {
    const taken = await prisma.b2BLead.findUnique({ where: { email: data.email } });
    if (taken) return res.status(409).json({ message: "Another lead already uses that email." });
  }
  // Re-saving the form must not move the date consent was first recorded.
  if (data.smsConsentAt && lead.smsConsentAt) delete data.smsConsentAt;
  const updated = await prisma.b2BLead.update({ where: { id: lead.id }, data });
  if (data.status && B2B_CLOSED_STATUSES.includes(data.status)) {
    await exitB2BEnrollments(lead.id, "STATUS");
    await endB2BJourney(lead.id);
  }
  res.json(updated);
});

export const setLeadAgentPaused = wrap("Lead agent pause", async (req, res) => {
  const lead = await prisma.b2BLead.findUnique({ where: { id: req.params.id } });
  if (!lead) return res.status(404).json({ message: "Lead not found." });
  const paused = !!req.body?.paused;
  if (paused) {
    await prisma.b2BLead.update({ where: { id: lead.id }, data: { agentPausedAt: new Date(), agentPausedUntil: null, agentPauseReason: "paused by the team" } });
    return res.json({ paused });
  }
  // Resuming a lead the AI marked Lost has to reopen it, or the AI still couldn't answer.
  const reopen = lead.status === "LOST" && lead.agentPauseReason === NOT_INTERESTED_REASON;
  await prisma.b2BLead.update({
    where: { id: lead.id },
    data: { agentPausedAt: null, agentPausedUntil: null, agentPauseReason: null, ...(reopen ? { status: "CONTACTED" } : {}) },
  });
  const waiting = await prisma.b2BMessage.findFirst({
    where: { leadId: lead.id, direction: "IN", handledAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (waiting && req.body?.answerWaiting) {
    await inngest.send({ name: "b2b.reply.received", data: { leadId: lead.id, channel: waiting.channel } });
  } else if (waiting) {
    await prisma.b2BMessage.updateMany({ where: { leadId: lead.id, direction: "IN", handledAt: null }, data: { handledAt: new Date() } });
  }
  res.json({ paused });
});

// One lead's history, newest first: what we sent, what they said, and what happened.
export const leadTimeline = wrap("Lead timeline", async (req, res) => {
  const lead = await prisma.b2BLead.findUnique({
    where: { id: req.params.id },
    include: {
      messages: { orderBy: { createdAt: "desc" }, take: 200 },
      appointments: true,
      enrollments: { include: { campaign: { select: { name: true } } } },
      inquiries: { select: { id: true, type: true, createdAt: true } },
    },
  });
  if (!lead) return res.status(404).json({ message: "Lead not found." });

  const sends = await prisma.messageUsage.findMany({
    where: { source: "b2b-campaign", OR: [{ leadId: lead.id }, { recipient: lead.email }] },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, channel: true, outcome: true, stepId: true, campaignId: true, createdAt: true, deliveredAt: true, openedAt: true, clickedAt: true, failedAt: true },
  });
  const campaignName = new Map(lead.enrollments.map((e) => [e.campaignId, e.campaign.name]));
  const campaignText = new Map(lead.messages.filter((m) => m.actor === "CAMPAIGN").map((m) => [m.note, m]));
  const delivery = (s) => (s.failedAt || s.outcome !== "sent" ? "failed" : s.clickedAt ? "clicked" : s.openedAt ? "opened" : s.deliveredAt ? "delivered" : "accepted");

  const items = [
    ...lead.messages.filter((m) => m.actor !== "CAMPAIGN").map((m) => ({
      id: m.id,
      at: m.createdAt,
      kind: m.actor === "AGENT" ? "agent" : "lead",
      title: `${m.actor === "AGENT" ? "AI replied" : "Lead replied"} by ${m.channel === "SMS" ? "text" : "email"}`,
      body: m.body,
      status: m.actor === "AGENT" ? m.outcome : null,
    })),
    ...sends.map((s) => ({
      id: s.id,
      at: s.createdAt,
      kind: "campaign",
      title: s.stepId?.startsWith("content:")
        ? `Journey ${s.channel === "SMS" ? "text" : "email"}`
        : `Campaign ${s.channel === "SMS" ? "text" : "email"}${s.campaignId && campaignName.get(s.campaignId) ? `: ${campaignName.get(s.campaignId)}` : ""}${s.stepId ? ` (${s.stepId.replace("b2b:", "step ")})` : ""}`,
      body: campaignText.get(`${s.campaignId}|${s.stepId}`)?.body || null,
      status: delivery(s),
    })),
    ...lead.appointments.map((a) => ({
      id: a.id,
      at: a.createdAt,
      kind: "meeting",
      title: `Meeting ${a.status === "CONFIRMED" ? "booked" : a.status.toLowerCase()}`,
      body: a.preferredTime,
      status: a.status.toLowerCase(),
    })),
    ...lead.inquiries.map((i) => ({ id: i.id, at: i.createdAt, kind: "website", title: `Website ${i.type.toLowerCase()}`, body: null, status: null })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  const waiting = lead.messages.filter((m) => m.direction === "IN" && !m.handledAt).length;
  res.json({ agentPausedAt: lead.agentPausedAt, agentPausedUntil: lead.agentPausedUntil, agentPauseReason: lead.agentPauseReason, waiting, profile: lead.profile, items });
});

export const deleteLead = wrap("Lead delete", async (req, res) => {
  const deleted = await prisma.b2BLead.delete({ where: { id: req.params.id } }).catch(() => null);
  // Deleted here means deleted in AI4Home's Salesforce too; its Events and Tasks go with it there.
  if (deleted?.salesforceId) await queueSalesforceDeletion("Lead", deleted.salesforceId, deleted.companyName);
  await completeFinishedCampaigns();
  res.json({ success: true });
});

// ---------- Campaigns ----------

async function startEnrollments(enrollmentIds) {
  if (!enrollmentIds.length) return;
  const { inngest } = await import("../lib/inngest.js");
  for (let i = 0; i < enrollmentIds.length; i += 500) {
    await inngest.send(
      enrollmentIds.slice(i, i + 500).map((enrollmentId) => ({ name: "b2b.enrollment.started", data: { enrollmentId } })),
    );
  }
}

async function launchBlocker(steps) {
  try { appUrl(); } catch (error) { return error.message; }
  const invalid = validateSteps(steps);
  if (invalid) return invalid;
  const missing = await missingChannelsForSteps(null, steps.map((s) => ({ type: s.channel })));
  return missing.length ? notConfiguredMessage(missing, "this campaign") : null;
}

export const listCampaigns = wrap("Campaigns", async (req, res) => {
  const campaigns = await prisma.b2BCampaign.findMany({
    // The 180-day nurture has its own page on Nurture.
    where: { archivedAt: null, id: { not: B2B_AUTO_ID } },
    orderBy: { createdAt: "desc" },
    include: { enrollments: { select: { status: true, exitedReason: true, failedCount: true, lastError: true } } },
  });
  res.json(
    campaigns.map(({ enrollments, ...c }) => {
      const count = (fn) => enrollments.filter(fn).length;
      return {
        ...c,
        stats: {
          enrolled: enrollments.length,
          active: count((e) => e.status === "ACTIVE"),
          completed: count((e) => e.status === "COMPLETED"),
          booked: count((e) => e.exitedReason === "APPOINTMENT"),
          replied: count((e) => e.exitedReason === "REPLY"),
          unsubscribed: count((e) => e.exitedReason === "UNSUBSCRIBE"),
          withIssues: count((e) => e.failedCount > 0 || e.exitedReason === "NOT_CONFIGURED" || (!!e.lastError && !/ (skipped: |waiting: )/.test(e.lastError))),
        },
      };
    }),
  );
});

export const createCampaign = wrap("Campaign create", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ message: "Give the campaign a name." });
  const steps = Array.isArray(req.body?.steps) ? req.body.steps : [];
  const invalid = validateSteps(steps);
  if (invalid) return res.status(400).json({ message: invalid });
  res.status(201).json(await prisma.b2BCampaign.create({ data: { name, steps: cleanSteps(steps) } }));
});

const STEP_TOOL = {
  name: "write_campaign_step",
  description: "Return the finished message for this campaign step.",
  input_schema: {
    type: "object",
    properties: {
      subject: { type: "string", description: "Email subject line; empty string for SMS." },
      body: { type: "string", description: "The message body, plain text." },
    },
    required: ["subject", "body"],
  },
};
const MAX_TOPIC_CHARS = 500;
const clip = (text, n) => String(text || "").trim().slice(0, n);

// Drafts one step for the Super Admin to review; nothing is saved or sent here.
export const generateStep = wrap("Campaign step AI", async (req, res) => {
  const { channel, topic, draft, campaignName, stepNumber, otherSteps } = req.body || {};
  if (!["EMAIL", "SMS"].includes(channel)) return res.status(400).json({ message: "Pick Email or SMS first." });
  const about = clip(topic, MAX_TOPIC_CHARS);
  const current = clip(draft, 4000);
  if (!about && !current) {
    return res.status(400).json({ message: "Describe what this step should be about, or write a draft for AI to improve." });
  }
  if (!hasLLM()) return res.status(503).json({ message: aiUnavailableMessage() });

  // The rest of the sequence, so this step adds something new instead of repeating it.
  const others = (Array.isArray(otherSteps) ? otherSteps : [])
    .slice(0, 20)
    .map((o) => `- Step ${Number(o?.stepNumber) || "?"} (${o?.channel === "SMS" ? "SMS" : "email"}): ${clip(o?.subject, 120)} ${clip(o?.body, 300)}`.trim())
    .filter((line) => line.length > 20)
    .join("\n");

  const user = [
    clip(campaignName, 120) && `Campaign: ${clip(campaignName, 120)}`,
    stepNumber && `This is step ${Number(stepNumber)} of the sequence.`,
    about && `What this step should be about: ${about}`,
    current && `Current draft to improve (keep its intent):
${current}`,
    others && `Other steps in this sequence (do not repeat their angle):
${others}`,
    channel === "EMAIL" ? B2B_EMAIL_RULES : B2B_SMS_RULES,
  ].filter(Boolean).join("\n\n");

  const out = await toolCall({
    companyId: null,
    system: renderTemplate(B2B_STEP_SYSTEM, { productGuide: PLATFORM_GUIDE }),
    messages: [{ role: "user", content: user }],
    tool: STEP_TOOL,
    maxTokens: 900,
  });
  const body = String(out?.body || "").trim();
  if (!body) return res.status(502).json({ message: "AI couldn't write this step. Try again or rephrase the topic." });

  const subject = channel === "EMAIL" ? String(out?.subject || "").trim() : "";
  // The model is told the allowed placeholders; this catches the times it ignores that.
  const unknown = unknownPlaceholders(`${subject} ${body}`);
  res.json({ subject, body, warning: unknown.length ? `Replace ${unknown.map((n) => `{{${n}}}`).join(", ")} before saving.` : null });
});

const CAMPAIGN_TOOL = {
  name: "write_campaign",
  description: "Return the finished B2B campaign sequence.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Short campaign name." },
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            channel: { type: "string", enum: ["EMAIL", "SMS"] },
            delayDays: { type: "integer", description: "Days to wait after the previous step; 0 for the first step." },
            sendTime: { type: "string", description: "Local send time as HH:mm, from 08:00 to 20:30." },
            subject: { type: "string", description: "Email subject line; empty string for SMS." },
            body: { type: "string", description: "The message body, plain text." },
          },
          required: ["channel", "delayDays", "sendTime", "subject", "body"],
        },
      },
    },
    required: ["name", "steps"],
  },
};
const MAX_AI_STEPS = 8;

// Drafts a whole sequence into the editor; nothing is saved or sent here.
export const generateCampaign = wrap("Campaign AI", async (req, res) => {
  const prompt = clip(req.body?.prompt, 1000);
  if (!prompt) return res.status(400).json({ message: "Describe the campaign you want." });
  if (!hasLLM()) return res.status(503).json({ message: aiUnavailableMessage() });

  const out = await toolCall({
    companyId: null,
    system: renderTemplate(B2B_STEP_SYSTEM, { productGuide: PLATFORM_GUIDE }),
    messages: [{
      role: "user",
      content: [
        `Write a complete campaign sequence for this request: ${prompt}`,
        `Use 2 to ${MAX_AI_STEPS} steps unless the request says otherwise, and honour any channels, timing or length it asks for. Each step must add a new angle. The first step has delayDays 0.`,
        `Email steps. ${B2B_EMAIL_RULES}`,
        `SMS steps. ${B2B_SMS_RULES}`,
      ].join("\n\n"),
    }],
    tool: CAMPAIGN_TOOL,
    maxTokens: 4000,
  });

  const raw = (Array.isArray(out?.steps) ? out.steps : []).slice(0, MAX_AI_STEPS);
  const steps = cleanSteps(raw.map((s) => ({ ...s, sendTime: validSendTime(s?.sendTime) ? s.sendTime : "10:00" })));
  const unknown = unknownPlaceholders(steps.map((s) => `${s.subject} ${s.body}`).join(" "));
  const complete = steps.length > 0 && steps.every((s) => ["EMAIL", "SMS"].includes(s.channel) && s.body.trim() && (s.channel === "SMS" || s.subject));
  if (!complete) return res.status(502).json({ message: "AI couldn't write this campaign. Try again or rephrase it." });

  res.json({
    name: clip(out?.name, 120) || "AI campaign",
    steps,
    warning: unknown.length ? `Replace ${unknown.map((n) => `{{${n}}}`).join(", ")} before saving.` : null,
  });
});

// Sends one step to the admin's own email or phone, right away, with no enrollment.
export const sendTestStep = wrap("Campaign test", async (req, res) => {
  const { step, to } = req.body || {};
  const invalid = validateSteps([step]);
  if (invalid) return res.status(400).json({ message: invalid.replace("Step 1", "This step") });
  const destination = String(to || "").trim();
  const sample = { contactName: "Test Contact", companyName: "Sample Homes", city: "Your City", bookingToken: "test" };
  try { appUrl(); } catch (error) { return res.status(400).json({ message: error.message }); }

  if (step.channel === "SMS") {
    const phone = toE164(destination);
    if (!phone) return res.status(400).json({ message: PHONE_ERROR });
    const stopped = await prisma.suppressionList.findFirst({ where: { companyId: null, value: { contains: phone.slice(-10) } } });
    if (stopped) return res.status(400).json({ message: "That number has replied STOP, so it can't get tests." });
    const r = await sendSms({ to: phone, body: renderB2BStep(step, sample, null).body, source: "b2b-test", brand: false });
    if (!smsSent(r)) return res.status(400).json({ message: r.error || "The test text was not sent." });
    return res.json({ success: true, message: `Test text accepted for ${phone}. The provider confirms delivery separately.` });
  }

  if (!EMAIL_RE.test(destination)) return res.status(400).json({ message: "Enter a valid email address for the test." });
  const msg = renderB2BStep(step, sample, null);
  const r = await MailService.sendEmail({ to: destination, subject: `[Test] ${msg.subject}`, html: msg.html, fromName: "AI for Homebuilders", source: "b2b-test", noReply: true });
  if (!r.success) return res.status(400).json({ message: r.error || "The test email was not sent." });
  res.json({ success: true, message: `Test email accepted for ${destination}.` });
});

const TEMPLATES_SEEDED_KEY = "b2b.templates.seeded";

/** Adds the starters once, so a template the admin deletes stays deleted. */
async function seedStarterTemplates() {
  if (await prisma.platformSetting.findUnique({ where: { key: TEMPLATES_SEEDED_KEY } })) return;
  await prisma.b2BCampaignTemplate.createMany({ data: STARTER_TEMPLATES, skipDuplicates: true });
  await prisma.platformSetting.upsert({
    where: { key: TEMPLATES_SEEDED_KEY },
    create: { key: TEMPLATES_SEEDED_KEY, value: true },
    update: {},
  });
}

function templateData(body) {
  const name = String(body?.name || "").trim();
  if (!name) return { error: "Give the template a name." };
  const steps = Array.isArray(body?.steps) ? body.steps : [];
  const error = validateSteps(steps);
  if (error) return { error };
  return { data: { name, description: clip(body?.description, 300), steps: cleanSteps(steps) } };
}

export const listTemplates = wrap("Templates", async (req, res) => {
  await seedStarterTemplates();
  res.json(await prisma.b2BCampaignTemplate.findMany({ orderBy: { createdAt: "asc" } }));
});

export const createTemplate = wrap("Template create", async (req, res) => {
  const { data, error } = templateData(req.body);
  if (error) return res.status(400).json({ message: error });
  res.status(201).json(await prisma.b2BCampaignTemplate.create({ data }));
});

export const updateTemplate = wrap("Template update", async (req, res) => {
  const { data, error } = templateData(req.body);
  if (error) return res.status(400).json({ message: error });
  const { count } = await prisma.b2BCampaignTemplate.updateMany({ where: { id: req.params.id }, data });
  if (!count) return res.status(404).json({ message: "Template not found." });
  res.json({ success: true });
});

export const deleteTemplate = wrap("Template delete", async (req, res) => {
  await prisma.b2BCampaignTemplate.deleteMany({ where: { id: req.params.id } });
  res.json({ success: true });
});

const AUTO_ONLY_ON_NURTURE = "The 180-day nurture is managed on the Nurture page.";

export const updateCampaign = wrap("Campaign update", async (req, res) => {
  if (req.params.id === B2B_AUTO_ID) return res.status(400).json({ message: AUTO_ONLY_ON_NURTURE });
  const campaign = await prisma.b2BCampaign.findUnique({ where: { id: req.params.id } });
  if (!campaign) return res.status(404).json({ message: "Campaign not found." });
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ message: "Give the campaign a name." });
  const steps = Array.isArray(req.body?.steps) ? req.body.steps : [];
  const blocker = campaign.status === "ACTIVE" ? await launchBlocker(steps) : validateSteps(steps);
  if (blocker) return res.status(400).json({ message: blocker });
  // Edits apply to leads already in the sequence from their next step on, and each lead
  // stays on the same message even when steps are added or removed before it.
  const cleaned = cleanSteps(steps);
  const oldSteps = Array.isArray(campaign.steps) ? campaign.steps : [];
  const active = await prisma.b2BEnrollment.findMany({ where: { campaignId: campaign.id, status: "ACTIVE" }, select: { id: true, currentStep: true } });
  const moved = active
    .map((e) => ({ id: e.id, to: remapStepIndex(oldSteps, cleaned, e.currentStep), from: e.currentStep }))
    .filter((e) => e.to !== e.from);
  const [updated] = await prisma.$transaction([
    prisma.b2BCampaign.update({ where: { id: campaign.id }, data: { name, steps: cleaned } }),
    ...moved.map((e) => prisma.b2BEnrollment.update({ where: { id: e.id }, data: { currentStep: e.to, stepAttempts: 0 } })),
  ]);
  res.json(updated);
});

export const setCampaignStatus = wrap("Campaign status", async (req, res) => {
  const { status } = req.body || {};
  if (req.params.id === B2B_AUTO_ID) return res.status(400).json({ message: AUTO_ONLY_ON_NURTURE });
  if (!["ACTIVE", "PAUSED"].includes(status)) return res.status(400).json({ message: "Status must be ACTIVE or PAUSED." });
  const campaign = await prisma.b2BCampaign.findUnique({ where: { id: req.params.id } });
  if (!campaign) return res.status(404).json({ message: "Campaign not found." });

  if (status === "PAUSED") {
    // Sleeping runs re-check the status before every send, so pausing stops them.
    return res.json(await prisma.b2BCampaign.update({ where: { id: campaign.id }, data: { status } }));
  }
  const blocker = await launchBlocker(campaign.steps);
  if (blocker) return res.status(400).json({ message: blocker });
  const updated = await prisma.b2BCampaign.update({ where: { id: campaign.id }, data: { status: "ACTIVE" } });
  const active = await prisma.b2BEnrollment.findMany({
    where: { campaignId: campaign.id, status: "ACTIVE" },
    select: { id: true },
  });
  await startEnrollments(active.map((e) => e.id));
  res.json({ ...updated, started: active.length });
});

export const deleteCampaign = wrap("Campaign delete", async (req, res) => {
  if (req.params.id === B2B_AUTO_ID) return res.status(400).json({ message: AUTO_ONLY_ON_NURTURE });
  const history = await prisma.b2BEnrollment.count({ where: { campaignId: req.params.id } });
  if (!history) {
    await prisma.b2BCampaign.delete({ where: { id: req.params.id } }).catch(() => null);
    return res.json({ success: true });
  }
  // Keep who got what: leads' timelines and the campaign's history outlive the card.
  await prisma.b2BEnrollment.updateMany({
    where: { campaignId: req.params.id, status: "ACTIVE" },
    data: { status: "EXITED", exitedReason: "MANUAL", nextRunAt: null },
  });
  await prisma.b2BCampaign.updateMany({ where: { id: req.params.id }, data: { status: "PAUSED", archivedAt: new Date() } });
  res.json({ success: true });
});

export const listEnrollments = wrap("Enrollments", async (req, res) => {
  const rows = await prisma.b2BEnrollment.findMany({
    where: { campaignId: req.params.id },
    orderBy: { createdAt: "desc" },
    include: { lead: { select: { id: true, companyName: true, contactName: true, email: true, phone: true, status: true } } },
  });
  const latestByLead = async (channel) => {
    const latest = rows.length ? await prisma.messageUsage.findMany({
      where: { campaignId: req.params.id, source: "b2b-campaign", channel, leadId: { in: rows.map((row) => row.leadId) } },
      orderBy: { createdAt: "desc" },
      distinct: ["leadId"],
      select: { leadId: true, outcome: true, deliveredAt: true, openedAt: true, clickedAt: true, failedAt: true, providerMessageId: true },
    }) : [];
    return new Map(latest.map((m) => [m.leadId, {
      status: m.failedAt || m.outcome !== "sent" ? "failed" : m.clickedAt ? "clicked" : m.openedAt ? "opened" : m.deliveredAt ? "delivered" : "unconfirmed",
      providerMessageId: m.providerMessageId,
    }]));
  };
  const [smsByLead, emailByLead] = await Promise.all([latestByLead("SMS"), latestByLead("EMAIL")]);
  res.json(rows.map((row) => ({ ...row, smsDelivery: smsByLead.get(row.leadId) || null, emailDelivery: emailByLead.get(row.leadId) || null })));
});

export const enrollLeads = wrap("Enroll", async (req, res) => {
  let leadIds = Array.isArray(req.body?.leadIds) ? [...new Set(req.body.leadIds.filter((id) => typeof id === "string"))] : [];
  if (req.body?.segmentId !== undefined) {
    if (req.body.leadIds !== undefined) return res.status(400).json({ message: "Choose a segment or individual leads." });
    const segment = await findSegment(req.body.segmentId);
    if (!segment) return res.status(404).json({ message: "Segment not found. Refresh and select it again." });
    leadIds = (await prisma.b2BLead.findMany({ where: b2bSegmentWhere(segment.filters), select: { id: true } })).map((lead) => lead.id);
  }
  if (!leadIds.length) return res.status(400).json({ message: "Pick at least one lead." });
  const campaign = await prisma.b2BCampaign.findFirst({ where: { id: req.params.id, archivedAt: null } });
  if (!campaign) return res.status(404).json({ message: "Campaign not found." });
  const steps = Array.isArray(campaign.steps) ? campaign.steps : [];
  if (!steps.length) return res.status(400).json({ message: "Add steps to the campaign before enrolling leads." });

  const [leads, existing] = await Promise.all([
    prisma.b2BLead.findMany({ where: { id: { in: leadIds } } }),
    prisma.b2BEnrollment.findMany({ where: { campaignId: campaign.id, leadId: { in: leadIds }, status: "ACTIVE" }, select: { leadId: true } }),
  ]);
  const alreadyIn = new Set(existing.map((e) => e.leadId));
  const skipped = { closed: 0, alreadyEnrolled: 0, optedOut: 0 };
  const channels = new Set(steps.map((s) => s.channel));
  const firstRunAt = new Date(Date.now() + (steps[0].delayDays || 0) * DAY_MS);
  const started = [];
  const eligible = [];

  for (const lead of leads) {
    if (B2B_CLOSED_STATUSES.includes(lead.status)) { skipped.closed++; continue; }
    if (alreadyIn.has(lead.id)) { skipped.alreadyEnrolled++; continue; }
    const reachable = (channels.has("EMAIL") && !lead.emailOptOut) || (channels.has("SMS") && !lead.smsOptOut && lead.phone && lead.smsConsentAt);
    if (!reachable) { skipped.optedOut++; continue; }
    eligible.push(lead.id);
  }
  // Large segments must not require thousands of individual database writes.
  // Keep completed/exit history counters, just as individual re-enrollment did.
  const reset = { status: "ACTIVE", exitedReason: null, currentStep: 0, stepAttempts: 0, nextRunAt: firstRunAt, lastError: null };
  for (let offset = 0; offset < eligible.length; offset += 500) {
    const batch = eligible.slice(offset, offset + 500);
    const [, , enrolled] = await prisma.$transaction([
      prisma.b2BEnrollment.createMany({ data: batch.map((leadId) => ({ leadId, campaignId: campaign.id, ...reset })), skipDuplicates: true }),
      prisma.b2BEnrollment.updateMany({ where: { campaignId: campaign.id, leadId: { in: batch }, status: { not: "ACTIVE" } }, data: reset }),
      prisma.b2BEnrollment.findMany({ where: { campaignId: campaign.id, leadId: { in: batch }, status: "ACTIVE" }, select: { id: true } }),
    ]);
    started.push(...enrolled.map((enrollment) => enrollment.id));
  }

  // Adding leads to a finished campaign brings it back to life.
  let status = campaign.status;
  if (status === "COMPLETED" && started.length) {
    status = "ACTIVE";
    await prisma.b2BCampaign.update({ where: { id: campaign.id }, data: { status } });
  }
  if (status === "ACTIVE") await startEnrollments(started);
  res.json({ enrolled: started.length, skipped, startsOnLaunch: status !== "ACTIVE" });
});

export const unenrollLeads = wrap("Unenroll", async (req, res) => {
  const leadIds = Array.isArray(req.body?.leadIds) ? req.body.leadIds.filter((id) => typeof id === "string") : [];
  let removed = 0;
  for (const leadId of leadIds) removed += await exitB2BEnrollments(leadId, "MANUAL", { campaignId: req.params.id });
  res.json({ removed });
});

// ---------- Availability & appointments ----------

export const getAvailability = wrap("Availability", async (req, res) => res.json(await getB2BAvailability()));

export const updateAvailability = wrap("Availability update", async (req, res) => {
  const b = req.body || {};
  if (!TIME_RE.test(b.dayStart || "") || !TIME_RE.test(b.dayEnd || "")) {
    return res.status(400).json({ message: "Start and end must be HH:mm." });
  }
  const minutes = (t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  if (minutes(b.dayStart) >= minutes(b.dayEnd)) {
    return res.status(400).json({ message: "End time must be after start time." });
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: b.timezone });
  } catch {
    return res.status(400).json({ message: "Unknown timezone." });
  }
  const days = String(b.workingDays || "").split(",").map((d) => d.trim()).filter(Boolean);
  if (!days.length) return res.status(400).json({ message: "Pick at least one working day." });
  res.json(
    await saveB2BAvailability({
      dayStart: b.dayStart,
      dayEnd: b.dayEnd,
      slotDuration: Math.min(240, Math.max(10, parseInt(b.slotDuration, 10) || 30)),
      bufferMinutes: Math.min(120, Math.max(0, parseInt(b.bufferMinutes, 10) || 0)),
      workingDays: days.join(","),
      timezone: b.timezone,
      meetingLink: String(b.meetingLink || "").trim().startsWith("https://") ? String(b.meetingLink).trim() : "",
    }),
  );
});

export const updateAppointmentStatus = wrap("Appointment status", async (req, res) => {
  const { status } = req.body || {};
  if (!["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"].includes(status)) {
    return res.status(400).json({ message: "Unknown status." });
  }
  try {
    const appointment = await updatePlatformAppointment(req.params.id, status, req.body.startTime, await getB2BAvailability());
    await journeyOnMeetingStatus(appointment.b2bLeadId, status);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    throw error;
  }
  res.json({ success: true });
});

export const updateAppointmentAssignee = wrap("Appointment assignee", async (req, res) => {
  const userId = req.body?.userId;
  if (userId !== null && typeof userId !== "string") return res.status(400).json({ message: "Choose a person." });
  try {
    await setAppointmentAssignee(req.params.id, userId, await getB2BAvailability());
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    throw error;
  }
  res.json({ success: true });
});

// ---------- Public: booking page & unsubscribe ----------


const findByToken = (token) => prisma.b2BLead.findUnique({ where: { bookingToken: String(token || "") } });

/** A text's short link (/m/<code>): where it leads. The web app turns this into a redirect. */
export const publicShortLink = wrap("Short link", async (req, res) => {
  const path = await resolveShortLink(req.params.code);
  if (!path) return res.status(404).json({ message: "This link is no longer valid." });
  res.json({ path });
}, { admin: false });

export const publicGetBooking = wrap("Public booking", async (req, res) => {
  const lead = await findByToken(req.params.token);
  if (!lead) return res.status(404).json({ message: "This booking link is no longer valid." });
  // A text's link carries its step, so opening it counts as a click.
  if (req.query.s) {
    const usage = await prisma.messageUsage.findFirst({
      where: { leadId: lead.id, channel: "SMS", stepId: String(req.query.s), clickedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (usage) await prisma.messageUsage.update({ where: { id: usage.id }, data: { clickedAt: new Date() } });
  }
  const setting = await getB2BAvailability();
  const existing = await prisma.salesAgentAppointment.findFirst({
    where: { b2bLeadId: lead.id, status: "CONFIRMED", startTime: { gte: new Date() } },
    orderBy: { startTime: "asc" },
  });
  const slots = existing ? [] : await openSlots(setting);
  res.json({
    lead: { contactName: lead.contactName, companyName: lead.companyName },
    timezone: setting.timezone,
    slotDuration: setting.slotDuration,
    existing: existing ? { label: formatSlotLabel(existing.startTime, setting.timezone) } : null,
    slots: slots.map((s) => ({ iso: s.toISOString(), label: formatSlotLabel(s, setting.timezone) })),
  });
}, { admin: false });

export const publicBook = wrap("Public book", async (req, res) => {
  const lead = await findByToken(req.params.token);
  if (!lead) return res.status(404).json({ message: "This booking link is no longer valid." });
  const start = new Date(req.body?.startTime);
  if (Number.isNaN(start.getTime())) return res.status(400).json({ message: "Pick a time." });

  const setting = await getB2BAvailability();
  const booked = await bookB2BMeeting({ lead, start, setting, campaignId: req.body?.campaignId });
  if (booked.alreadyBooked) return res.status(409).json({ message: "You already have a meeting booked. Reply to your confirmation email to change it." });
  if (booked.taken) {
    return res.status(409).json({ message: "Sorry, that time is no longer available. Please pick another." });
  }
  const { label, enrollment } = booked;

  const who = escapeHtml(lead.contactName || lead.companyName);
  const confirmationEmail = await MailService.sendEmail({
    to: lead.email,
    fromName: "AI for Homebuilders",
    subject: "Your Product Consultation is confirmed — AI for Homebuilders",
    html: Templates.getB2BMeetingConfirmationEmail({
      name: lead.contactName || lead.companyName,
      companyName: lead.companyName,
      label,
      duration: setting.slotDuration,
      timezone: setting.timezone,
      meetingLink: setting.meetingLink,
      contactEmail: process.env.SUPERADMIN_EMAIL,
    }),
    replyTo: process.env.SUPERADMIN_EMAIL || undefined,
    source: "b2b-booking",
    attachments: [meetingInvite(lead, start, setting)],
  }).catch((e) => console.error("[B2B booking] Confirmation email failed:", e.message));
  await notifySuperAdmin(
    `New meeting booked: ${lead.companyName} — ${label}`,
    `<p><strong>${who}</strong> from <strong>${escapeHtml(lead.companyName)}</strong> booked <strong>${escapeHtml(label)}</strong>` +
      `${enrollment ? ` from the campaign "${escapeHtml(enrollment.campaign.name)}"` : ""}.</p>` +
      `<p>${escapeHtml(lead.email)}${lead.phone ? ` · ${escapeHtml(lead.phone)}` : ""}</p>` +
      `<p><a href="${appUrl()}/admin/sales-agent-appointments">Open Appointments</a></p>`,
  );

  res.status(201).json({ label, confirmationEmailSent: !!confirmationEmail?.success });
}, { admin: false });

export const publicUnsubscribe = wrap("Public unsubscribe", async (req, res) => {
  const lead = await findLeadByUnsubscribeToken(req.params.token);
  if (!lead) return res.status(404).json({ success: false, message: "This unsubscribe link is invalid or has expired." });
  await prisma.b2BLead.update({ where: { id: lead.id }, data: { emailOptOut: true, smsOptOut: true } });
  await exitB2BEnrollments(lead.id, "UNSUBSCRIBE");
  await endB2BJourney(lead.id);
  res.json({ success: true, channel: "ALL", email: lead.email, companyName: MailService.SENDER_NAME });
}, { admin: false });
