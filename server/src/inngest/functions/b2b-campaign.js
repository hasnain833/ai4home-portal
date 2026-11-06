import { randomUUID } from "node:crypto";
import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { MailService, MAIL_OUTCOME } from "../../services/mail-service.js";
import { sendSms, smsSent, brandSmsBody, toE164, SMS_OUTCOME } from "../../services/sms.service.js";
import { ComplianceService } from "../../services/compliance-service.js";
import { b2bLeadTimezone, getNextValidSendWindow, nextLocalSendTime, safeSendTime, sendHoursFor } from "../../lib/timezone.js";
import { renderMergeFields } from "../../lib/utils.js";
import {
  B2B_CLOSED_STATUSES,
  B2B_REPLY_TAG,
  b2bEmailHtml,
  bookingLinkFor,
  exitB2BEnrollments,
  completeFinishedCampaigns,
  getB2BJourneySettings,
  weeklyLimitReached,
} from "../../lib/b2b.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const SENDER = "AI for Homebuilders";
// Hard stop for the loop below; a campaign is capped at 20 steps, each can wait several times.
const MAX_ITERATIONS = 200;
// A failed send gets two more tries before the lead moves on to the next step.
const RETRY_DELAYS_MS = [15 * 60 * 1000, 60 * 60 * 1000];

/** First word of the contact name, for "Hi {{firstName}}". */
const firstNameOf = (lead) => (lead.contactName || "").trim().split(/\s+/)[0] || "there";

export function renderB2BStep(step, lead, campaignId, stepId) {
  // Email clicks come from Brevo. A text's link carries the step, so opening it counts as a click.
  const bookingLink = bookingLinkFor(lead, campaignId, step.channel === "SMS" ? stepId : undefined);
  const vars = {
    firstName: firstNameOf(lead),
    contactName: lead.contactName || "",
    companyName: lead.companyName || "",
    city: lead.city || "",
    bookingLink,
  };
  const hasLink = /\{\{?\s*bookingLink\s*\}?\}/.test(step.body || "");

  if (step.channel === "SMS") {
    let text = renderMergeFields(step.body, vars);
    // Every message carries the booking link, even if the template forgot it.
    // A lead who already has a meeting shouldn't be told to book one.
    if (!hasLink && !step.noBookingLink) text = `${text.trim()} Book a time: ${bookingLink}`;
    return { text, body: ComplianceService.addSmsOptOutSuffix(brandSmsBody(text, SENDER)) };
  }

  // Keep the CTA where the author placed it; the email template turns it into
  // a button. Add a default button only when the content omits the link.
  const text = renderMergeFields(step.body, vars).trim();
  return {
    text,
    subject: renderMergeFields(step.subject, vars),
    html: b2bEmailHtml(text, lead, { bookingLink, bookingButton: !step.noBookingLink }),
  };
}

/** Why this lead must not get this step, or null. A non-null `exit` ends the enrollment. */
export async function blockReason(lead, channel) {
  if (B2B_CLOSED_STATUSES.includes(lead.status)) return { exit: "STATUS", reason: `Lead is ${lead.status}` };
  if (channel === "EMAIL") {
    if (lead.emailOptOut) return { exit: "UNSUBSCRIBE", reason: "Unsubscribed from email" };
    if (!lead.email) return { reason: "No email address" };
    return null;
  }
  if (lead.smsOptOut) return { exit: "UNSUBSCRIBE", reason: "Opted out of SMS" };
  if (!lead.phone) return { reason: "No phone number" };
  if (!toE164(lead.phone)) return { reason: "Not a +1 number" };
  // A STOP on the shared platform number is recorded as a platform-wide (companyId null) suppression.
  const digits = lead.phone.replace(/\D/g, "").slice(-10);
  const stopped = await prisma.suppressionList.findFirst({
    where: { companyId: null, value: { contains: digits } },
  });
  if (stopped) return { exit: "UNSUBSCRIBE", reason: `Replied STOP (${stopped.reason})` };
  if (!lead.smsConsentAt) return { reason: "No SMS consent on file" };
  return null;
}

export async function sendStep(step, lead, campaignId, stepId) {
  const msg = renderB2BStep(step, lead, campaignId, stepId);
  const track = { leadId: lead.id, campaignId, stepId };
  if (step.channel === "SMS") {
    const r = await sendSms({ to: lead.phone, body: msg.body, source: "b2b-campaign", brand: false, track });
    return { outcome: r.outcome, sent: smsSent(r), error: r.error || null, text: msg.text, subject: null };
  }
  const inbound = String(process.env.INBOUND_EMAIL_DOMAIN || "").trim();
  // Brevo echoes X-Mailin-custom on every webhook event; it is how a bounce or open finds this send.
  const trackId = randomUUID();
  const r = await MailService.sendEmail({
    to: lead.email,
    subject: msg.subject,
    html: msg.html,
    fromName: SENDER,
    // Replies come back to the platform (inbound webhook) or straight to the super admin.
    replyTo: inbound ? `reply+${B2B_REPLY_TAG}@${inbound}` : process.env.SUPERADMIN_EMAIL || undefined,
    source: "b2b-campaign",
    headers: { "X-Mailin-Tag": track.stepId, "X-Mailin-custom": trackId },
    track: { ...track, providerMessageId: trackId },
  });
  return { outcome: r.outcome, sent: !!r.success, error: r.success ? null : r.error || "Unknown error", text: msg.text, subject: msg.subject };
}

