import prisma from "../lib/prisma.js";
import { getLeadTimezone } from "../lib/timezone.js";

export class ComplianceService {

  static checkSendingHours(timeZone, startHour = 8, endHour = 21) {
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        hour12: false,
      });
      const hour = parseInt(formatter.format(new Date()), 10) % 24;
      const start = Math.min(24, Math.max(0, startHour));
      const end = Math.min(24, Math.max(0, endHour));
      return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
    } catch (error) {
      console.error(
        `[Compliance Service] Timezone check failed for ${timeZone}:`,
        error
      );
      return true;
    }
  }

  static async validateOutboundMessage(leadId, channel) {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: { company: true },
    });

    if (!lead) {
      return { allowed: false, reason: "Lead not found" };
    }

    const { company } = lead;
    const value = channel === "EMAIL" ? lead.email : lead.phone;

    if (!value) {
      return {
        allowed: false,
        reason: `Lead lacks contact details for channel ${channel}`,
      };
    }

    const normalizedValue =
      channel === "EMAIL"
        ? value.trim().toLowerCase()
        : value.replace(/\D/g, "");

    // 1. Check suppression list
    const suppressed = await prisma.suppressionList.findFirst({
      where: {
        companyId: lead.companyId,
        value: {
          equals: normalizedValue,
          mode: "insensitive",
        },
      },
    });

    if (suppressed) {
      return {
        allowed: false,
        reason: `Contact is on the suppression list (Reason: ${suppressed.reason})`,
      };
    }

    // 2. Check consent flags
    if (company.complianceOptInRequired) {
      if (channel === "SMS" && !lead.smsOptIn) {
        return {
          allowed: false,
          reason: "Explicit SMS consent is required and not granted",
        };
      }
      if (channel === "EMAIL" && lead.emailOptIn === false) {
        return {
          allowed: false,
          reason: "Explicit email consent was revoked (Opt-out)",
        };
      }
    } else {
      if (channel === "SMS" && lead.smsOptIn === false) {
        return { allowed: false, reason: "SMS communications are opted out" };
      }
      if (channel === "EMAIL" && lead.emailOptIn === false) {
        return { allowed: false, reason: "Email communications are opted out" };
      }
    }

    if (channel === "SMS" && company.smsQuietHoursEnabled !== false) {
      const start = company.quietHoursStart ?? 8;
      const end = company.quietHoursEnd ?? 21;
      const tz = company.quietHoursTimezone || getLeadTimezone(lead.state, lead.phone);
      const isWithinHours = this.checkSendingHours(tz, start, end);
      if (!isWithinHours) {
        const fmt = (h) => `${String(h % 24).padStart(2, "0")}:00`;
        return {
          allowed: false,
          reason: `Quiet Hours active in timezone (${tz}). Sending allowed between ${fmt(start)} and ${fmt(end)}.`,
        };
      }
    }

    return { allowed: true };
  }

  static async handleInboundKeyword(companyId, senderContact, messageText, channel) {
    const text = messageText.trim().toUpperCase();
    const isSms = channel === "SMS";

    const stopKeywords = ["STOP", "UNSUBSCRIBE", "QUIT", "CANCEL", "END"];
    const startKeywords = ["START", "YES", "UNSTOP", "RESUBSCRIBE"];
    const helpKeywords = ["HELP", "INFO"];

    const normalizedContact = isSms
      ? senderContact.replace(/\D/g, "")
      : senderContact.trim().toLowerCase();

    // Find the lead(s) for this company matching the contact info
    const leads = await prisma.lead.findMany({
      where: {
        companyId,
        OR: [
          { email: normalizedContact },
          { phone: { contains: normalizedContact.slice(-10) } }, // match last 10 digits
        ],
      },
    });

    if (leads.length === 0) {
      return { isComplianceAction: false };
    }

    if (stopKeywords.includes(text)) {
      // 1. Opt-out
      for (const lead of leads) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            smsOptIn: isSms ? false : lead.smsOptIn,
            emailOptIn: !isSms ? false : lead.emailOptIn,
            consentSource: isSms
              ? "SMS STOP Keyword"
              : "Email Unsubscribe Request",
            consentTimestamp: new Date(),
            timeline: {
              create: {
                type: "CONSENT_CHANGE",
                description: `Opted-out of ${channel} communications via ${text} keyword.`,
              },
            },
          },
        });
      }

      // Add to suppression list
      await prisma.suppressionList.upsert({
        where: {
          companyId_value: {
            companyId,
            value: normalizedContact,
          },
        },
        create: {
          companyId,
          value: normalizedContact,
          reason: "UNSUBSCRIBE",
        },
        update: {
          reason: "UNSUBSCRIBE",
        },
      });

      return {
        isComplianceAction: true,
        replyText: isSms
          ? "You have successfully been unsubscribed. You will receive no further SMS alerts from this number. Reply START to resubscribe."
          : "You have been unsubscribed from all marketing emails.",
      };
    }

    if (startKeywords.includes(text) && isSms) {
      for (const lead of leads) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            smsOptIn: true,
            consentSource: "SMS START Keyword",
            consentTimestamp: new Date(),
            timeline: {
              create: {
                type: "CONSENT_CHANGE",
                description: `Resubscribed to SMS communications via ${text} keyword.`,
              },
            },
          },
        });
      }

      try {
        await prisma.suppressionList.delete({
          where: {
            companyId_value: {
              companyId,
              value: normalizedContact,
            },
          },
        });
      } catch {
      }

      return {
        isComplianceAction: true,
        replyText:
          "You have successfully resubscribed to SMS alerts. Standard message & data rates may apply. Reply STOP to opt out.",
      };
    }

    if (helpKeywords.includes(text) && isSms) {
      return {
        isComplianceAction: true,
        replyText:
          "Aiforhomebuilder Marketing Hub: For client assistance, reply to this thread. Msg & data rates may apply. Reply STOP to cancel.",
      };
    }

    return { isComplianceAction: false };
  }

  static addEmailUnsubscribeFooter(htmlContent, unsubscribeUrl, companyName) {
    const footerHtml = `
      <div style="margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 15px; font-size: 11px; color: #718096; text-align: center; line-height: 1.5;">
        <p>This email was sent by <strong>${companyName}</strong>.</p>
        <p>If you no longer wish to receive these emails, you can <a href="${unsubscribeUrl}" style="color: #b48c3c; text-decoration: underline;">unsubscribe here</a> at any time.</p>
        <p>&copy; 2026 ${companyName}. All rights reserved.</p>
      </div>
    `;
    if (htmlContent.includes("</body>")) {
      return htmlContent.replace("</body>", `${footerHtml}</body>`);
    }
    return `${htmlContent}${footerHtml}`;
  }

  static addSmsOptOutSuffix(body) {
    const suffix = " Reply STOP to opt out.";
    if (body.toLowerCase().includes("reply stop")) {
      return body;
    }
    return `${body}${suffix}`;
  }

  static normalizeContact(channel, value) {
    if (!value) return "";
    return channel === "EMAIL"
      ? value.trim().toLowerCase()
      : value.replace(/\D/g, "");
  }

  static async checkSuppression(companyId, channel, value) {
    const normalizedValue = this.normalizeContact(channel, value);
    if (!companyId || !normalizedValue) return { suppressed: false };

    const match =
      channel === "EMAIL"
        ? await prisma.suppressionList.findFirst({
          where: {
            companyId,
            value: { equals: normalizedValue, mode: "insensitive" },
          },
        })
        : await prisma.suppressionList.findFirst({
          where: { companyId, value: { contains: normalizedValue.slice(-10) } },
        });

    return match
      ? { suppressed: true, reason: match.reason }
      : { suppressed: false };
  }

  static mapEventCategory(rawEventType) {
    const map = {
      delivered: "DELIVERED",
      delivery: "DELIVERED",
      opened: "OPENED",
      unique_opened: "OPENED",
      open: "OPENED",
      click: "CLICKED",
      clicks: "CLICKED",
      proxy_open: "OPENED",
      hard_bounce: "BOUNCED",
      invalid_email: "BOUNCED",
      blocked: "BOUNCED",
      soft_bounce: "SOFT_BOUNCE",
      deferred: "SOFT_BOUNCE",
      spam: "COMPLAINED",
      complaint: "COMPLAINED",
      unsubscribed: "UNSUBSCRIBED",
      unsubscribe: "UNSUBSCRIBED",
      failed: "FAILED",
      undelivered: "FAILED",
      sent: "IGNORE",
      request: "IGNORE",
      queued: "IGNORE",
      sending: "IGNORE",
      accepted: "IGNORE",
    };
    return map[(rawEventType || "").toLowerCase()] || null;
  }


  static async suppressAndOptOut({ companyId, channel, normalizedValue, reason, sourceLabel }) {
    if (!companyId || !normalizedValue) return [];

    await prisma.suppressionList.upsert({
      where: { companyId_value: { companyId, value: normalizedValue } },
      create: { companyId, value: normalizedValue, reason },
      update: { reason },
    });

    const isEmail = channel === "EMAIL";
    const where = isEmail
      ? { companyId, email: normalizedValue }
      : { companyId, phone: { contains: normalizedValue.slice(-10) } };

    const leads = await prisma.lead.findMany({ where });

    const exitReason =
      reason === "COMPLAINT" ? "COMPLAINT" : reason === "BOUNCE" ? "BOUNCE" : "UNSUBSCRIBE";

    for (const lead of leads) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          ...(isEmail ? { emailOptIn: false } : { smsOptIn: false }),
          consentSource: sourceLabel,
          consentTimestamp: new Date(),
          timeline: {
            create: {
              type: "CONSENT_CHANGE",
              description: `Auto-suppressed (${reason}) from ${channel} via ${sourceLabel}.`,
            },
          },
        },
      });

      const { inngest } = await import("../lib/inngest.js");
      await inngest.send({
        name: "campaign.exit",
        data: { leadId: lead.id, reason: exitReason },
      });
    }

    return leads;
  }

  static async handleMessageEvent({
    companyId,
    channel,
    provider,
    contact,
    rawEventType,
    errorCode = null,
    metadata = {},
  }) {
    let category = this.mapEventCategory(rawEventType);



    if (!category || category === "IGNORE") {
      return { handled: false, category: null, leadsMatched: 0 };
    }

    const normalizedValue = this.normalizeContact(channel, contact);
    if (!normalizedValue) return { handled: false, category, leadsMatched: 0 };

    const where =
      channel === "EMAIL"
        ? { companyId, email: normalizedValue }
        : { companyId, phone: { contains: normalizedValue.slice(-10) } };
    const leads = await prisma.lead.findMany({ where });

    const typeMap = {
      DELIVERED: channel === "EMAIL" ? "EMAIL_DELIVERED" : "SMS_DELIVERED",
      OPENED: "EMAIL_OPENED",
      CLICKED: "EMAIL_CLICKED",
      SOFT_BOUNCE: channel === "EMAIL" ? "EMAIL_DEFERRED" : "SMS_DEFERRED",
      BOUNCED: channel === "EMAIL" ? "EMAIL_BOUNCED" : "SMS_FAILED",
      COMPLAINED: channel === "EMAIL" ? "EMAIL_COMPLAINED" : "SMS_COMPLAINED",
      FAILED: channel === "EMAIL" ? "EMAIL_FAILED" : "SMS_FAILED",
      UNSUBSCRIBED: channel === "EMAIL" ? "EMAIL_UNSUBSCRIBED" : "SMS_UNSUBSCRIBED",
    };
    const timelineType = typeMap[category] || "SYNC_UPDATE";
    for (const lead of leads) {
      await prisma.leadTimeline.create({
        data: {
          leadId: lead.id,
          type: timelineType,
          description: `${channel} ${category.toLowerCase()} event from ${provider}`,
          metadata: { ...metadata, provider, channel, category, rawEventType, contact, errorCode },
        },
      });
    }

    // Suppression-triggering categories.
    const sourceLabel = `${provider} ${rawEventType}${errorCode ? ` (${errorCode})` : ""}`;
    if (category === "BOUNCED") {
      await this.suppressAndOptOut({ companyId, channel, normalizedValue, reason: "BOUNCE", sourceLabel });
    } else if (category === "COMPLAINED") {
      await this.suppressAndOptOut({ companyId, channel, normalizedValue, reason: "COMPLAINT", sourceLabel });
      // NFR-O-001: re-evaluate the rolling complaint rate after every new complaint.
      await this.checkComplaintRate(companyId, channel);
    } else if (category === "UNSUBSCRIBED") {
      await this.suppressAndOptOut({ companyId, channel, normalizedValue, reason: "UNSUBSCRIBE", sourceLabel });
    }

    if (metadata.tag) {
      if (metadata.tag.startsWith("ann_")) {
        const annFieldMap = {
          DELIVERED: "deliveredCount",
          OPENED: "openedCount",
          CLICKED: "clickedCount",
          BOUNCED: "failedCount",
          FAILED: "failedCount",
          UNSUBSCRIBED: "unsubscribedCount",
        };
        const field = annFieldMap[category];
        if (field) {
          try {
            await prisma.announcement.update({
              where: { id: metadata.tag.slice(4) },
              data: { [field]: { increment: 1 } },
            });
          } catch (e) {
            // ignore if tag is not a valid Announcement ID
          }
        }
      } else {
        const metricFieldMap = {
          DELIVERED: "deliveredCount",
          OPENED: "openedCount",
          CLICKED: "clickedCount",
          BOUNCED: "bouncedCount",
          COMPLAINED: "complaintCount",
        };
        const field = metricFieldMap[category];
        if (field) {
          try {
            await prisma.campaignStep.update({
              where: { id: metadata.tag },
              data: { [field]: { increment: 1 } }
            });
          } catch (e) {
            // ignore if tag is not a valid CampaignStep ID
          }
        }
      }
    }

    return { handled: true, category, leadsMatched: leads.length };
  }

  static async checkComplaintRate(companyId, channel = "EMAIL") {
    const windowHours = parseInt(process.env.COMPLAINT_RATE_WINDOW_HOURS || "24", 10);
    const threshold = parseFloat(process.env.COMPLAINT_RATE_THRESHOLD || "0.001"); // 0.1%
    const minVolume = parseInt(process.env.COMPLAINT_RATE_MIN_VOLUME || "100", 10);
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    const sentType = channel === "EMAIL" ? "EMAIL_SENT" : "SMS_SENT";
    const complaintType = channel === "EMAIL" ? "EMAIL_COMPLAINED" : "SMS_COMPLAINED";

    const [sentCount, complaintCount] = await Promise.all([
      prisma.leadTimeline.count({
        where: { lead: { companyId }, type: sentType, createdAt: { gte: since } },
      }),
      prisma.leadTimeline.count({
        where: { lead: { companyId }, type: complaintType, createdAt: { gte: since } },
      }),
    ]);

    const rate = sentCount > 0 ? complaintCount / sentCount : 0;

    if (sentCount < minVolume) {
      return { alerted: false, rate, sentCount, complaintCount, reason: "below-min-volume" };
    }

    if (rate > threshold) {
      console.error(
        `[Compliance ALERT][NFR-O-001] Complaint rate ${(rate * 100).toFixed(3)}% exceeds ` +
        `threshold ${(threshold * 100).toFixed(3)}% for company ${companyId} ` +
        `(${complaintCount} complaints / ${sentCount} ${channel} sent in last ${windowHours}h).`
      );
      await this.sendComplaintRateAlert(companyId, {
        rate,
        threshold,
        complaintCount,
        sentCount,
        windowHours,
        channel,
      });
      return { alerted: true, rate, sentCount, complaintCount };
    }

    return { alerted: false, rate, sentCount, complaintCount };
  }

  static async sendComplaintRateAlert(companyId, metrics) {
    const to = process.env.COMPLIANCE_ALERT_EMAIL;
    if (!to) return;

    try {
      const company = await prisma.company.findUnique({ where: { id: companyId } });
      const { MailService } = await import("./mail-service.js");
      const ratePct = (metrics.rate * 100).toFixed(3);
      const thresholdPct = (metrics.threshold * 100).toFixed(3);

      await MailService.sendEmail({
        to,
        subject: `[ALERT] High ${metrics.channel} complaint rate (${ratePct}%) — ${company?.name || companyId}`,
        html: `
          <div style="font-family: sans-serif; line-height: 1.6;">
            <h2 style="color: #b91c1c;">Complaint-rate threshold exceeded (NFR-O-001)</h2>
            <p><strong>Company:</strong> ${company?.name || "(unknown)"} (${companyId})</p>
            <p><strong>Channel:</strong> ${metrics.channel}</p>
            <p><strong>Complaint rate:</strong> ${ratePct}% (threshold ${thresholdPct}%)</p>
            <p><strong>Volume:</strong> ${metrics.complaintCount} complaints / ${metrics.sentCount} sent in the last ${metrics.windowHours}h</p>
            <p>Review recent campaigns and sending lists. Affected contacts are auto-suppressed.</p>
          </div>
        `,
      });
    } catch (error) {
      console.error("[Compliance] Failed to send complaint-rate alert email:", error?.message || error);
    }
  }
}
