import prisma from "../lib/prisma.js";
import { denyUnlessSuperAdmin } from "../middlewares/auth.js";
import { toE164 } from "../services/sms.service.js";
import { MailService } from "../services/mail-service.js";
import { missingChannelsForSteps, notConfiguredMessage } from "../lib/messaging-config.js";
import { computeAvailableSlots, formatSlotLabel } from "../lib/scheduling.js";
import { escapeHtml } from "../lib/utils.js";
import { toolCall, hasLLM, aiUnavailableMessage } from "../lib/llm.js";
import { renderTemplate } from "../prompts/template.js";
import { B2B_STEP_SYSTEM, B2B_EMAIL_RULES, B2B_SMS_RULES } from "../prompts/content.js";
import { PLATFORM_GUIDE } from "../prompts/help-agent.js";
import {
  B2B_LEAD_STATUSES,
  B2B_CLOSED_STATUSES,
  appUrl,
  getB2BAvailability,
  saveB2BAvailability,
  validateSteps,
  cleanSteps,
  unknownPlaceholders,
  exitB2BEnrollments,
  completeFinishedCampaigns,
  notifySuperAdmin,
} from "../lib/b2b.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_NOTICE_MS = 60 * 60 * 1000;
const BOOKING_HORIZON_DAYS = 21;

const wrap = (label, fn, { admin = true } = {}) => async (req, res) => {
  try {
    if (admin && denyUnlessSuperAdmin(req, res)) return;
    await fn(req, res);
  } catch (error) {
    console.error(`[B2B ${label}] Error:`, error);
    res.status(500).json({ message: "Internal server error" });
  }
};

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
    if (raw && !toE164(raw)) return { error: `"${raw}" is not a valid phone number.` };
    data.phone = raw ? toE164(raw) : null;
  }
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

