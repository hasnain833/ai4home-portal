import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { MailService } from "../../services/mail-service.js";
import { sendSms } from "../../services/sms.service.js";
import { getLeadTimezone, getNextValidSendWindow } from "../../lib/timezone.js";
import { ComplianceService } from "../../services/compliance-service.js";
import { getMessagingConfig } from "../../lib/messaging-config.js";
import { deadLetter } from "../../lib/dead-letter.js";
import { deadLetterJob } from "../../lib/dead-letter.js";
import { renderMergeFields, leadMergeVars, escapeHtml } from "../../lib/utils.js";
import { getOrCreateLeadBookingToken } from "../../lib/public-tokens.js";
import { LEAD_STATUS } from "../../lib/lead-statuses.js";
import { Templates } from "../../services/templates.js";

/**
 * The next step to run given a resume point. `currentStepPosition` is the position
 * of the step to run NEXT, so completing step N records N+1 and a restarted run
 * resumes after N instead of re-sending it.
 */
export function nextStepFrom(steps, currentPosition) {
  return (steps || []).find((s) => s.position >= currentPosition) || null;
}

/** What to record once the step at this position is done. */
export function resumePointAfter(step) {
  return step.position + 1;
}

// Helper function to calculate delay
const calculateDelayTime = (value, unit) => {
  const d = new Date();
  const cleanUnit = unit.toUpperCase();
  if (cleanUnit === "MINUTES" || cleanUnit === "MINUTE") {
    d.setMinutes(d.getMinutes() + value);
  } else if (cleanUnit === "HOURS" || cleanUnit === "HOUR") {
    d.setHours(d.getHours() + value);
  } else {
    d.setDate(d.getDate() + value);
  }
  return d;
};

// Only the fields the run actually uses. Step results are persisted by the job
// engine and replayed on every wake, so we keep the payload small and free of
// anything sensitive — credentials are fetched inside the send step instead.
const ENROLLMENT_SELECT = {
  id: true,
  status: true,
  currentStepPosition: true,
  lead: {
    select: {
      id: true,
      companyId: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      city: true,
      state: true,
      status: true,
      company: { select: { name: true } },
    },
  },
  campaign: {
    select: {
      id: true,
      name: true,
      versionPolicy: true,
      steps: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          position: true,
          type: true,
          delayValue: true,
          delayUnit: true,
          sendWindowDays: true,
          sendWindowStart: true,
          sendWindowEnd: true,
          subject: true,
          body: true,
        },
      },
    },
  },
};

