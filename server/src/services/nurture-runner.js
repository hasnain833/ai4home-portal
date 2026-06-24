import prisma from "../lib/prisma.js";
import { MailService } from "./mail-service.js";
import { sendSms } from "./sms.service.js";

export class NurtureRunner {
  static IS_RUNNING = false;

  static startWorker(intervalMs = 60000) {
    console.log(`[Nurture Runner] Starting background campaign worker (polling every ${intervalMs / 1000}s)`);
    setInterval(async () => {
      if (this.IS_RUNNING) return;
      this.IS_RUNNING = true;
      try {
        await this.processActiveEnrollments();
      } catch (error) {
        console.error("[Nurture Runner] Error in worker processing:", error);
      } finally {
        this.IS_RUNNING = false;
      }
    }, intervalMs);
  }

  static async processActiveEnrollments() {
    const now = new Date();

    // Fetch active enrollments whose execution time has passed
    const enrollments = await prisma.campaignEnrollment.findMany({
      where: {
        status: "ACTIVE",
        nextRunAt: {
          lte: now,
        },
        campaign: {
          status: "Active"
        }
      },
      include: {
        lead: {
          include: { company: true },
        },
        campaign: {
          include: { steps: true },
        },
      },
    });

    if (enrollments.length === 0) return;

    console.log(`[Nurture Runner] Processing ${enrollments.length} pending campaign steps...`);

    for (const enrollment of enrollments) {
      try {
        const { lead, campaign } = enrollment;

        // 1. Fetch the next step in the campaign
        const nextPosition = enrollment.currentStepPosition + 1;
        const currentStep = campaign.steps.find((s) => s.position === nextPosition);

        if (!currentStep) {
          // No more steps, complete the campaign
          await prisma.campaignEnrollment.update({
            where: { id: enrollment.id },
            data: {
              status: "COMPLETED",
            },
          });

          await this.checkCampaignCompletion(campaign.id);

          await prisma.leadTimeline.create({
            data: {
              leadId: lead.id,
              type: "SYNC_UPDATE",
              description: `Completed nurture campaign: "${campaign.name}"`,
            },
          });

          console.log(`[Nurture Runner] Lead ${lead.firstName} ${lead.lastName} finished campaign "${campaign.name}"`);
          continue;
        }

        // 2. Check Exit Conditions / Compliance
        let shouldExit = false;
        let exitReason = "";

        // Condition A: Lead opted out
        if (currentStep.type === "EMAIL" && lead.emailOptIn === false) {
          shouldExit = true;
          exitReason = "UNSUBSCRIBE";
        } else if (currentStep.type === "SMS" && lead.smsOptIn === false) {
          shouldExit = true;
          exitReason = "UNSUBSCRIBE";
        }

        // Condition B: Suppression List Check
        if (!shouldExit) {
          if (currentStep.type === "EMAIL" && lead.email) {
            const normalizedEmail = lead.email.trim().toLowerCase();
            const suppressed = await prisma.suppressionList.findFirst({
              where: {
                companyId: lead.companyId,
                value: normalizedEmail,
              },
            });
            if (suppressed) {
              shouldExit = true;
              exitReason = "SUPPRESSED";
            }
          } else if (currentStep.type === "SMS" && lead.phone) {
            const normalizedPhone = lead.phone.replace(/\D/g, "");
            const suppressed = await prisma.suppressionList.findFirst({
              where: {
                companyId: lead.companyId,
                value: normalizedPhone,
              },
            });
            if (suppressed) {
              shouldExit = true;
              exitReason = "SUPPRESSED";
            }
          }
        }

        // Condition C: Reply received since enrollment started
        if (!shouldExit) {
          const reply = await prisma.leadTimeline.findFirst({
            where: {
              leadId: lead.id,
              type: "REPLY_RECEIVED",
              createdAt: {
                gte: enrollment.createdAt,
              },
            },
          });
          if (reply) {
            shouldExit = true;
            exitReason = "REPLY";
          }
        }

        // Condition D: Appointment booked since enrollment started
        if (!shouldExit) {
          const appointment = await prisma.salesAppointment.findFirst({
            where: {
              leadId: lead.id,
              createdAt: {
                gte: enrollment.createdAt,
              },
            },
          });
          if (appointment) {
            shouldExit = true;
            exitReason = "APPOINTMENT";
          }
        }

        if (shouldExit) {
          await prisma.campaignEnrollment.update({
            where: { id: enrollment.id },
            data: {
              status: "EXITED",
              exitedReason: exitReason,
            },
          });

          await this.checkCampaignCompletion(campaign.id);

          await prisma.leadTimeline.create({
            data: {
              leadId: lead.id,
              type: "SYNC_UPDATE",
              description: `Exited campaign "${campaign.name}". Reason: ${exitReason}`,
            },
          });

          console.log(`[Nurture Runner] Lead ${lead.firstName} ${lead.lastName} exited campaign "${campaign.name}" due to ${exitReason}`);
          continue;
        }

        // 3. Process current step details
        const bookingLink = `${process.env.NEXT_PUBLIC_URL || "http://localhost:3000"}/sales/scheduling?leadId=${lead.id}`;
        const variables = {
          firstName: lead.firstName || "",
          lastName: lead.lastName || "",
          email: lead.email || "",
          phone: lead.phone || "",
          bookingLink,
        };

        const renderText = (templateText) => {
          if (!templateText) return "";
          return templateText
            .replace(/{firstName}/g, variables.firstName)
            .replace(/{lastName}/g, variables.lastName)
            .replace(/{email}/g, variables.email)
            .replace(/{phone}/g, variables.phone)
            .replace(/{bookingLink}/g, variables.bookingLink);
        };

        if (currentStep.type === "DELAY") {
          // If delay, calculate next execution time
          const nextTime = this.calculateDelayTime(
            currentStep.delayValue || 0,
            currentStep.delayUnit || "DAYS"
          );

          await prisma.campaignEnrollment.update({
            where: { id: enrollment.id },
            data: {
              currentStepPosition: nextPosition,
              nextRunAt: nextTime,
            },
          });

          console.log(
            `[Nurture Runner] Delay step processed. Lead scheduled for next run at: ${nextTime.toLocaleString()}`
          );
        } else if (currentStep.type === "EMAIL") {
          // Send Nurture Email
          if (lead.email) {
            const subject = renderText(currentStep.subject || "Outreach Update");
            const body = renderText(currentStep.body || "");

            const formattedHtml = `
              <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #eaeaea;">
                
                <!-- Header -->
                <div style="background-color: #0F3B3D; padding: 30px 40px; text-align: center; border-bottom: 3px solid #b48c3c;">
                  <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600; letter-spacing: 0.5px;">
                    ${lead.company?.name || "Warranty Care & Sales Portal"}
                  </h1>
                </div>

                <!-- Body -->
                <div style="padding: 40px; color: #334155; line-height: 1.8; font-size: 16px;">
                  ${body.replace(/\n/g, "<br />")}
                </div>

                <!-- Footer -->
                <div style="background-color: #f8fafc; padding: 30px 40px; text-align: center; border-top: 1px solid #e2e8f0;">
                  <p style="margin: 0 0 10px 0; font-size: 13px; color: #64748b; line-height: 1.5;">
                    This email was sent to <strong>${lead.email}</strong>.<br />
                    If you wish to update your communication preferences, you can securely opt out below.
                  </p>
                  <a href="${bookingLink}&unsubscribe=true" style="display: inline-block; margin-top: 10px; color: #b48c3c; font-size: 13px; font-weight: bold; text-decoration: none;">
                    Unsubscribe from notifications
                  </a>
                </div>
              </div>
              <div style="text-align: center; margin-top: 20px;">
                <span style="font-family: sans-serif; font-size: 11px; color: #94a3b8;">
                  Powered by AI4Home Warranty Care
                </span>
              </div>
            `;

            await MailService.sendEmail({
              to: lead.email,
              subject,
              html: formattedHtml,
              fromName: lead.company?.name || undefined,
              fromEmail: lead.company?.email || undefined,
            });

            await prisma.leadTimeline.create({
              data: {
                leadId: lead.id,
                type: "EMAIL_SENT",
                description: `Sent campaign email: "${subject}"`,
                metadata: { subject, body },
              },
            });
          }

          // Advance position and schedule next step
          await this.advanceAndScheduleNextStep(enrollment.id, nextPosition, campaign.steps);
        } else if (currentStep.type === "SMS") {
          // Send Nurture SMS via Twilio
          if (lead.phone) {
            const body = renderText(currentStep.body || "") + " Reply STOP to opt out.";
            
            let smsSuccess = false;
            let errorMessage = "";
            try {
              await sendSms({ to: lead.phone, body });
              smsSuccess = true;
            } catch (smsError) {
              errorMessage = smsError.message;
              console.error(`[Nurture Runner] SMS error for lead ${lead.phone}:`, errorMessage);
            }

            if (smsSuccess) {
              console.log(`[Nurture Runner] SMS sent to ${lead.phone}: "${body}"`);
              await prisma.leadTimeline.create({
                data: {
                  leadId: lead.id,
                  type: "SMS_SENT",
                  description: `Sent campaign SMS: "${body.slice(0, 50)}${body.length > 50 ? "..." : ""}"`,
                  metadata: { body },
                },
              });
            } else {
              await prisma.leadTimeline.create({
                data: {
                  leadId: lead.id,
                  type: "SMS_FAILED",
                  description: `Failed to send campaign SMS: ${errorMessage}`,
                  metadata: { body, error: errorMessage },
                },
              });
            }
          }

          // Advance position and schedule next step
          await this.advanceAndScheduleNextStep(enrollment.id, nextPosition, campaign.steps);
        }
      } catch (err) {
        console.error(`[Nurture Runner] Failed processing enrollment ${enrollment.id}:`, err);
      }
    }
  }

