import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import prisma from "./prisma.js";
import { platformCalendly, platformCalendlyPointer } from "./platform-calendly.js";
import { MailService } from "../services/mail-service.js";
import { Templates } from "../services/templates.js";
import { toE164 } from "../services/sms.service.js";
import { escapeHtml } from "./utils.js";
import { hasLLM } from "./llm.js";
import { inngest } from "./inngest.js";

export const B2B_LEAD_STATUSES = ["NEW", "CONTACTED", "INTERESTED", "SIGNED", "LOST"];
export const B2B_CLOSED_STATUSES = ["SIGNED", "LOST"];
export const B2B_REPLY_TAG = "b2b";

const AVAILABILITY_KEY = "b2b.availability";
const B2B_AVAILABILITY_DEFAULTS = {
  dayStart: "09:00",
  dayEnd: "17:00",
  slotDuration: 30,
  bufferMinutes: 15,
  workingDays: "Mon,Tue,Wed,Thu,Fri",
  timezone: "America/New_York",
};

/**
 * The meeting settings every platform booking uses. With Calendly connected, the open times,
 * length and invite come from Calendly (`calendly: true`); the manual hours apply only without it.
 */
export async function getB2BAvailability() {
  const row = await prisma.platformSetting.findUnique({ where: { key: AVAILABILITY_KEY } });
  const manual = { ...B2B_AVAILABILITY_DEFAULTS, ...(row?.value || {}) };
  const conn = await platformCalendly();
  if (!conn) return manual;
  const pointer = await platformCalendlyPointer();
  return {
    ...manual,
    calendly: true,
    slotDuration: conn.eventDuration || manual.slotDuration,
    bufferMinutes: 0,
    meetingLink: "",
    timezone: pointer?.timezone || manual.timezone,
  };
}

