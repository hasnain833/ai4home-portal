import prisma from "../lib/prisma.js";
import { MessagingService } from "./messaging-service.js";
import { escapeHtml } from "../lib/utils.js";
import { appUrl, bookingLinkFor } from "../lib/b2b.js";

export function websiteInquiryEmails(inquiry) {
  const p = inquiry.payload;
  const website = new URL(process.env.WEBSITE_PUBLIC_URL || "https://www.aiforhomebuilders.com");
  const guide = new URL("/Website%20Assets/bookpdf/ai-for-homebuilders-guide.pdf", website).href;
  const details = Object.entries(p).filter(([, value]) => typeof value === "string" && value).map(([key, value]) => `<p><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value)}</p>`).join("");
  const admin = {
    to: process.env.SUPERADMIN_EMAIL,
    subject: `Website ${inquiry.type.toLowerCase()} inquiry: ${p.company || p.email}`,
    replyTo: p.email,
    html: `<h2>New AI4HB B2B website inquiry</h2>${details}<p>Marketing updates: ${p.marketingConsent ? "Requested" : "Not requested"}</p><p><a href="${escapeHtml(appUrl())}/admin/leads">Open Business Leads</a></p>`,
  };
  if (inquiry.type === "BOOKING") {
    const when = escapeHtml(p.label);
    const detailsHtml = details + '<p>Meeting confirmation email and SMS requested.</p>';
    return { admin: { ...admin, subject: 'New website demo booked: ' + p.company,
      html: '<h2>AI4HB demo confirmed</h2><p>' + when + '</p>' + detailsHtml + '<p><a href="' + escapeHtml(appUrl()) + '/admin/sales-agent-appointments">Open Appointments</a></p>' },
      visitor: { to: p.email, subject: 'Your AI for Homebuilders demo is confirmed', replyTo: process.env.SUPERADMIN_EMAIL,
        html: '<h2>Your demo is booked</h2><p>Hello ' + escapeHtml(p.name) + ',</p><p>Your meeting with the AI4HB team is confirmed for <strong>' + when + '</strong> (' + p.slotDuration + ' minutes).</p><p>We will contact you using the email or phone number you provided. Reply to this email to request a change.</p>' } };
  }
  let content = "<p>Your message has been received by the AI for Homebuilders team. We'll follow up with you.</p>";
  if (inquiry.type === "EBOOK") content = `<p>Here is your AI for Homebuilders guide:</p><p><a href="${escapeHtml(guide)}">Download the free ebook</a></p>`;
  if (inquiry.type === "DEMO") content = `<p>Your demo request is saved. Choose an available time using our booking page:</p><p><a href="${escapeHtml(bookingLinkFor(inquiry.lead))}">Schedule your AI4HB demo</a></p>`;
  return { admin, visitor: {
    to: p.email,
    subject: inquiry.type === "EBOOK" ? "Your AI for Homebuilders ebook" : inquiry.type === "DEMO" ? "Schedule your AI for Homebuilders demo" : "We received your AI4HB message",
    replyTo: process.env.SUPERADMIN_EMAIL,
    html: `<h2>AI for Homebuilders</h2><p>Hello ${escapeHtml(p.name || "there")},</p>${content}<p>${p.marketingConsent ? "You requested occasional updates. Your marketing preference is recorded separately from this request." : "This email relates to your request; you have not been subscribed to marketing by this submission."}</p>`,
  } };
}

export async function deliverWebsiteInquiry(id) {
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
      } catch { errors.push(`${kind}: Delivery failed`); }
    }
    if (inquiry.type === "BOOKING") {
      for (const kind of ["admin", "visitor"]) {
        const field = kind === "admin" ? "adminSmsSentAt" : "visitorSmsSentAt";
        if (inquiry[field]) continue;
        const p = inquiry.payload;
        const to = kind === "admin" ? process.env.SUPERADMIN_PHONE : p.phone;
        if (!to) { errors.push(kind + ": SMS recipient is not configured"); continue; }
        const body = kind === "admin" ? 'AI4Homebuilders demo booked: ' + p.name + ' (' + p.company + '), ' + p.label + '. Phone: ' + p.phone : 'Hi ' + p.name + ', your AI4Homebuilders demo is confirmed for ' + p.label + '. We will contact you at your provided email or phone.';
        try {
          const result = await MessagingService.sendSms({ companyId: null, to, body, source: "website-b2b-booking", tag: "website-b2b-booking", addOptOut: kind !== "admin" });
          if (result.outcome === "sent") await prisma.b2BInquiry.update({ where: { id }, data: { [field]: new Date() } });
          else errors.push(kind + ": SMS delivery failed (" + result.outcome + ")");
        } catch { errors.push(kind + ": SMS delivery failed"); }
      }
    }
  } catch {
    errors.push("Unable to process delivery; check platform email and URL configuration.");
  } finally {
    const attempts = (inquiry?.attempts || 0) + 1;
    await prisma.b2BInquiry.updateMany({ where: { id }, data: {
      processingUntil: null, attempts: { increment: 1 },
      nextAttemptAt: new Date(Date.now() + Math.min(360, 2 ** Math.min(attempts, 9)) * 60_000),
      lastError: errors.length ? errors.join("; ").slice(0, 1000) : null,
    } });
  }
  return { attempted: true, failed: errors.length > 0 };
}