  static async advanceAndScheduleNextStep(enrollmentId, completedPosition, steps) {
    const nextPosition = completedPosition + 1;
    const nextStep = steps.find((s) => s.position === nextPosition);

    let nextRunAt = new Date(); // default: run immediately next minute

    if (nextStep && nextStep.type === "DELAY") {
      // If the subsequent step is a delay, apply it right now
      nextRunAt = this.calculateDelayTime(
        nextStep.delayValue || 0,
        nextStep.delayUnit || "DAYS"
      );
    }

    await prisma.campaignEnrollment.update({
      where: { id: enrollmentId },
      data: {
        currentStepPosition: completedPosition,
        nextRunAt,
      },
    });
  }

  static calculateDelayTime(value, unit) {
    const d = new Date();
    const cleanUnit = unit.toUpperCase();

    if (cleanUnit === "MINUTES" || cleanUnit === "MINUTE") {
      d.setMinutes(d.getMinutes() + value);
    } else if (cleanUnit === "HOURS" || cleanUnit === "HOUR") {
      d.setHours(d.getHours() + value);
    } else {
      // DEFAULT: Days
      d.setDate(d.getDate() + value);
    }
    return d;
  }

  static async checkCampaignCompletion(campaignId) {
    try {
      const activeCount = await prisma.campaignEnrollment.count({
        where: {
          campaignId,
          status: { in: ["ACTIVE", "PAUSED"] }
        }
      });

      if (activeCount === 0) {
        await prisma.campaign.update({
          where: { id: campaignId },
          data: { status: "Ready" }
        });
        console.log(`[Nurture Runner] Campaign ${campaignId} marked as Ready because all enrollments are finished.`);
      }
    } catch (error) {
      console.error(`[Nurture Runner] Error checking completion for campaign ${campaignId}:`, error);
    }
  }
}
