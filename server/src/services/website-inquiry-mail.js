import prisma from "../lib/prisma.js";
import { MessagingService } from "./messaging-service.js";
import { appUrl, bookingLinkFor } from "../lib/b2b.js";
import { Templates } from "./templates.js";

export function websiteInquiryEmails(inquiry) {
  return Templates.getWebsiteInquiryEmails(inquiry, {
    portalUrl: appUrl(),
    bookingLink: inquiry.type === "DEMO" ? bookingLinkFor(inquiry.lead) : null,
  });
}

export async function deliverWebsiteInquiry(id, { retrySms = false } = {}) {
  const now = new Date();
  const claim = await prisma.b2BInquiry.updateMany({
    where: { id, nextAttemptAt: { lte: now }, OR: [{ processingUntil: null }, { processingUntil: { lt: now } }] },
    data: { processingUntil: new Date(Date.now() + 5 * 60_000) },
  });
  if (!claim.count) return { skipped: true };
  let inquiry;
  const errors = [];
  try {
    inquiry = await prisma.b2BInquiry.findUnique({ where: { id }, include: { lead: true } });
    if (!inquiry) return { skipped: true };
    const messages = websiteInquiryEmails(inquiry);
    for (const [kind, message] of Object.entries(messages)) {
      const sentField = kind === "admin" ? "adminSentAt" : "visitorSentAt";
      if (inquiry[sentField]) continue;
      if (!message.to) { errors.push(`${kind}: SUPERADMIN_EMAIL is not configured`); continue; }
      try {
        const result = await MessagingService.sendEmail({ ...message, companyId: null, source: "b2b-website-inquiry" });
        if (result.success) await prisma.b2BInquiry.update({ where: { id }, data: { [sentField]: new Date() } });
        else errors.push(`${kind}: ${result.error || "Delivery failed"}`);
      } catch (error) { errors.push(`${kind}: ${error.message || "Delivery failed"}`); }
    }
    // SMS gets one initial attempt. Provider/destination failures must not
    // generate repeated texts from the scheduled email retry worker.
    if (["BOOKING", "CONSULTATION"].includes(inquiry.type) && (!inquiry.attempts || retrySms)) {
      for (const kind of ["admin", "visitor"]) {
        const field = kind === "admin" ? "adminSmsSentAt" : "visitorSmsSentAt";
        if (inquiry[field]) continue;
        const p = inquiry.payload;
        const to = kind === "admin" ? process.env.SUPERADMIN_PHONE : p.phone;
        if (!to) { errors.push(kind + ": SMS recipient is not configured"); continue; }
        const body = inquiry.type === 'CONSULTATION' ? (kind === 'admin' ? 'Product Consultation request: ' + p.name + ' (' + p.company + '), preferred ' + p.label + '. Pending team confirmation. Contact: ' + p.phone : 'Hi ' + p.name + ', AI4Homebuilders received your Product Consultation request for ' + p.label + '. This time is pending team confirmation.') : kind === "admin" ? 'AI4Homebuilders Product Consultation booked: ' + p.name + ' (' + p.company + '), ' + p.label + '. Phone: ' + p.phone : 'Hi ' + p.name + ', your AI4Homebuilders Product Consultation is confirmed for ' + p.label + '. We will contact you at your provided email or phone.';
        try {
          const result = await MessagingService.sendSms({ companyId: null, to, body, source: "website-b2b-booking", tag: "website-b2b-booking", addOptOut: kind !== "admin" });
          if (result.outcome === "sent") await prisma.b2BInquiry.update({ where: { id }, data: { [field]: new Date() } });
          else if (result.outcome !== "skipped") errors.push(kind + ": SMS " + result.outcome + ": " + (result.error || result.reason || "Delivery failed"));
        } catch (error) { errors.push(kind + ": SMS " + (error.message || "Delivery failed")); }
      }
    }
  } catch (error) {
    errors.push("Unable to process delivery: " + (error.message || "Check platform configuration."));
  } finally {
    const attempts = (inquiry?.attempts || 0) + 1;
    await prisma.b2BInquiry.updateMany({ where: { id }, data: {
      processingUntil: null, attempts: { increment: 1 },
      nextAttemptAt: new Date(Date.now() + Math.min(360, 2 ** Math.min(attempts, 9)) * 60_000),
      lastError: errors.length ? errors.join("; ").slice(0, 1000) : null,
    } });
  }
  console.info("[Website Notifications]", { inquiryId: id, attempts: (inquiry?.attempts || 0) + 1, errors });
  return { attempted: true, failed: errors.length > 0 };
}