export const runNurtureCampaign = inngest.createFunction(
  {
    id: "run-nurture-campaign-v4",
    // Deliberately NOT idempotent on enrollmentId. Idempotency permanently blocks
    // a second run, so any failure froze the enrollment forever with no way back.
    // A concurrency key of 1 gives the same protection against overlapping runs
    // while still letting a later run recover a stalled enrollment.
    concurrency: [
      { key: "event.data.campaignId", limit: 2 },
      { key: "event.data.enrollmentId", limit: 1 },
    ],
    triggers: [{ event: "campaign.enrollment.started" }],
    onFailure: async ({ event, error }) =>
      deadLetterJob({ functionId: "run-nurture-campaign-v4", event, error }),
  },
  async ({ event, step }) => {
    const { leadId, campaignId, enrollmentId } = event.data;
    console.log(`[Nurture] === START === event received for lead=${leadId}, campaign=${campaignId}, enrollment=${enrollmentId}`);

    // Inside a step: the job engine re-executes the function body from the top on
    // every wake, so an un-stepped read here meant one database hiccup three days
    // into a campaign killed the whole run. Stepped, it is retried and memoized.
    const e = await step.run("load-enrollment", async () =>
      prisma.campaignEnrollment.findUnique({
        where: { id: enrollmentId },
        select: ENROLLMENT_SELECT,
      }),
    );

    const lead = e?.lead;
    const campaign = e?.campaign;
    const enrollment = e;

    if (!enrollment || enrollment.status !== "ACTIVE") {
      console.log(`[Nurture] SKIPPED: enrollment status=${enrollment?.status || 'NOT FOUND'}`);
      return { status: "skipped", reason: "Enrollment not active or not found" };
    }

    const migrate = (campaign.versionPolicy || "FINISH_OLD") === "MIGRATE";
    let workingSteps = campaign.steps;
    console.log(`[Nurture] Processing ${workingSteps.length} steps (versionPolicy=${campaign.versionPolicy || "FINISH_OLD"}). currentStepPosition=${enrollment.currentStepPosition}`);

    // currentStepPosition is the step to run NEXT — the resume point — so a run
    // that restarts picks up after the last completed step instead of repeating it.
    let currentPosition = enrollment.currentStepPosition || 1;

    while (true) {
      if (migrate) {
        workingSteps = await step.run(`reload-steps-${currentPosition}`, async () =>
          prisma.campaignStep.findMany({
            where: { campaignId },
            orderBy: { position: "asc" },
            select: ENROLLMENT_SELECT.campaign.select.steps.select,
          }),
        );
      }
      const currentStep = nextStepFrom(workingSteps, currentPosition);
      if (!currentStep) break;
      console.log(`[Nurture] Executing step position=${currentStep.position}, type=${currentStep.type}`);

      const nextPosition = resumePointAfter(currentStep);

      if (currentStep.type === "DELAY") {
        const nextTime = await step.run(`calc-delay-${currentStep.position}`, async () => {
          const delayValue = currentStep.delayValue || 0;
          const delayUnit = currentStep.delayUnit || "DAYS";

          let t = calculateDelayTime(delayValue, delayUnit);

          if (currentStep.sendWindowDays && currentStep.sendWindowStart && currentStep.sendWindowEnd) {
            const tz = getLeadTimezone(lead.state);
            t = getNextValidSendWindow(t, tz, currentStep.sendWindowDays, currentStep.sendWindowStart, currentStep.sendWindowEnd);
          }

          // Record the delay as done and park nextRunAt at the wake time. The
          // stalled-enrollment sweep only picks up rows whose nextRunAt has passed,
          // so an enrollment legitimately sleeping here is never resumed early.
          await prisma.campaignEnrollment.update({
            where: { id: enrollment.id },
            data: { currentStepPosition: nextPosition, nextRunAt: t },
          });

          return new Date(t).toISOString();
        });

        await step.sleepUntil(`wait-for-delay-${currentStep.position}`, nextTime);

        currentPosition = nextPosition;
        continue;
      }

      if (currentStep.sendWindowDays && currentStep.sendWindowStart && currentStep.sendWindowEnd) {
        const windowTarget = await step.run(`calc-window-${currentStep.position}`, async () => {
          const tz = getLeadTimezone(lead.state);
          const nextValidTime = getNextValidSendWindow(new Date(), tz, currentStep.sendWindowDays, currentStep.sendWindowStart, currentStep.sendWindowEnd);
          if (new Date(nextValidTime).getTime() > Date.now() + 60000) {
            return new Date(nextValidTime).toISOString();
          }
          return null;
        });
        if (windowTarget) {
          await step.sleepUntil(`wait-for-window-${currentStep.position}`, windowTarget);
        }
      }

      let complianceCheck;
      let quietHoursAttempts = 0;
      while (true) {
        complianceCheck = await step.run(
          `compliance-${currentStep.position}-${quietHoursAttempts}`,
          async () => ComplianceService.validateOutboundMessage(lead.id, currentStep.type),
        );
        console.log(`[Nurture] Compliance check result: allowed=${complianceCheck.allowed}, reason=${complianceCheck.reason || 'none'}`);

        if (complianceCheck.allowed || !complianceCheck.reason?.includes("Quiet Hours")) {
          break;
        }

        quietHoursAttempts += 1;
        const resumeAt = await step.run(`calc-quiet-hours-${currentStep.position}-${quietHoursAttempts}`, async () => {
          const tz = getLeadTimezone(lead.state, lead.phone);
          const target = getNextValidSendWindow(new Date(Date.now() + 60000), tz, "Mon,Tue,Wed,Thu,Fri,Sat,Sun", "08:00", "21:00");
          return new Date(target).toISOString();
        });
        await step.sleepUntil(`wait-for-quiet-hours-${currentStep.position}-${quietHoursAttempts}`, resumeAt);
      }

      if (!complianceCheck.allowed) {
        await step.run(`skip-step-${currentStep.position}`, async () => {
          await prisma.campaignEnrollment.update({
            where: { id: enrollment.id },
            data: { currentStepPosition: nextPosition },
          });
        });
        currentPosition = nextPosition;
        continue;
      }

      const sendResult = await step.run(`send-step-${currentStep.position}`, async () => {
        // Credentials are read here, not once per run: they stay out of the job
        // engine's persisted step state, and a mid-campaign rotation is picked up.
        const { smtpConfig, smsConfig } = await getMessagingConfig(lead.companyId);

        if (lead.status === LEAD_STATUS.NEW) {
          // A cosmetic status write must never be what stops a campaign.
          await prisma.lead
            .update({ where: { id: lead.id }, data: { status: LEAD_STATUS.NURTURING } })
            .catch((err) => console.error(`[Nurture] Could not mark lead nurturing: ${err.message}`));
        }
        const bookingToken = await getOrCreateLeadBookingToken(lead.id);
        const bookingLink = `${process.env.NEXT_PUBLIC_URL || "http://localhost:3000"}/book/${bookingToken}`;
        const variables = {
          firstName: lead.firstName || "",
          lastName: lead.lastName || "",
          email: lead.email || "",
          phone: lead.phone || "",
          city: lead.city || "",
          companyName: lead.company?.name || "",
          campaignName: campaign.name || "",
          bookingLink,
        };
        const renderText = (templateText, html = false) =>
          renderMergeFields(templateText, variables, {
            html,
            raw: new Set(["bookingLink"]),
          });

        console.log(`[Nurture] Step type=${currentStep.type}, lead.email=${lead.email}, lead.phone=${lead.phone}`);

        if (currentStep.type === "EMAIL" && lead.email) {
          const subject = renderText(currentStep.subject || "Outreach Update");
          const body = renderText(currentStep.body || "", true);
          console.log(`[Nurture] Sending EMAIL to ${lead.email}, subject="${subject}"`);

          const formattedHtml = Templates.getNurtureEmail(
            body.replace(/\n/g, "<br />"),
            escapeHtml(lead.company?.name || "Warranty Care & Sales Portal")
          );

          const unsubscribeUrl = `${process.env.NEXT_PUBLIC_URL || "http://localhost:3000"}/unsubscribe/${lead.id}`;
          const finalHtml = ComplianceService.addEmailUnsubscribeFooter(
            formattedHtml,
            unsubscribeUrl,
            lead.company?.name || "Warranty Care Portal"
          );

          const emailResult = await MailService.sendEmail({
            to: lead.email,
            subject,
            html: finalHtml,
            fromName: lead.company?.name || undefined,
            smtpConfig,
            headers: { "X-Mailin-Tag": currentStep.id },
          });
          if (!emailResult.success) {
            await deadLetter({
              companyId: lead.companyId,
              source: "CAMPAIGN",
              channel: "EMAIL",
              leadId: lead.id,
              refId: campaign.id,
              payload: {
                to: lead.email,
                subject,
                html: finalHtml,
                fromName: lead.company?.name || null,
              },
              error: emailResult.error || "Unknown error",
            });
          }

          return {
            channel: "EMAIL",
            attempted: true,
            success: !!emailResult.success,
            messageId: emailResult.messageId || null,
            error: emailResult.success ? null : (emailResult.error || "Unknown error"),
            subject,
            body,
          };
        } else if (currentStep.type === "SMS" && lead.phone) {
          const rawBody = renderText(currentStep.body || "");
          const finalBody = ComplianceService.addSmsOptOutSuffix(rawBody);

          try {
            console.log(`[Nurture] Step ${currentStep.position}: Triggering sendSms to ${lead.phone}...`);
            await sendSms({ to: lead.phone, body: finalBody, smsConfig, tag: currentStep.id });
            console.log(`[Nurture] Step ${currentStep.position}: sendSms completed successfully!`);
            return { channel: "SMS", attempted: true, success: true, error: null, body: finalBody };
          } catch (smsError) {
            console.error(`[Nurture] Step ${currentStep.position}: sendSms failed with error:`, smsError);
            // SW-ANN-002: park the failed step SMS for inspection/replay.
            await deadLetter({
              companyId: lead.companyId,
              source: "CAMPAIGN",
              channel: "SMS",
              leadId: lead.id,
              refId: campaign.id,
              payload: { to: lead.phone, body: finalBody },
              error: smsError.message || "Unknown error",
            });
            return { channel: "SMS", attempted: true, success: false, error: smsError.message || "Unknown error", body: finalBody };
          }
        }
        return { channel: currentStep.type, attempted: false };
      });

      await step.run(`record-step-${currentStep.position}`, async () => {
        if (sendResult.attempted && sendResult.success) {
          console.log(`[Nurture] Step ${currentStep.position}: ${sendResult.channel} sent successfully.`);
        } else if (!sendResult.attempted) {
          console.log(`[Nurture] Step ${currentStep.position}: no ${currentStep.type} contact channel on lead; nothing sent.`);
        }

        // Advance past the completed step so a resumed run does not re-send it.
        await prisma.campaignEnrollment.update({
          where: { id: enrollment.id },
          data: { currentStepPosition: nextPosition },
        });
      });

      currentPosition = nextPosition;
    }

    // Finished all steps
    console.log(`[Nurture] All steps processed. Completing campaign.`);
    await step.run(`complete-campaign-${campaignId}-${enrollment.id}`, async () => {
      await prisma.campaignEnrollment.update({
        where: { id: enrollment.id },
        data: { status: "COMPLETED", nextRunAt: null },
      });

      const activeCount = await prisma.campaignEnrollment.count({
        where: { campaignId, status: { in: ["ACTIVE", "PAUSED"] } }
      });
      if (activeCount === 0) {
        await prisma.campaign.updateMany({ where: { id: campaignId, status: "Active" }, data: { status: "Completed" } });
      }
    });

    return { status: "completed" };
  }
);