export function appUrl() {
  const raw = String(process.env.NEXT_PUBLIC_URL || "").trim();
  if (!raw && process.env.NODE_ENV === "production") throw new Error("Set NEXT_PUBLIC_URL to the public HTTPS portal address before sending campaign links.");
  let url;
  try { url = new URL(raw || "http://localhost:3000"); }
  catch { throw new Error("NEXT_PUBLIC_URL must be a valid portal URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      (process.env.NODE_ENV === "production" && (url.protocol !== "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("NEXT_PUBLIC_URL must be the public HTTPS portal address in production.");
  }
  return url.origin;
}
/** `stepId` marks a text's link: opening it is how an SMS click gets counted. */
export function bookingLinkFor(lead, campaignId, stepId) {
  const query = new URLSearchParams({ ...(campaignId ? { c: campaignId } : {}), ...(stepId ? { s: stepId } : {}) }).toString();
  return `${appUrl()}/meet/${encodeURIComponent(lead.bookingToken)}${query ? `?${query}` : ""}`;
}

// No 0/O, 1/l/I: the code is read off a phone screen.
const SHORT_CODE_CHARS = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const SHORT_CODE_LENGTH = 6;
const shortCode = () =>
  Array.from(randomBytes(SHORT_CODE_LENGTH), (b) => SHORT_CODE_CHARS[b % SHORT_CODE_CHARS.length]).join("");

/**
 * A short /m/<code> link that redirects to bookingLinkFor(lead, campaignId, stepId), for texts,
 * where every character counts. The same lead, campaign and step always reuse one code.
 */
export async function shortBookingLinkFor(lead, campaignId = null, stepId = null) {
  const key = { leadId: lead.id, campaignId: campaignId || null, stepId: stepId || null };
  const existing = await prisma.b2BShortLink.findFirst({ where: key, select: { code: true } });
  if (existing) return `${appUrl()}/m/${existing.code}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = shortCode();
    try {
      await prisma.b2BShortLink.create({ data: { code, ...key } });
      return `${appUrl()}/m/${code}`;
    } catch (error) {
      if (error?.code !== "P2002") throw error; // code taken: try another
    }
  }
  return bookingLinkFor(lead, campaignId, stepId);
}

/** Where a short link goes, as a path on this site; null when the code is unknown. */
export async function resolveShortLink(code) {
  const link = await prisma.b2BShortLink.findUnique({
    where: { code: String(code || "") },
    include: { lead: { select: { bookingToken: true } } },
  });
  if (!link?.lead) return null;
  const url = new URL(bookingLinkFor(link.lead, link.campaignId, link.stepId));
  return url.pathname + url.search;
}

// ---------- Weekly limits and journey settings ----------

const JOURNEY_SETTINGS_KEY = "b2b.journey";
export const JOURNEY_DEFAULTS = { sendDays: "Tue,Wed,Thu", emailTime: "10:00", smsTime: "11:00", emailsPerWeek: 2, smsPerWeek: 1 };

export async function getB2BJourneySettings() {
  const row = await prisma.platformSetting.findUnique({ where: { key: JOURNEY_SETTINGS_KEY } });
  return { ...JOURNEY_DEFAULTS, ...(row?.value || {}) };
}

export async function saveB2BJourneySettings(value) {
  await prisma.platformSetting.upsert({ where: { key: JOURNEY_SETTINGS_KEY }, create: { key: JOURNEY_SETTINGS_KEY, value }, update: { value } });
  return getB2BJourneySettings();
}

/** Every scheduled message counts, whether it came from a campaign or the journey. Live replies don't. */
export async function weeklyLimitReached(leadId, channel, settings) {
  const limit = channel === "SMS" ? settings.smsPerWeek : settings.emailsPerWeek;
  const sent = await prisma.b2BMessage.count({
    where: { leadId, actor: "CAMPAIGN", channel, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
  });
  return sent >= limit;
}

/** Takes the lead out of the journey. Their history stays. */
export const endB2BJourney = (leadId) =>
  prisma.b2BLead.updateMany({
    where: { id: leadId, journeyStage: { not: null } },
    data: { journeyStage: null, journeyNextAt: null, journeyHoldReason: null },
  });

const QUIET_AFTER_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * A reply moves the lead out of scheduled sending. If it goes quiet, the journey picks it up again.
 * A lead with a meeting stays booked: "thanks, see you then" is no reason to re-engage them.
 */
export const moveJourneyToResponded = (leadId) =>
  prisma.b2BLead.updateMany({
    where: { id: leadId, journeyStage: { not: null, notIn: ["APPOINTMENT_BOOKED"] } },
    data: { journeyStage: "RESPONDED", journeyTouches: 0, journeyNextAt: new Date(Date.now() + QUIET_AFTER_MS), journeyHoldReason: null },
  });

export const QUIET_AFTER = QUIET_AFTER_MS;

const icsText = (value) => String(value).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsDate = (date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** A calendar invite to attach to a meeting confirmation. */
export function meetingInvite(lead, start, setting) {
  const end = new Date(start.getTime() + setting.slotDuration * 60000);
  const details = setting.meetingLink ? `Join: ${setting.meetingLink}` : "Our team will contact you at your email or phone number.";
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AI for Homebuilders//Meetings//EN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:${lead.id}-${start.getTime()}@aiforhomebuilders`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`,
    "SUMMARY:Product Consultation with AI for Homebuilders", `DESCRIPTION:${icsText(details)}`,
    ...(setting.meetingLink ? [`LOCATION:${icsText(setting.meetingLink)}`] : []),
    "END:VEVENT", "END:VCALENDAR",
  ];
  return { filename: "meeting.ics", content: lines.join("\r\n"), contentType: "text/calendar; charset=utf-8" };
}

// Unsubscribing has its own signed token, so a forwarded booking link can't opt someone out.
// It never expires: an unsubscribe link must keep working for as long as the email exists.
const unsubscribeSignature = (leadId) =>
  createHmac("sha256", process.env.APP_ENCRYPTION_KEY || "b2b-unsubscribe").update(`b2b-unsubscribe:${leadId}`).digest("base64url");

export const unsubscribeLinkFor = (lead) => `${appUrl()}/unsubscribe/${encodeURIComponent(`${lead.id}.${unsubscribeSignature(lead.id)}`)}?type=b2b`;

export async function findLeadByUnsubscribeToken(token) {
  const value = String(token || "");
  const [leadId, signature] = value.split(".");
  if (!signature) {
    // Emails already sent carry the booking token, and those links have to keep working.
    return prisma.b2BLead.findUnique({ where: { bookingToken: value } });
  }
  const expected = Buffer.from(unsubscribeSignature(leadId));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return prisma.b2BLead.findUnique({ where: { id: leadId } });
}

/** Plain text in the branded email layout, shared by campaign steps and agent replies. */
export function b2bEmailHtml(text, lead, { bookingLink, bookingButton = true }) {
  const html = String(text).split(/\r?\n\s*\r?\n/).map((paragraph) => `<p style="margin:0 0 16px">${escapeHtml(paragraph).replace(/\r?\n/g, "<br />")}</p>`).join("");
  const websiteUrl = new URL(process.env.WEBSITE_PUBLIC_URL || "https://www.aiforhomebuilders.com").origin;
  return Templates.getB2BCampaignEmail(html, { bookingLink, unsubscribeLink: unsubscribeLinkFor(lead), portalUrl: appUrl(), websiteUrl, bookingButton });
}

// The merge fields renderB2BStep fills. Anything else would reach the builder
// as literal "{{…}}" text, so saving rejects it.
export const B2B_PLACEHOLDERS = ["firstName", "contactName", "companyName", "city", "bookingLink"];

export function unknownPlaceholders(text) {
  const found = [...String(text || "").matchAll(/\{\{?\s*(\w+)\s*\}?\}/g)].map((m) => m[1]);
  return [...new Set(found.filter((name) => !B2B_PLACEHOLDERS.includes(name)))];
}

// A send time is the lead's local clock, and must stay inside 8am–9pm.
export const validSendTime = (t) => /^([01]\d|20):[0-5]\d$/.test(String(t)) && t >= "08:00";

export function validateSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return "Add at least one step.";
  if (steps.length > 20) return "A campaign can have at most 20 steps.";
  for (const [i, s] of steps.entries()) {
    if (!["EMAIL", "SMS"].includes(s?.channel)) return `Step ${i + 1} needs a channel (Email or SMS).`;
    if (!String(s.body || "").trim()) return `Step ${i + 1} needs a message.`;
    if (s.channel === "EMAIL" && !String(s.subject || "").trim()) return `Step ${i + 1} (email) needs a subject.`;
    if (s.sendTime && !validSendTime(s.sendTime)) return `Step ${i + 1} needs a send time between 8am and 9pm.`;
    const unknown = unknownPlaceholders(`${s.channel === "EMAIL" ? s.subject || "" : ""} ${s.body}`);
    if (unknown.length) {
      return `Step ${i + 1} uses ${unknown.map((n) => `{{${n}}}`).join(", ")}, which isn't a placeholder. Use only ${B2B_PLACEHOLDERS.map((n) => `{{${n}}}`).join(" ")}.`;
    }
  }
  return null;
}

