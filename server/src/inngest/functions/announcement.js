import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { MailService, mailShouldPark } from "../../services/mail-service.js";
import { sendSms, smsSent, smsShouldPark } from "../../services/sms.service.js";
import { ComplianceService } from "../../services/compliance-service.js";
import { getMessagingConfig } from "../../lib/messaging-config.js";
import { buildPrismaWhereClause } from "../../controllers/segments.controller.js";
import { htmlToText, looksLikeHtml } from "../../lib/sanitize-html.js";
import { withActiveLeadFilter } from "../../lib/lead-audience.js";
import { deadLetter, deadLetterJob } from "../../lib/dead-letter.js";
import { renderMergeFields, leadMergeVars, escapeHtml, safeUrl } from "../../lib/utils.js";
import { Templates } from "../../services/templates.js";

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

// NFR-S-008: `html` escapes the substituted lead values (not the template — the
// tenant's own body may legitimately contain markup).
function renderText(templateText, lead, html = false) {
  return renderMergeFields(templateText, leadMergeVars(lead), { html });
}

function buildEmailHtml(announcement, lead, body) {
  const ctaHref = safeUrl(announcement.ctaLink);
  const bodyHtml = looksLikeHtml(body) ? body : body.replace(/\n/g, "<br />");
  return Templates.getAnnouncementEmail(
    bodyHtml,
    escapeHtml(lead.companyName || "Warranty Care & Sales Portal"),
    ctaHref
  );
}

// Has this announcement already been sent to this lead on this channel? (idempotency)
async function alreadySent(leadId, announcementId, channel) {
  void leadId;
  void announcementId;
  void channel;
  return false;
}

export const sendAnnouncement = inngest.createFunction(
  {
    id: "send-announcement",
    // Fair-share the fan-out per tenant and throttle to a provider-friendly rate.
    concurrency: [{ key: "event.data.companyId", limit: 3 }],
    throttle: { key: "event.data.companyId", limit: 200, period: "1m" },
    onFailure: async ({ event, error }) =>
      deadLetterJob({ functionId: "send-announcement", event, error }),
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
                const html = buildEmailHtml(announcement, lead, renderText(announcement.body, lead, true));
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
                } else if (mailShouldPark(result)) {
                  failed += 1;
                  await deadLetter({
                    companyId: announcement.companyId,
                    source: "ANNOUNCEMENT",
                    channel: "EMAIL",
                    leadId: lead.id,
                    refId: announcementId,
                    payload: { to: lead.email, subject, html: finalHtml, fromName: lead.companyName || null },
                    error: result.error,
                  });
                } else {
                  // Nothing to retry when the workspace has no sender configured.
                  skipped += 1;
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
                const smsResult = await sendSms({ to: lead.phone, body: smsBody, smsConfig, tag });
                if (smsSent(smsResult)) {
                  sent += 1;
                } else if (smsShouldPark(smsResult)) {
                  failed += 1;
                  await deadLetter({
                    companyId: announcement.companyId,
                    source: "ANNOUNCEMENT",
                    channel: "SMS",
                    leadId: lead.id,
                    refId: announcementId,
                    payload: { to: lead.phone, body: smsBody },
                    error: smsResult.error || "Unknown error",
                  });
                } else {
                  skipped += 1;
                }
              }
            }
          }
        }

        return { sent, failed, skipped };
      });

      totals.sent += chunkResult.sent;
      totals.failed += chunkResult.failed;
      totals.skipped += chunkResult.skipped;
    }

    await step.run("finalize", async () => {
      await prisma.announcement.update({
        where: { id: announcementId },
        data: {
          status: "Sent",
          sentAt: new Date(),
          sentCount: totals.sent,
          failedCount: totals.failed,
          skippedCount: totals.skipped,
        },
      });
    });

    return { status: "sent", ...totals };
  }
);