// An enrollment is "stalled" when it is still ACTIVE, is not deliberately asleep
// in a DELAY, and has not moved for a while — i.e. its run died. Re-emitting the
// start event is safe: the enrollmentId concurrency key stops it from overlapping
// a run that is somehow still alive, and currentStepPosition resumes it after the
// last completed step rather than repeating one.
const STALE_AFTER_MS = 30 * 60 * 1000;
const RESUME_BATCH = 200;

export const resumeStalledEnrollments = inngest.createFunction(
  { id: "resume-stalled-enrollments", triggers: [{ cron: "*/15 * * * *" }] },
  async ({ step }) => {
    const stalled = await step.run("find-stalled-enrollments", async () => {
      // Both the wake time and the last write must be well in the past. Using
      // "nextRunAt < now" would race a healthy run that is waking from its delay
      // right now and has not yet written its next step.
      const cutoff = new Date(Date.now() - STALE_AFTER_MS);
      const rows = await prisma.campaignEnrollment.findMany({
        where: {
          status: "ACTIVE",
          updatedAt: { lt: cutoff },
          // Either it never reached a delay, or its delay ended long ago.
          OR: [{ nextRunAt: null }, { nextRunAt: { lt: cutoff } }],
          campaign: { status: "Active" },
        },
        select: {
          id: true,
          leadId: true,
          campaignId: true,
          lead: { select: { companyId: true } },
        },
        take: RESUME_BATCH,
      });
      return rows.map((r) => ({
        enrollmentId: r.id,
        leadId: r.leadId,
        campaignId: r.campaignId,
        companyId: r.lead?.companyId || null,
      }));
    });

    if (stalled.length === 0) return { resumed: 0 };

    console.warn(`[Nurture] Resuming ${stalled.length} stalled enrollment(s).`);
    await step.sendEvent(
      "resume-stalled-enrollments",
      stalled.map((data) => ({ name: "campaign.enrollment.started", data })),
    );

    return { resumed: stalled.length };
  },
);

