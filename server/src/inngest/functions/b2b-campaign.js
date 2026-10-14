import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { MailService, MAIL_OUTCOME } from "../../services/mail-service.js";
import { sendSms, smsSent, brandSmsBody, SMS_OUTCOME } from "../../services/sms.service.js";
import { ComplianceService } from "../../services/compliance-service.js";
import { Templates } from "../../services/templates.js";
import { getLeadTimezone, getNextValidSendWindow } from "../../lib/timezone.js";
import { renderMergeFields, escapeHtml } from "../../lib/utils.js";
import {
  B2B_CLOSED_STATUSES,
  B2B_REPLY_TAG,
  bookingLinkFor,
  unsubscribeLinkFor,
  exitB2BEnrollments,
  completeFinishedCampaigns,
} from "../../lib/b2b.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const SENDER = MailService.SENDER_NAME;
// Hard stop for the loop below; a campaign is capped at 20 steps, each can wait several times.
const MAX_ITERATIONS = 200;

/** First word of the contact name, for "Hi {{firstName}}". */
const firstNameOf = (lead) => (lead.contactName || "").trim().split(/\s+/)[0] || "there";

export function renderB2BStep(step, lead, campaignId) {
  const bookingLink = bookingLinkFor(lead, campaignId);
  const vars = {
    firstName: firstNameOf(lead),
    contactName: lead.contactName || "",
    companyName: lead.companyName || "",
    city: lead.city || "",
    bookingLink,
  };
  const raw = new Set(["bookingLink"]);
  const hasLink = /\{\{?\s*bookingLink\s*\}?\}/.test(step.body || "");

  if (step.channel === "SMS") {
    let text = renderMergeFields(step.body, vars);
    // Every message carries the booking link, even if the template forgot it.
    if (!hasLink) text = `${text.trim()} Book a time: ${bookingLink}`;
    return { body: ComplianceService.addSmsOptOutSuffix(brandSmsBody(text, SENDER)) };
  }

  let html = renderMergeFields(step.body, vars, { html: true, raw }).replace(/\n/g, "<br />");
  if (!hasLink) {
    html += `<p style="margin-top:24px"><a href="${bookingLink}" style="background:#b48c3c;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Book a time with us</a></p>`;
  }
  return {
    subject: renderMergeFields(step.subject, vars),
    html: ComplianceService.addEmailUnsubscribeFooter(
      Templates.getNurtureEmail(html, escapeHtml(SENDER)),
      unsubscribeLinkFor(lead),
      SENDER,
    ),
  };
}

/** Why this lead must not get this step, or null. A non-null `exit` ends the enrollment. */
async function blockReason(lead, channel) {
  if (B2B_CLOSED_STATUSES.includes(lead.status)) return { exit: "STATUS", reason: `Lead is ${lead.status}` };
  if (channel === "EMAIL") {
    if (lead.emailOptOut) return { exit: "UNSUBSCRIBE", reason: "Unsubscribed from email" };
    if (!lead.email) return { reason: "No email address" };
    return null;
  }
  if (lead.smsOptOut) return { exit: "UNSUBSCRIBE", reason: "Opted out of SMS" };
  if (!lead.phone) return { reason: "No phone number" };
  // A STOP on the shared platform number is recorded as a platform-wide (companyId null) suppression.
  const digits = lead.phone.replace(/\D/g, "").slice(-10);
  const stopped = await prisma.suppressionList.findFirst({
    where: { companyId: null, value: { contains: digits } },
  });
  if (stopped) return { exit: "UNSUBSCRIBE", reason: `Replied STOP (${stopped.reason})` };
  return null;
}

async function sendStep(step, lead, campaignId) {
  const msg = renderB2BStep(step, lead, campaignId);
  if (step.channel === "SMS") {
    const r = await sendSms({ to: lead.phone, body: msg.body, source: "b2b-campaign", brand: false });
    return { outcome: r.outcome, sent: smsSent(r), error: r.error || null };
  }
  const inbound = String(process.env.INBOUND_EMAIL_DOMAIN || "").trim();
  const r = await MailService.sendEmail({
    to: lead.email,
    subject: msg.subject,
    html: msg.html,
    // Replies come back to the platform (inbound webhook) or straight to the super admin.
    replyTo: inbound ? `reply+${B2B_REPLY_TAG}@${inbound}` : process.env.SUPERADMIN_EMAIL || undefined,
    source: "b2b-campaign",
  });
  return { outcome: r.outcome, sent: !!r.success, error: r.success ? null : r.error || "Unknown error" };
}

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
        if (current.channel === "SMS") {
          // Same 8am–9pm local-time rule the Sales workspace uses for texts.
          const tz = getLeadTimezone(null, e.lead.phone);
          due = new Date(getNextValidSendWindow(due, tz, "Mon,Tue,Wed,Thu,Fri,Sat,Sun", "08:00", "21:00"));
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

        // Claim the step before sending: if a second run (resume, stalled-run sweep) got
        // here first the update matches nothing, and this run stops without a duplicate send.
        const nextStep = (Array.isArray(e.campaign.steps) ? e.campaign.steps : [])[state.stepIndex + 1];
        const nextRunAt = nextStep ? new Date(Date.now() + (nextStep.delayDays || 0) * DAY_MS) : null;
        const claim = await prisma.b2BEnrollment.updateMany({
          where: { id: e.id, status: "ACTIVE", currentStep: state.stepIndex },
          data: { currentStep: state.stepIndex + 1, nextRunAt },
        });
        if (claim.count === 0) return { stop: "step already handled by another run" };

        if (blocked) {
          await prisma.b2BEnrollment.update({ where: { id: e.id }, data: { lastError: `Step ${state.stepIndex + 1} skipped: ${blocked.reason}` } });
          return { next: true };
        }

        const sent = await sendStep(current, e.lead, e.campaignId);
        if (sent.outcome === MAIL_OUTCOME.NOT_CONFIGURED || sent.outcome === SMS_OUTCOME.NOT_CONFIGURED) {
          await prisma.b2BEnrollment.update({
            where: { id: e.id },
            data: { lastError: `Platform ${current.channel} is not configured` },
          });
          await exitB2BEnrollments(e.leadId, "NOT_CONFIGURED", { campaignId: e.campaignId });
          return { stop: "not configured" };
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