/** Saves what we said, so the agent knows what a lead is replying to. Never blocks the campaign. */
const recordCampaignMessage = (lead, step, sent, campaignId, position) =>
  prisma.b2BMessage
    .create({
      data: {
        leadId: lead.id, direction: "OUT", actor: "CAMPAIGN", channel: step.channel, subject: sent.subject, body: sent.text,
        outcome: "sent", handledAt: new Date(), note: `${campaignId}|b2b:${position + 1}`,
      },
    })
    .catch((e) => console.error("[B2B campaign] Could not save message text:", e.message));

const load = (enrollmentId) =>
  prisma.b2BEnrollment.findUnique({
    where: { id: enrollmentId },
    include: { lead: true, campaign: true },
  });

export const runB2BCampaign = inngest.createFunction(
  {
    id: "run-b2b-campaign",
    concurrency: [{ limit: 5 }, { key: "event.data.enrollmentId", limit: 1 }],
    triggers: [{ event: "b2b.enrollment.started" }],
    // Platform jobs have no tenant dead-letter queue: surface the failure on the enrollment
    // (shown in the campaign's progress view); the stalled-run sweep retries it.
    onFailure: async ({ event, error }) => {
      const id = event?.data?.event?.data?.enrollmentId;
      if (!id) return;
      await prisma.b2BEnrollment
        .update({ where: { id }, data: { lastError: `Send job failed: ${String(error?.message || error).slice(0, 300)}` } })
        .catch(() => {});
    },
  },
  async ({ event, step }) => {
    const { enrollmentId } = event.data;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      // Re-read every pass: the run sleeps for days, and a booking, reply, opt-out,
      // pause or edit in the meantime must be seen before anything goes out.
      const state = await step.run(`check-${i}`, async () => {
        const e = await load(enrollmentId);
        if (!e || e.status !== "ACTIVE") return { stop: "enrollment not active" };
        if (e.campaign.status !== "ACTIVE") return { stop: "campaign not active" };
        const steps = Array.isArray(e.campaign.steps) ? e.campaign.steps : [];
        const current = steps[e.currentStep];
        if (!current) {
          await prisma.b2BEnrollment.update({ where: { id: e.id }, data: { status: "COMPLETED", nextRunAt: null } });
          await completeFinishedCampaigns(e.campaignId);
          return { stop: "completed" };
        }
        let due = e.nextRunAt ? new Date(e.nextRunAt) : new Date();
        const { timezone: tz, known } = b2bLeadTimezone(e.lead);
        if (current.sendTime && !e.stepAttempts) {
          // Picked in the campaign (always 8am–9pm), on the lead's own clock, for email and SMS.
          due = nextLocalSendTime(due, tz, safeSendTime(current.sendTime, known));
        } else if (current.channel === "SMS" || current.sendTime) {
          // Same 8am–9pm local-time rule the Sales workspace uses for texts. A retry of a
          // timed step goes out soon after its slot, but still inside these hours.
          const hours = sendHoursFor(known);
          due = new Date(getNextValidSendWindow(due, tz, "Mon,Tue,Wed,Thu,Fri,Sat,Sun", hours.start, hours.end));
        }
        if (due.getTime() > Date.now() + 30_000 && due.getTime() !== e.nextRunAt?.getTime()) {
          // Record the wake-up time so the stalled-run sweep leaves a sleeping run alone.
          await prisma.b2BEnrollment.update({ where: { id: e.id }, data: { nextRunAt: due } });
        }
        return { due: due.toISOString(), stepIndex: e.currentStep };
      });

      if (state.stop) return { status: state.stop };

      if (new Date(state.due).getTime() > Date.now() + 30_000) {
        await step.sleepUntil(`wait-${i}`, state.due);
        continue; // re-check after waking
      }

      const result = await step.run(`send-${i}`, async () => {
        const e = await load(enrollmentId);
        if (!e || e.status !== "ACTIVE" || e.campaign.status !== "ACTIVE") return { stop: "no longer active" };
        const current = (Array.isArray(e.campaign.steps) ? e.campaign.steps : [])[state.stepIndex];
        if (!current) return { next: true };

        const blocked = await blockReason(e.lead, current.channel);
        if (blocked?.exit) {
          await exitB2BEnrollments(e.leadId, blocked.exit, { campaignId: e.campaignId });
          return { stop: blocked.reason };
        }

        // Over the weekly limit: try again tomorrow. The step isn't lost.
        if (!blocked && (await weeklyLimitReached(e.leadId, current.channel, await getB2BJourneySettings()))) {
          await prisma.b2BEnrollment.update({
            where: { id: e.id },
            data: { nextRunAt: new Date(Date.now() + DAY_MS), lastError: `Step ${state.stepIndex + 1} waiting: the weekly ${current.channel === "SMS" ? "SMS" : "email"} limit was reached` },
          });
          return { next: true };
        }

        // Claim the step before sending: if a second run (resume, stalled-run sweep) got
        // here first the update matches nothing, and this run stops without a duplicate send.
        const nextStep = (Array.isArray(e.campaign.steps) ? e.campaign.steps : [])[state.stepIndex + 1];
        const nextRunAt = nextStep ? new Date(Date.now() + (nextStep.delayDays || 0) * DAY_MS) : null;
        const claim = await prisma.b2BEnrollment.updateMany({
          where: { id: e.id, status: "ACTIVE", currentStep: state.stepIndex },
          data: { currentStep: state.stepIndex + 1, nextRunAt, stepAttempts: 0 },
        });
        if (claim.count === 0) return { stop: "step already handled by another run" };

        if (blocked) {
          await prisma.b2BEnrollment.update({ where: { id: e.id }, data: { lastError: `Step ${state.stepIndex + 1} skipped: ${blocked.reason}` } });
          return { next: true };
        }

        // The step is already claimed, so an Inngest retry would stop here and the message would
        // vanish. An unexpected error has to take the same retry path as a failed send.
        let sent;
        try {
          sent = await sendStep(current, e.lead, e.campaignId, `b2b:${state.stepIndex + 1}`);
        } catch (error) {
          console.error("[B2B campaign] Send error:", error);
          sent = { outcome: MAIL_OUTCOME.FAILED, sent: false, error: error?.message || "Unexpected error" };
        }
        if (sent.sent) await recordCampaignMessage(e.lead, current, sent, e.campaignId, state.stepIndex);
        if (sent.outcome === MAIL_OUTCOME.NOT_CONFIGURED || sent.outcome === SMS_OUTCOME.NOT_CONFIGURED) {
          await prisma.b2BEnrollment.update({
            where: { id: e.id },
            data: { lastError: `Platform ${current.channel} is not configured` },
          });
          await exitB2BEnrollments(e.leadId, "NOT_CONFIGURED", { campaignId: e.campaignId });
          return { stop: "not configured" };
        }
        if (sent.outcome === MAIL_OUTCOME.FAILED && e.stepAttempts < RETRY_DELAYS_MS.length) {
          // Hand the step back; the next pass of the loop waits and sends it again.
          await prisma.b2BEnrollment.update({
            where: { id: e.id },
            data: {
              currentStep: state.stepIndex,
              stepAttempts: e.stepAttempts + 1,
              nextRunAt: new Date(Date.now() + RETRY_DELAYS_MS[e.stepAttempts]),
              lastError: `Step ${state.stepIndex + 1} (${current.channel}) failed, will retry: ${sent.error}`,
            },
          });
          return { next: true };
        }
        await prisma.b2BEnrollment.update({
          where: { id: e.id },
          data: sent.sent
            ? { sentCount: { increment: 1 }, lastSentAt: new Date(), lastError: null }
            : { failedCount: { increment: 1 }, lastError: `Step ${state.stepIndex + 1} (${current.channel}) failed: ${sent.error}` },
        });
        if (sent.sent && e.lead.status === "NEW") {
          await prisma.b2BLead.update({ where: { id: e.leadId }, data: { status: "CONTACTED" } });
        }
        return { next: true };
      });

      if (result.stop) return { status: result.stop };
    }
    return { status: "iteration cap reached" };
  },
);

const STALE_AFTER_MS = 30 * 60 * 1000;

/** Restarts runs that died (deploy, Inngest outage) so an enrollment never silently stalls. */
export const resumeStalledB2BEnrollments = inngest.createFunction(
  { id: "resume-stalled-b2b-enrollments", triggers: [{ cron: "*/15 * * * *" }] },
  async ({ step }) => {
    const ids = await step.run("find-stalled", async () => {
      const cutoff = new Date(Date.now() - STALE_AFTER_MS);
      const rows = await prisma.b2BEnrollment.findMany({
        where: {
          status: "ACTIVE",
          campaign: { status: "ACTIVE" },
          updatedAt: { lt: cutoff },
          OR: [{ nextRunAt: null }, { nextRunAt: { lt: cutoff } }],
        },
        select: { id: true },
        take: 200,
      });
      return rows.map((r) => r.id);
    });
    if (ids.length) {
      await step.sendEvent("resume", ids.map((enrollmentId) => ({ name: "b2b.enrollment.started", data: { enrollmentId } })));
    }
    return { resumed: ids.length };
  },
);