const STEP_ID_RE = /^[\w-]{1,64}$/;

export function cleanSteps(steps) {
  const seen = new Set();
  return steps.map((s) => ({
    // A stable id lets a live campaign be edited without leads skipping or repeating steps.
    id: STEP_ID_RE.test(s.id || "") && !seen.has(s.id) && seen.add(s.id) ? s.id : randomUUID(),
    channel: s.channel,
    delayDays: Math.max(0, Math.min(365, parseInt(s.delayDays, 10) || 0)),
    sendTime: s.sendTime || null,
    subject: s.channel === "EMAIL" ? String(s.subject || "").trim() : "",
    body: String(s.body || ""),
  }));
}

/**
 * Where a lead on old step i belongs after an edit: the same step, or the next one that
 * survived. Steps saved before ids existed can only stay at the same position.
 */
export function remapStepIndex(oldSteps, newSteps, i) {
  if (!oldSteps[i]?.id) return Math.min(i, newSteps.length);
  for (let k = i; k < oldSteps.length; k++) {
    const found = newSteps.findIndex((s) => s.id === oldSteps[k].id);
    if (found !== -1) return found;
  }
  return newSteps.length;
}

// First-run starter templates. Drafts for client approval: no invented numbers or case studies.
const emailStep = (delayDays, subject, body) => ({ channel: "EMAIL", delayDays, sendTime: "10:00", subject, body });
const smsStep = (delayDays, body) => ({ channel: "SMS", delayDays, sendTime: "11:00", subject: "", body });

