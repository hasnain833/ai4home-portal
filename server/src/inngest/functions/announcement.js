import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { MailService } from "../../services/mail-service.js";
import { sendSms } from "../../services/sms.service.js";
import { ComplianceService } from "../../services/compliance-service.js";
import { getMessagingConfig } from "../../lib/messaging-config.js";
import { buildPrismaWhereClause } from "../../controllers/segments.controller.js";
import { htmlToText, looksLikeHtml } from "../../lib/sanitize-html.js";
import { withActiveLeadFilter } from "../../lib/lead-audience.js";
import { deadLetter } from "../../lib/dead-letter.js";

const CHUNK_SIZE = 50;

function channelsFor(channel) {
  const c = (channel || "EMAIL").toUpperCase();
  return { email: c === "EMAIL" || c === "BOTH", sms: c === "SMS" || c === "BOTH" };
}
export async function resolveAnnouncementAudience(announcement) {
  const { email: wantEmail, sms: wantSms } = channelsFor(announcement.channel);

  const contactOr = [];
  if (wantEmail) contactOr.push({ email: { not: null } });
  if (wantSms) contactOr.push({ phone: { not: null } });

  let where = { companyId: announcement.companyId };

  if (announcement.audienceType === "SEGMENT" && announcement.segmentId) {
    const segment = await prisma.leadSegment.findFirst({
      where: { id: announcement.segmentId, companyId: announcement.companyId },
    });
    if (segment) {
      where = { ...buildPrismaWhereClause(segment.filters, announcement.companyId) };
    }
  }

  where = withActiveLeadFilter(where);

  const andParts = [...(where.AND || [])];
  if (contactOr.length) andParts.push({ OR: contactOr });
  const geo = announcement.geoFilter || {};
  const geoOr = [];
  if (Array.isArray(geo.states) && geo.states.length) geoOr.push({ state: { in: geo.states } });
  if (Array.isArray(geo.cities) && geo.cities.length) geoOr.push({ city: { in: geo.cities } });
  if (Array.isArray(geo.zips) && geo.zips.length) geoOr.push({ zipCode: { in: geo.zips } });
  if (geoOr.length) andParts.push({ OR: geoOr });

  if (andParts.length) where.AND = andParts;

  return prisma.lead.findMany({
    where,
    include: { company: true },
    orderBy: { createdAt: "asc" },
  });
}

function renderText(templateText, lead) {
  return (templateText || "")
    .replace(/{firstName}/g, lead.firstName || "")
    .replace(/{lastName}/g, lead.lastName || "")
    .replace(/{companyName}/g, lead.companyName || "")
    .replace(/{email}/g, lead.email || "");
}

function buildEmailHtml(announcement, lead, body) {
  const cta = announcement.ctaLink
    ? `<div style="text-align:center;margin-top:28px;">
         <a href="${announcement.ctaLink}" style="background-color:#b48c3c;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;display:inline-block;">Learn more</a>
       </div>`
    : "";
  return `
    <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 15px rgba(0,0,0,0.05);border:1px solid #eaeaea;">
      <div style="background-color:#0F3B3D;padding:30px 40px;text-align:center;border-bottom:3px solid #b48c3c;">
        <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:600;letter-spacing:0.5px;">${lead.companyName || "Warranty Care & Sales Portal"}</h1>
      </div>
      <div style="padding:40px;color:#334155;line-height:1.8;font-size:16px;">
        ${looksLikeHtml(body) ? body : body.replace(/\n/g, "<br />")}
        ${cta}
      </div>
    </div>`;
}

// Has this announcement already been sent to this lead on this channel? (idempotency)
async function alreadySent(leadId, announcementId, channel) {
  const type = channel === "SMS" ? "SMS_SENT" : "EMAIL_SENT";
  const hit = await prisma.leadTimeline.findFirst({
    where: { leadId, type, metadata: { path: ["announcementId"], equals: announcementId } },
  });
  return !!hit;
}