export const listLeads = wrap("Leads", async (req, res) => {
  const leads = await prisma.b2BLead.findMany({
    orderBy: { createdAt: "desc" },
    include: {
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
  res.status(201).json(await prisma.b2BLead.create({ data: { ...data, source: "MANUAL" } }));
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
  const { count } = await prisma.b2BLead.createMany({ data: valid, skipDuplicates: true });
  res.json({ imported: count, duplicates: valid.length - count, invalid });
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
  const updated = await prisma.b2BLead.update({ where: { id: lead.id }, data });
  if (data.status && B2B_CLOSED_STATUSES.includes(data.status)) {
    await exitB2BEnrollments(lead.id, "STATUS");
  }
  res.json(updated);
});

export const deleteLead = wrap("Lead delete", async (req, res) => {
  await prisma.b2BLead.delete({ where: { id: req.params.id } }).catch(() => null);
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
  const invalid = validateSteps(steps);
  if (invalid) return invalid;
  const missing = await missingChannelsForSteps(null, steps.map((s) => ({ type: s.channel })));
  return missing.length ? notConfiguredMessage(missing, "this campaign") : null;
}

export const listCampaigns = wrap("Campaigns", async (req, res) => {
  const campaigns = await prisma.b2BCampaign.findMany({
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
          withIssues: count((e) => e.failedCount > 0 || e.exitedReason === "NOT_CONFIGURED" || !!e.lastError),
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

export const updateCampaign = wrap("Campaign update", async (req, res) => {
  const campaign = await prisma.b2BCampaign.findUnique({ where: { id: req.params.id } });
  if (!campaign) return res.status(404).json({ message: "Campaign not found." });
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ message: "Give the campaign a name." });
  const steps = Array.isArray(req.body?.steps) ? req.body.steps : [];
  const blocker = campaign.status === "ACTIVE" ? await launchBlocker(steps) : validateSteps(steps);
  if (blocker) return res.status(400).json({ message: blocker });
  // Edits apply to leads already in the sequence from their next step on.
  res.json(await prisma.b2BCampaign.update({ where: { id: campaign.id }, data: { name, steps: cleanSteps(steps) } }));
});

export const setCampaignStatus = wrap("Campaign status", async (req, res) => {
  const { status } = req.body || {};
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
  await prisma.b2BCampaign.delete({ where: { id: req.params.id } }).catch(() => null);
  res.json({ success: true });
});

export const listEnrollments = wrap("Enrollments", async (req, res) => {
  const rows = await prisma.b2BEnrollment.findMany({
    where: { campaignId: req.params.id },
    orderBy: { createdAt: "desc" },
    include: { lead: { select: { id: true, companyName: true, contactName: true, email: true, phone: true, status: true } } },
  });
  res.json(rows);
});

export const enrollLeads = wrap("Enroll", async (req, res) => {
  const leadIds = Array.isArray(req.body?.leadIds) ? [...new Set(req.body.leadIds)] : [];
  if (!leadIds.length) return res.status(400).json({ message: "Pick at least one lead." });
  const campaign = await prisma.b2BCampaign.findUnique({ where: { id: req.params.id } });
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

  for (const lead of leads) {
    if (B2B_CLOSED_STATUSES.includes(lead.status)) { skipped.closed++; continue; }
    if (alreadyIn.has(lead.id)) { skipped.alreadyEnrolled++; continue; }
    const reachable = (channels.has("EMAIL") && !lead.emailOptOut) || (channels.has("SMS") && !lead.smsOptOut && lead.phone);
    if (!reachable) { skipped.optedOut++; continue; }
    const reset = { status: "ACTIVE", exitedReason: null, currentStep: 0, nextRunAt: firstRunAt, lastError: null };
    const enrollment = await prisma.b2BEnrollment.upsert({
      where: { leadId_campaignId: { leadId: lead.id, campaignId: campaign.id } },
      create: { leadId: lead.id, campaignId: campaign.id, ...reset },
      update: reset,
    });
    started.push(enrollment.id);
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
  const leadIds = Array.isArray(req.body?.leadIds) ? req.body.leadIds : [];
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
    }),
  );
});

export const updateAppointmentStatus = wrap("Appointment status", async (req, res) => {
  const { status } = req.body || {};
  if (!["CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"].includes(status)) {
    return res.status(400).json({ message: "Unknown status." });
  }
  // Botpress bookings are left exactly as the website agent created them.
  const { count } = await prisma.salesAgentAppointment.updateMany({
    where: { id: req.params.id, source: "CAMPAIGN" },
    data: { status },
  });
  if (!count) return res.status(404).json({ message: "Campaign appointment not found." });
  res.json({ success: true });
});

// ---------- Public: booking page & unsubscribe ----------

async function openSlots(setting) {
  const from = new Date(Date.now() + MIN_NOTICE_MS);
  const to = new Date(from.getTime() + BOOKING_HORIZON_DAYS * DAY_MS);
  const taken = await prisma.salesAgentAppointment.findMany({
    where: { source: "CAMPAIGN", status: { not: "CANCELLED" }, startTime: { gte: new Date(from.getTime() - DAY_MS), lte: to } },
    select: { startTime: true },
  });
  const duration = setting.slotDuration * 60000;
  const busy = taken.map((a) => ({ start: a.startTime, end: new Date(a.startTime.getTime() + duration) }));
  return computeAvailableSlots({ setting, from, days: BOOKING_HORIZON_DAYS, busy, limit: 200 });
}

const findByToken = (token) => prisma.b2BLead.findUnique({ where: { bookingToken: String(token || "") } });

export const publicGetBooking = wrap("Public booking", async (req, res) => {
  const lead = await findByToken(req.params.token);
  if (!lead) return res.status(404).json({ message: "This booking link is no longer valid." });
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
  if (!(await openSlots(setting)).some((s) => s.getTime() === start.getTime())) {
    return res.status(409).json({ message: "Sorry, that time is no longer available. Please pick another." });
  }

  // Which campaign brought them here: the link's ?c=, else their most recent enrollment.
  const enrollment = await prisma.b2BEnrollment.findFirst({
    where: { leadId: lead.id, ...(req.body?.campaignId ? { campaignId: String(req.body.campaignId) } : {}) },
    orderBy: { updatedAt: "desc" },
    include: { campaign: { select: { name: true } } },
  });
  const label = formatSlotLabel(start, setting.timezone);
  const end = new Date(start.getTime() + setting.slotDuration * 60000);

  let appointment;
  try {
    // Serializable: two leads racing for the same slot cannot both pass the overlap check.
    appointment = await prisma.$transaction(
      async (tx) => {
        const clash = await tx.salesAgentAppointment.findFirst({
          where: {
            source: "CAMPAIGN",
            status: { not: "CANCELLED" },
            startTime: { gt: new Date(start.getTime() - setting.slotDuration * 60000), lt: end },
          },
        });
        if (clash) return null;
        return tx.salesAgentAppointment.create({
          data: {
            name: lead.contactName || lead.companyName,
            email: lead.email,
            phone: lead.phone || "",
            preferredTime: label,
            source: "CAMPAIGN",
            campaignName: enrollment?.campaign.name || null,
            startTime: start,
            b2bLeadId: lead.id,
          },
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (e) {
    if (e?.code !== "P2034") throw e; // serialization conflict = someone else got the slot
  }
  if (!appointment) {
    return res.status(409).json({ message: "Sorry, that time was just taken. Please pick another." });
  }

  // Booked: this lead leaves every campaign; the campaigns carry on for everyone else.
  await exitB2BEnrollments(lead.id, "APPOINTMENT");
  if (["NEW", "CONTACTED"].includes(lead.status)) {
    await prisma.b2BLead.update({ where: { id: lead.id }, data: { status: "INTERESTED" } });
  }

  const who = escapeHtml(lead.contactName || lead.companyName);
  await MailService.sendEmail({
    to: lead.email,
    subject: `Your meeting with ${MailService.SENDER_NAME} is confirmed`,
    html: `<p>Hi ${who},</p><p>Thanks for booking a time with us. You're confirmed for <strong>${escapeHtml(label)}</strong> (${setting.slotDuration} minutes).</p><p>We'll reach out at this email or phone number. Need to change it? Just reply to this email.</p>`,
    replyTo: process.env.SUPERADMIN_EMAIL || undefined,
    source: "b2b-booking",
  }).catch((e) => console.error("[B2B booking] Confirmation email failed:", e.message));
  await notifySuperAdmin(
    `New meeting booked: ${lead.companyName} — ${label}`,
    `<p><strong>${who}</strong> from <strong>${escapeHtml(lead.companyName)}</strong> booked <strong>${escapeHtml(label)}</strong>` +
      `${enrollment ? ` from the campaign "${escapeHtml(enrollment.campaign.name)}"` : ""}.</p>` +
      `<p>${escapeHtml(lead.email)}${lead.phone ? ` · ${escapeHtml(lead.phone)}` : ""}</p>` +
      `<p><a href="${appUrl()}/admin/sales-agent-appointments">Open Appointments</a></p>`,
  );

  res.status(201).json({ label });
}, { admin: false });

export const publicUnsubscribe = wrap("Public unsubscribe", async (req, res) => {
  const lead = await findByToken(req.params.token);
  if (!lead) return res.status(404).json({ success: false, message: "This unsubscribe link is invalid or has expired." });
  await prisma.b2BLead.update({ where: { id: lead.id }, data: { emailOptOut: true } });
  await exitB2BEnrollments(lead.id, "UNSUBSCRIBE");
  res.json({ success: true, channel: "EMAIL", email: lead.email, companyName: MailService.SENDER_NAME });
}, { admin: false });