export const STARTER_TEMPLATES = [
  {
    id: "starter-new-builder-intro",
    name: "New builder introduction",
    description: "A short first touch for builders who have not heard from us.",
    steps: [
      emailStep(0, "A question for {{companyName}}",
        "Hi {{firstName}},\n\nMost builders we speak with are stretched in two places: replying to new buyer inquiries, and answering homeowner warranty questions after closing.\n\nAI4Home gives you a Sales Agent that responds to inquiries, follows up and arranges appointments, and a Warranty Agent that handles routine homeowner questions and passes the rest to your team.\n\nWould a short call be useful? Pick a time here: {{bookingLink}}\n\nThe AI4Home team"),
      smsStep(2, "Hi {{firstName}}, did our note about {{companyName}}'s inquiries reach you? {{bookingLink}}"),
      emailStep(5, "Worth a short call, {{firstName}}?",
        "Hi {{firstName}},\n\nI'll keep this brief. If your team spends time on repeat homeowner questions or on following up with buyers, that is the work AI4Home is built to take on, with a person stepping in whenever it is needed.\n\nIf now isn't the right time, no problem. If it is, you can book a short call here: {{bookingLink}}\n\nThe AI4Home team"),
    ],
  },
  {
    id: "starter-warranty-calls",
    name: "Cutting routine warranty calls",
    description: "For warranty and customer care managers.",
    steps: [
      emailStep(0, "Routine warranty calls at {{companyName}}",
        "Hi {{firstName}},\n\nA lot of warranty work starts with the same questions from homeowners: what's covered, how to report an issue, and what happens next.\n\nThe AI4Home Warranty Agent answers routine questions, takes the details of an issue, and hands off to your team when a person is needed.\n\nCould we show you how it would work for {{companyName}}? Book a short call: {{bookingLink}}\n\nThe AI4Home team"),
      emailStep(4, "When the Warranty Agent hands off to your team",
        "Hi {{firstName}},\n\nA fair question about any AI tool is what happens when it shouldn't answer. With AI4Home, your team stays in charge: issues that need a person are handed to them, along with the details already collected.\n\nHappy to walk through that flow with you. Pick a time here: {{bookingLink}}\n\nThe AI4Home team"),
      smsStep(7, "{{firstName}}, want a quick look at the Warranty Agent? {{bookingLink}}"),
    ],
  },
  {
    id: "starter-inquiry-no-booking",
    name: "Website inquiry that didn't book",
    description: "Follow-up for builders who asked about us but never booked a call.",
    steps: [
      emailStep(0, "Thanks for your interest in AI4Home",
        "Hi {{firstName}},\n\nThanks for reaching out about AI4Home. The quickest way to see whether it suits {{companyName}} is a short conversation about how your team handles sales inquiries and warranty requests today.\n\nYou can pick a time that suits you here: {{bookingLink}}\n\nOr just reply to this email with your questions.\n\nThe AI4Home team"),
      smsStep(2, "Hi {{firstName}}, happy to answer your AI4Home questions on a short call: {{bookingLink}}"),
      emailStep(6, "Anything we can answer for you?",
        "Hi {{firstName}},\n\nI wanted to check whether you still have questions about AI4Home. If it helps, we can focus the call on just one area: the Sales Agent, the Warranty Agent, or how the two work together.\n\nBook a time here: {{bookingLink}}\n\nThe AI4Home team"),
    ],
  },
  {
    id: "starter-re-engage",
    name: "Re-engaging quiet leads",
    description: "A light check-in for builders who have gone quiet.",
    steps: [
      emailStep(0, "Still a priority for {{companyName}}?",
        "Hi {{firstName}},\n\nWe spoke with {{companyName}} a while back about AI for sales inquiries and warranty support. I wanted to check whether that is still on your list.\n\nIf it is, you can book a short call here: {{bookingLink}}\n\nIf not, just let me know and we'll stop checking in.\n\nThe AI4Home team"),
      smsStep(7, "Hi {{firstName}}, still worth a quick chat about AI4Home? {{bookingLink}}"),
    ],
  },
];