export const sendAnnouncement = inngest.createFunction(
  {
    id: "send-announcement",
    // Fair-share the fan-out per tenant and throttle to a provider-friendly rate.
    concurrency: [{ key: "event.data.companyId", limit: 3 }],
    throttle: { key: "event.data.companyId", limit: 200, period: "1m" },
    // SW-ANN-003: scheduled sends are cancelable until the batch pipeline starts.
    cancelOn: [{ event: "announcement.cancel", match: "data.announcementId" }],
    triggers: [{ event: "announcement.send" }],
  },
  async ({ event, step }) => {
    const { announcementId } = event.data;

    const announcement = await step.run("load-announcement", async () => {
      return prisma.announcement.findUnique({ where: { id: announcementId } });
    });

    if (!announcement) return { status: "skipped", reason: "Announcement not found" };
    if (["Sent", "Sending", "Cancelled"].includes(announcement.status)) {
      return { status: "skipped", reason: `Announcement already ${announcement.status}` };
    }

    // SW-ANN-003: hold scheduled sends until their time. cancelOn interrupts this sleep.
    if (announcement.scheduledAt && new Date(announcement.scheduledAt).getTime() > Date.now()) {
      await step.sleepUntil("wait-until-scheduled", new Date(announcement.scheduledAt));
    }

    const wants = channelsFor(announcement.channel);

    const audience = await step.run("snapshot-audience", async () => {
      const leads = await resolveAnnouncementAudience(announcement);
      await prisma.announcement.update({
        where: { id: announcementId },
        data: { status: "Sending", audienceCount: leads.length },
      });
      return leads.map((l) => ({
        id: l.id,
        firstName: l.firstName,
        lastName: l.lastName,
        email: l.email,
        phone: l.phone,
        companyId: l.companyId,
        companyName: l.company?.name || null,
      }));
    });

    const { smtpConfig, smsConfig } = await getMessagingConfig(announcement.companyId);
    const tag = `ann_${announcementId}`;

    const totals = { sent: 0, failed: 0, skipped: 0 };
    for (let i = 0; i < audience.length; i += CHUNK_SIZE) {
      const chunk = audience.slice(i, i + CHUNK_SIZE);
      const chunkResult = await step.run(`send-chunk-${i}`, async () => {
        let sent = 0;
        let failed = 0;
        let skipped = 0;

        for (const lead of chunk) {
          // ── EMAIL ──────────────────────────────────────────────────────────
          if (wants.email && lead.email) {
            if (await alreadySent(lead.id, announcementId, "EMAIL")) {
              skipped += 1;
            } else {
              const compliance = await ComplianceService.validateOutboundMessage(lead.id, "EMAIL");
              if (!compliance.allowed) {
                skipped += 1;
              } else {
                const subject = renderText(announcement.subject, lead) || announcement.title;
                const html = buildEmailHtml(announcement, lead, renderText(announcement.body, lead));
                const unsubscribeUrl = `${process.env.NEXT_PUBLIC_URL || "http://localhost:3000"}/unsubscribe/${lead.id}`;
                const finalHtml = ComplianceService.addEmailUnsubscribeFooter(
                  html,
                  unsubscribeUrl,
                  lead.companyName || "Warranty Care Portal"
                );
                const result = await MailService.sendEmail({
                  to: lead.email,
                  subject,
                  html: finalHtml,
                  fromName: lead.companyName || undefined,
                  smtpConfig,
                  headers: { "X-Mailin-Tag": tag },
                });
                if (result.success) {
                  sent += 1;
                  await prisma.leadTimeline.create({
                    data: {
                      leadId: lead.id,
                      type: "EMAIL_SENT",
                      description: `Received announcement: "${announcement.title}"`,
                      metadata: { announcementId, channel: "EMAIL", subject, messageId: result.messageId || null },
                    },
                  });
                } else {
                  failed += 1;
                  await prisma.leadTimeline.create({
                    data: {
                      leadId: lead.id,
                      type: "EMAIL_FAILED",
                      description: `Failed announcement email: ${result.error}`,
                      metadata: { announcementId, channel: "EMAIL", subject, error: result.error },
                    },
                  });
                  await deadLetter({
                    companyId: announcement.companyId,
                    source: "ANNOUNCEMENT",
                    channel: "EMAIL",
                    leadId: lead.id,
                    refId: announcementId,
                    payload: { to: lead.email, subject, html: finalHtml, fromName: lead.companyName || null },
                    error: result.error,
                  });
                }
              }
            }
          }

          if (wants.sms && lead.phone) {
            if (await alreadySent(lead.id, announcementId, "SMS")) {
              skipped += 1;
            } else {
              const compliance = await ComplianceService.validateOutboundMessage(lead.id, "SMS");
              if (!compliance.allowed) {
                skipped += 1;
              } else {
                // SMS is plain text — flatten any rich-text HTML from the editor.
                const rendered = renderText(announcement.body, lead);
                const base = looksLikeHtml(rendered) ? htmlToText(rendered) : rendered;
                const withCta = announcement.ctaLink ? `${base} ${announcement.ctaLink}` : base;
                const smsBody = ComplianceService.addSmsOptOutSuffix(withCta);
                try {
                  await sendSms({ to: lead.phone, body: smsBody, smsConfig, tag });
                  sent += 1;
                  await prisma.leadTimeline.create({
                    data: {
                      leadId: lead.id,
                      type: "SMS_SENT",
                      description: `Received announcement (SMS): "${announcement.title}"`,
                      metadata: { announcementId, channel: "SMS" },
                    },
                  });
                } catch (smsError) {
                  failed += 1;
                  await prisma.leadTimeline.create({
                    data: {
                      leadId: lead.id,
                      type: "SMS_FAILED",
                      description: `Failed announcement SMS: ${smsError.message || "Unknown error"}`,
                      metadata: { announcementId, channel: "SMS", error: smsError.message || "Unknown error" },
                    },
                  });
                  // SW-ANN-002: park the failed SMS for inspection/replay.
                  await deadLetter({
                    companyId: announcement.companyId,
                    source: "ANNOUNCEMENT",
                    channel: "SMS",
                    leadId: lead.id,
                    refId: announcementId,
                    payload: { to: lead.phone, body: smsBody },
                    error: smsError.message || "Unknown error",
                  });
                }
              }
            }
          }
        }

        // Persist running metrics per chunk for near-real-time reporting (SW-ANN-005).
        await prisma.announcement.update({
          where: { id: announcementId },
          data: { sentCount: { increment: sent }, failedCount: { increment: failed } },
        });

        return { sent, failed, skipped };
      });

      totals.sent += chunkResult.sent;
      totals.failed += chunkResult.failed;
      totals.skipped += chunkResult.skipped;
    }

    await step.run("finalize", async () => {
      await prisma.announcement.update({
        where: { id: announcementId },
        data: { status: "Sent", sentAt: new Date() },
      });
    });

    return { status: "sent", ...totals };
  }
);
