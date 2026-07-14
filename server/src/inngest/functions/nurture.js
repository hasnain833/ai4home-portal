import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { MailService } from "../../services/mail-service.js";
import { sendSms } from "../../services/sms.service.js";
import { getLeadTimezone, getNextValidSendWindow } from "../../lib/timezone.js";
import { ComplianceService } from "../../services/compliance-service.js";
import { getMessagingConfig } from "../../lib/messaging-config.js";

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

export const runNurtureCampaign = inngest.createFunction(
  {
    id: "run-nurture-campaign-v4",
    idempotency: "event.data.enrollmentId",
    concurrency: [{ key: "event.data.enrollmentId", limit: 1 }],
    triggers: [{ event: "campaign.enrollment.started" }],
  },
  async ({ event, step }) => {
    const { leadId, campaignId, enrollmentId } = event.data;
    console.log(`[Nurture] === START === event received for lead=${leadId}, campaign=${campaignId}, enrollment=${enrollmentId}`);

    const e = await prisma.campaignEnrollment.findUnique({
      where: { id: enrollmentId },
      include: {
        lead: {
          include: {
            company: true
          }
        },
        campaign: { include: { steps: { orderBy: { position: "asc" } } } },
      },
    });
    console.log(`[Nurture] fetch-campaign-data: enrollment found=${!!e}, campaign=${e?.campaign?.name}, stepsCount=${e?.campaign?.steps?.length}, lead=${e?.lead?.firstName} ${e?.lead?.lastName} (${e?.lead?.email})`);
    if (e?.campaign?.steps) {
      e.campaign.steps.forEach(s => console.log(`[Nurture]   step position=${s.position}, type=${s.type}, subject=${s.subject}`));
    }
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
    let currentPosition = enrollment.currentStepPosition || 1;

    // Extract messaging configurations via centralized helper
    const { smtpConfig, smsConfig } = await getMessagingConfig(lead?.companyId);

    while (true) {
      if (migrate) {
        workingSteps = await prisma.campaignStep.findMany({
          where: { campaignId },
          orderBy: { position: "asc" },
        });
      }
      const currentStep = workingSteps.find((s) => s.position >= currentPosition);
      if (!currentStep) break;
      console.log(`[Nurture] Executing step position=${currentStep.position}, type=${currentStep.type}`);

      if (currentStep.type === "DELAY") {
        const nextTime = await step.run(`calc-delay-${currentStep.position}`, async () => {
          const delayValue = currentStep.delayValue || 0;
          const delayUnit = currentStep.delayUnit || "DAYS";

          let t = calculateDelayTime(delayValue, delayUnit);

          if (currentStep.sendWindowDays && currentStep.sendWindowStart && currentStep.sendWindowEnd) {
            const tz = getLeadTimezone(lead.state);
            t = getNextValidSendWindow(t, tz, currentStep.sendWindowDays, currentStep.sendWindowStart, currentStep.sendWindowEnd);
          }

          await prisma.campaignEnrollment.update({
            where: { id: enrollment.id },
            data: { currentStepPosition: currentStep.position, nextRunAt: t },
          });

          return new Date(t).toISOString();
        });

        await step.sleepUntil(`wait-for-delay-${currentStep.position}`, nextTime);

        currentPosition = currentStep.position + 1;
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
        complianceCheck = await ComplianceService.validateOutboundMessage(lead.id, currentStep.type);
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
          await prisma.leadTimeline.create({
            data: {
              leadId: lead.id,
              type: "SYNC_UPDATE",
              description: `Skipped ${currentStep.type} step ${currentStep.position} for this lead: ${complianceCheck.reason}`,
              metadata: { campaignId: campaign.id, stepPosition: currentStep.position, reason: complianceCheck.reason, skipped: true },
            },
          });
          await prisma.campaignEnrollment.update({
            where: { id: enrollment.id },
            data: { currentStepPosition: currentStep.position },
          });
        });
        currentPosition = currentStep.position + 1;
        continue;
      }

      const sendResult = await step.run(`send-step-${currentStep.position}`, async () => {
        const bookingLink = `${process.env.NEXT_PUBLIC_URL || "http://localhost:3000"}/sales/scheduling?leadId=${lead.id}`;
        const variables = {
          firstName: lead.firstName || "",
          lastName: lead.lastName || "",
          email: lead.email || "",
          phone: lead.phone || "",
          city: lead.city || "",
          companyName: lead.company?.name || "",
          bookingLink,
        };

        const renderText = (templateText) => {
          if (!templateText) return "";
          return templateText
            .replace(/{firstName}/g, variables.firstName)
            .replace(/{lastName}/g, variables.lastName)
            .replace(/{email}/g, variables.email)
            .replace(/{phone}/g, variables.phone)
            .replace(/{city}/g, variables.city)
            .replace(/{companyName}/g, variables.companyName)
            .replace(/{bookingLink}/g, variables.bookingLink);
        };

        console.log(`[Nurture] Step type=${currentStep.type}, lead.email=${lead.email}, lead.phone=${lead.phone}`);

        if (currentStep.type === "EMAIL" && lead.email) {
          const subject = renderText(currentStep.subject || "Outreach Update");
          const body = renderText(currentStep.body || "");
          console.log(`[Nurture] Sending EMAIL to ${lead.email}, subject="${subject}"`);

          const formattedHtml = `
            <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #eaeaea;">
              <div style="background-color: #0F3B3D; padding: 30px 40px; text-align: center; border-bottom: 3px solid #b48c3c;">
                <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600; letter-spacing: 0.5px;">
                  ${lead.company?.name || "Warranty Care & Sales Portal"}
                </h1>
              </div>
              <div style="padding: 40px; color: #334155; line-height: 1.8; font-size: 16px;">
                ${body.replace(/\n/g, "<br />")}
              </div>
            </div>
            <div style="text-align: center; margin-top: 20px;">
              <span style="font-family: sans-serif; font-size: 11px; color: #94a3b8;">
                Powered by AI4Home Warranty Care
              </span>
            </div>
          `;

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
            return { channel: "SMS", attempted: true, success: false, error: smsError.message || "Unknown error", body: finalBody };
          }
        }
        return { channel: currentStep.type, attempted: false };
      });

      await step.run(`record-step-${currentStep.position}`, async () => {
        if (sendResult.attempted && sendResult.channel === "EMAIL") {
          await prisma.leadTimeline.create({
            data: sendResult.success
              ? {
                leadId: lead.id,
                type: "EMAIL_SENT",
                description: `Sent campaign email: "${sendResult.subject}"`,
                metadata: { subject: sendResult.subject, body: sendResult.body, campaignId: campaign.id, stepPosition: currentStep.position, messageId: sendResult.messageId },
              }
              : {
                leadId: lead.id,
                type: "EMAIL_FAILED",
                description: `Failed to send campaign email: ${sendResult.error}`,
                metadata: { subject: sendResult.subject, body: sendResult.body, campaignId: campaign.id, stepPosition: currentStep.position, error: sendResult.error },
              },
          });

          if (sendResult.success) {
            await prisma.campaignStep.update({
              where: { id: currentStep.id },
              data: { sentCount: { increment: 1 } }
            });
          }
        } else if (sendResult.attempted && sendResult.channel === "SMS") {
          await prisma.leadTimeline.create({
            data: sendResult.success
              ? {
                leadId: lead.id,
                type: "SMS_SENT",
                description: `Sent campaign SMS: "${sendResult.body.slice(0, 50)}${sendResult.body.length > 50 ? "..." : ""}"`,
                metadata: { body: sendResult.body, campaignId: campaign.id, stepPosition: currentStep.position },
              }
              : {
                leadId: lead.id,
                type: "SMS_FAILED",
                description: `Failed to send campaign SMS: ${sendResult.error}`,
                metadata: { body: sendResult.body, error: sendResult.error, campaignId: campaign.id, stepPosition: currentStep.position },
              },
          });

          if (sendResult.success) {
            await prisma.campaignStep.update({
              where: { id: currentStep.id },
              data: { sentCount: { increment: 1 } }
            });
          }
        } else {
          console.log(`[Nurture] Step ${currentStep.position}: no ${currentStep.type} contact channel on lead; nothing sent.`);
        }

        await prisma.campaignEnrollment.update({
          where: { id: enrollment.id },
          data: { currentStepPosition: currentStep.position },
        });
      });

      currentPosition = currentStep.position + 1;
    }

    // Finished all steps
    console.log(`[Nurture] All steps processed. Completing campaign.`);
    await step.run(`complete-campaign-${campaignId}-${enrollment.id}`, async () => {
      await prisma.campaignEnrollment.update({
        where: { id: enrollment.id },
        data: { status: "COMPLETED" },
      });

      await prisma.leadTimeline.create({
        data: {
          leadId,
          type: "SYNC_UPDATE",
          description: `Completed nurture campaign: "${campaign.name}"`,
          metadata: { campaignId: campaign.id }
        },
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

function shouldExitCampaign(reason, exitConditions, newStatus) {
  const cfg = exitConditions || {};
  switch (reason) {
    case "REPLY":
      return cfg.onReply !== false;
    case "APPOINTMENT":
      // Hardcoded rule: a lead always exits its campaign once it books an
      // appointment — this is not tenant-configurable.
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

        if (reason === "REPLY" && enrollment.currentStepPosition > 0) {
          const stepRow = await prisma.campaignStep.findFirst({
            where: { campaignId: enrollment.campaignId, position: enrollment.currentStepPosition },
          });
          if (stepRow) {
            await prisma.campaignStep.update({
              where: { id: stepRow.id },
              data: { repliedCount: { increment: 1 } },
            });
          }
        }

        await prisma.leadTimeline.create({
          data: {
            leadId,
            type: "SYNC_UPDATE",
            description: `Exited campaign "${enrollment.campaign.name}". Reason: ${reason}`,
            metadata: { campaignId: enrollment.campaignId }
          },
        });

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