export async function exitB2BEnrollments(leadId, reason, { campaignId } = {}) {
  const { count } = await prisma.b2BEnrollment.updateMany({
    where: { leadId, status: "ACTIVE", ...(campaignId ? { campaignId } : {}) },
    data: { status: "EXITED", exitedReason: reason, nextRunAt: null },
  });
  if (count) await completeFinishedCampaigns();
  return count;
}

export async function completeFinishedCampaigns(campaignId) {
  await prisma.b2BCampaign.updateMany({
    where: {
      ...(campaignId ? { id: campaignId } : {}),
      status: "ACTIVE",
      enrollments: { some: {}, none: { status: "ACTIVE" } },
    },
    data: { status: "COMPLETED" },
  });
}

export async function notifySuperAdmin(subject, html, { replyTo } = {}) {
  const to = process.env.SUPERADMIN_EMAIL;
  if (!to) {
    console.warn(`[B2B] SUPERADMIN_EMAIL is not set — dropped notification: ${subject}`);
    return;
  }
  // Every notice gets the standard card; one already built from a template keeps its own.
  const body = html.includes("<!--ai4hb-logo-->") ? html : Templates.getAdminNoticeEmail(subject, html);
  await MailService.sendEmail({ to, subject, html: body, source: "b2b-notify", replyTo, noReply: !replyTo }).catch((e) =>
    console.error("[B2B] Super admin notification failed:", e.message),
  );
}