function shouldExitCampaign(reason, exitConditions, newStatus) {
  const cfg = exitConditions || {};
  switch (reason) {
    case "REPLY":
      return cfg.onReply !== false;
    case "APPOINTMENT":
      return true;
    case "STATUS_CHANGE":
      return !!cfg.onStatusChange && cfg.onStatusChange === newStatus;
    default:
      return true;
  }
}

export const handleCampaignExit = inngest.createFunction(
  { id: "handle-campaign-exit", triggers: [{ event: "campaign.exit" }] },
  async ({ event, step }) => {
    const { leadId, reason, newStatus } = event.data;

    const result = await step.run("update-enrollments-exited", async () => {
      const enrollments = await prisma.campaignEnrollment.findMany({
        where: { leadId, status: { in: ["ACTIVE", "PAUSED"] } },
        include: { campaign: true }
      });

      let exited = 0;
      for (const enrollment of enrollments) {
        if (!shouldExitCampaign(reason, enrollment.campaign.exitConditions, newStatus)) {
          continue;
        }

        await prisma.campaignEnrollment.update({
          where: { id: enrollment.id },
          data: { status: "EXITED", exitedReason: reason },
        });

        // currentStepPosition points at the step to run next, so the message the
        // lead actually replied to is the one before it.
        const repliedToPosition = (enrollment.currentStepPosition || 0) - 1;
        if (reason === "REPLY" && repliedToPosition > 0) {
          const stepRow = await prisma.campaignStep.findFirst({
            where: { campaignId: enrollment.campaignId, position: repliedToPosition },
          });
          if (stepRow) {
            await prisma.campaignStep.update({
              where: { id: stepRow.id },
              data: { repliedCount: { increment: 1 } },
            });
          }
        }

        const activeCount = await prisma.campaignEnrollment.count({
          where: { campaignId: enrollment.campaignId, status: { in: ["ACTIVE", "PAUSED"] } }
        });
        if (activeCount === 0) {
          await prisma.campaign.updateMany({ where: { id: enrollment.campaignId, status: "Active" }, data: { status: "Completed" } });
        }
        exited += 1;
      }
      return { exited };
    });
    return result;
  }
);