const AUTO_SUBJECT_RE = /^(auto(matic)?[\s-]*(reply|response)|autoreply|auto:|out of (the )?office|ooo\b|away from (the |my )?(office|desk)|on (vacation|holiday|leave))/i;
// Mail apps wrap a long "On ... wrote:" line, so it can span two lines.
const QUOTE_MARKER_RE = /^\s*(>|on [^\n]+(\r?\n[^\n]*)?wrote:|-{2,}\s*(original|forwarded) message|_{5,}|from:\s|sent from my )|<blockquote|class="gmail_quote"/im;
const BARE_STOP_RE = /^\s*(please\s+)?stop[\s.!]*$/i;
const OPT_OUT_RE = /\b(unsubscribe|remove me|take me off|opt(ing)?[\s-]?out|stop (e-?mailing|texting|messaging|contacting|sending)|(do not|don'?t) (contact|e-?mail|text|message)|no more (e-?mails|texts|messages))\b/i;

const AUTO_BODY_RE = /\b(out of (the )?office|automatic reply|auto-?reply|auto-?response|this is an automated)\b/i;
const lowerHeaders = (headers) =>
  Object.fromEntries(Object.entries(headers && typeof headers === "object" ? headers : {}).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));

/** Out-of-office and other machine replies, which say nothing about the lead's interest. */
export function isAutoReply({ headers, subject, body }) {
  const h = lowerHeaders(headers);
  if (h["auto-submitted"] && h["auto-submitted"] !== "no") return true;
  if (h["x-autoreply"] || h["x-autorespond"]) return true;
  if (/^(auto_reply|bulk|junk)$/.test(h.precedence || "")) return true;
  if (AUTO_SUBJECT_RE.test(String(subject || "").trim())) return true;
  return AUTO_BODY_RE.test(latestReplyText(body).slice(0, 400));
}

/** True when the mail server's checks say the From address is forged. No checks means unknown, not forged. */
export function looksForged(headers) {
  const auth = lowerHeaders(headers)["authentication-results"] || "";
  return /\bdmarc=fail\b/.test(auth) || (/\bspf=fail\b/.test(auth) && /\bdkim=fail\b/.test(auth));
}

export const NOT_INTERESTED_REASON = "the lead said they are not interested";

/** A daily-limit pause ends by itself; a handoff stays until a person resumes the AI. */
export const isAgentPaused = (lead) =>
  !!lead.agentPausedAt && !(lead.agentPausedUntil && new Date(lead.agentPausedUntil) <= new Date());

// The per-lead daily limit. It pauses the agent until the 24 hours are up.
export const LEAD_DAILY_LIMIT = "the daily reply limit for this lead";
export const pausedForDailyLimit = (lead) => isAgentPaused(lead) && lead.agentPauseReason === `it reached ${LEAD_DAILY_LIMIT}`;

// A lead saying they're ready ("I'm interested", "how can I reach you") is the reply that matters
// most, so it is answered even past the per-lead daily limit. The lifetime and platform limits still apply.
const INTERESTED_RE =
  /\binterested\b|\bsign (me|us) up\b|\bcount (me|us) in\b|\blet'?s (talk|chat|meet|book|schedule|do it)\b|\bbook (a|me|us)\b|\bset up a (call|demo|meeting)\b|\b(how|where) (can|do|should) (i|we) (contact|reach|call|book|sign up|get started|start)\b|\bget started\b|\bcall me\b|\bdemo\b/i;
const NOT_INTERESTED_RE = /\bnot\s+(really\s+|very\s+)?interested\b|\bno longer interested\b/i;
export const showsInterest = (text) => INTERESTED_RE.test(String(text || "")) && !NOT_INTERESTED_RE.test(String(text || ""));

/** Keeps a business lead's SMS status in step with STOP and START texts on the shared number. */
export async function setB2BSmsOptOut(contact, optedOut) {
  const digits = String(contact || "").replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return;
  const leads = await prisma.b2BLead.findMany({ where: { phone: { contains: digits } }, select: { id: true } });
  for (const { id } of leads) {
    await prisma.b2BLead.update({ where: { id }, data: { smsOptOut: optedOut } });
    if (optedOut) {
      await exitB2BEnrollments(id, "UNSUBSCRIBE");
      await endB2BJourney(id);
    }
  }
}

/** Only what the lead just wrote: our own quoted email contains the word "Unsubscribe". */
export function latestReplyText(body) {
  const text = String(body || "");
  const quote = text.search(QUOTE_MARKER_RE);
  return quote === -1 ? text : text.slice(0, quote);
}

const replyPlainText = (body) =>
  latestReplyText(body).replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").trim();

/** Why the agent must not answer this lead on this channel, or null. */
/** `interested`: the lead's latest message shows interest, which gets past the per-lead daily limit. */
export async function agentBlockReason(lead, channel, { interested = false } = {}) {
  if (!hasLLM()) return "no AI provider is configured";
  if (isAgentPaused(lead) && !(interested && pausedForDailyLimit(lead))) {
    return `it is paused for this lead (${lead.agentPauseReason || "paused by the team"})`;
  }
  if (B2B_CLOSED_STATUSES.includes(lead.status)) return `the lead is ${lead.status}`;
  if (channel === "EMAIL") return lead.emailOptOut ? "the lead opted out of email" : null;
  if (lead.smsOptOut) return "the lead opted out of SMS";
  if (!toE164(lead.phone)) return "the lead has no +1 number";
  const stopped = await prisma.suppressionList.findFirst({
    where: { companyId: null, value: { contains: lead.phone.replace(/\D/g, "").slice(-10) } },
  });
  return stopped ? "the lead replied STOP" : null;
}

export function asksToOptOut({ body, subject }) {
  const freshSubject = /^(re|fwd?):/i.test(String(subject || "").trim()) ? "" : subject;
  const latest = latestReplyText(body);
  return OPT_OUT_RE.test(`${freshSubject || ""} ${latest}`) || BARE_STOP_RE.test(latest);
}

export async function handleB2BReply({ channel, sender, body, subject, headers }) {
  const contact = String(sender || "").trim().toLowerCase();
  if (!contact) return false;
  const digits = contact.replace(/\D/g, "").slice(-10);
  if (channel === "SMS" && !digits) return false;
  const lead = await prisma.b2BLead.findFirst({
    where: channel === "SMS" ? { phone: { contains: digits } } : { email: contact },
  });
  if (!lead) return false;

  // Handled, but the campaign carries on: nobody actually replied.
  if (channel === "EMAIL" && isAutoReply({ headers, subject, body })) return true;

  const text = replyPlainText(body);

  // Someone else may be using this address: no opt-out, no agent, no campaign change.
  if (channel === "EMAIL" && looksForged(headers)) {
    await notifySuperAdmin(
      `Suspicious email claiming to be ${lead.companyName}`,
      `<p>An email from ${escapeHtml(sender)} failed the sender checks, so it was ignored. Please check with them directly if it matters.</p>` +
        `<blockquote style="border-left:3px solid #ccc;margin:0;padding-left:12px;white-space:pre-wrap">${escapeHtml(text)}</blockquote>`,
    );
    return true;
  }

  const record = (handledAt) =>
    prisma.b2BMessage.create({
      data: { leadId: lead.id, direction: "IN", actor: "LEAD", channel, subject: subject || null, body: text || "(empty message)", handledAt },
    });

  // A text has no unsubscribe link, so words count there. Email opts out only through its
  // link; a request by email is answered with that link by the agent.
  if (channel === "SMS" && asksToOptOut({ body, subject })) {
    await record(new Date());
    await prisma.b2BLead.update({ where: { id: lead.id }, data: { smsOptOut: true } });
    await exitB2BEnrollments(lead.id, "UNSUBSCRIBE");
    await endB2BJourney(lead.id);
    await notifySuperAdmin(
      `B2B lead opted out of SMS: ${lead.companyName}`,
      `<p><strong>${escapeHtml(lead.contactName || lead.companyName)}</strong> (${escapeHtml(lead.companyName)}, ${escapeHtml(sender)}) ` +
        `asked by text not to be contacted. They are opted out of SMS and all scheduled messages have stopped.</p>` +
        `<blockquote style="border-left:3px solid #ccc;margin:0;padding-left:12px;white-space:pre-wrap">${escapeHtml(latestReplyText(body))}</blockquote>`,
    );
    return true;
  }

  const campaignsStopped = await exitB2BEnrollments(lead.id, "REPLY");
  await moveJourneyToResponded(lead.id);
  if (lead.status === "NEW") {
    await prisma.b2BLead.update({ where: { id: lead.id }, data: { status: "CONTACTED" } });
  }

  // The agent answers and reports the turn itself; otherwise a person gets the reply now.
  // While paused, keep the message open: a person can have the AI answer it on resume.
  let blocked = await agentBlockReason(lead, channel, { interested: showsInterest(text) });
  await record(blocked && !isAgentPaused(lead) ? new Date() : null);
  if (!blocked) {
    try {
      await inngest.send({ name: "b2b.reply.received", data: { leadId: lead.id, channel } });
      return true;
    } catch (error) {
      console.error("[B2B agent] Could not start:", error.message);
      blocked = "the AI could not start";
    }
  }
  await notifySuperAdmin(
    `B2B lead reply from ${lead.companyName}${subject ? `: ${subject}` : ""}`,
    `<p><strong>${escapeHtml(lead.contactName || lead.companyName)}</strong> (${escapeHtml(lead.companyName)}, ` +
      `${escapeHtml(sender)}) replied by ${channel === "SMS" ? "text" : "email"}. ` +
      `${campaignsStopped ? "Their campaign messages have been stopped. " : ""}AI did not reply: ${escapeHtml(blocked)}.</p>` +
      `<blockquote style="border-left:3px solid #ccc;margin:0;padding-left:12px;white-space:pre-wrap">${escapeHtml(text)}</blockquote>` +
      `<p><a href="${appUrl()}/admin/leads">Open Business Leads</a></p>`,
    { replyTo: channel === "EMAIL" ? lead.email : undefined },
  );
  return true;
}
