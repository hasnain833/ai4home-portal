import { priorityLabel } from "../lib/warranty-classify.js";
import { escapeHtml } from "../lib/utils.js";
import { ticketRef as formatTicketRef } from "../lib/ticket-number.js";

const COLORS = {
  primary: "#0F3B3D",
  accent: "#b48c3c",
  bgLight: "#f8f9fa",
  bgDark: "#f4f4f4",
  textMain: "#334155",
  textMuted: "#666666",
  border: "#eaeaea"
};

// Platform security and operational notices may carry a tenant ID for metering.
const PLATFORM_EMAIL_SOURCES = new Set([
  "email-change", "email-change-notice", "signup-verification", "new-tenant-alert",
  "verification-submitted", "workspace-activated", "sync-alert", "opt-out-confirmation",
]);
const decodeEmailUrl = (value) => String(value).replace(/&amp;/gi, "&").replace(/&#0*38;/g, "&").replace(/&#x0*26;/gi, "&");

function bookingAction(value) {
  try {
    const url = new URL(decodeEmailUrl(value));
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    if (/^\/(?:book|meet|schedule)\/[^/]+/i.test(url.pathname)) {
      return /\/(?:book|schedule)\/manage\//i.test(url.pathname) ? "Change or cancel appointment" : "Book an appointment";
    }
    if (/(^|\.)calendly\.com$/i.test(url.hostname)) return "Book an appointment";
  } catch { /* Not a booking URL. */ }
  return null;
}

const bookingButtonStyle = "display:inline-block;background-color:#b48c3c;color:#ffffff;padding:14px 24px;text-decoration:none;border-radius:6px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:600;line-height:1.4;margin:8px 0;";

// Keep text nodes separate from tags, styles and anchors to avoid nested links.
export function bookingButtonsInEmail(html) {
  return String(html || "").replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<a\b[^>]*>[\s\S]*?<\/a\s*>|<[^>]*>|[^<]+/gi, (part) => {
    if (/^<a\b/i.test(part)) {
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(part);
      const target = href && (href[1] ?? href[2] ?? href[3]);
      const label = target && bookingAction(target);
      if (!label) return part;
      const text = part.replace(/^<a\b[^>]*>/i, "").replace(/<\/a\s*>$/i, "");
      const visible = text.replace(/<[^>]+>/g, "").trim();
      if (/\bstyle\s*=\s*(["'])[^"']*(?:background|padding)/i.test(part) && !/^https?:\/\//i.test(visible)) return part;
      return `<a href="${escapeHtml(decodeEmailUrl(target))}" style="${bookingButtonStyle}">${/^https?:\/\//i.test(visible) || !visible ? label : text}</a>`;
    }
    if (part.startsWith("<")) return part;
    return part.replace(/https?:\/\/(?:(?!&(?:lt|gt|quot|apos|#0*39|#x0*27);)[^\s<>"'])+/gi, (match) => {
      const url = match.replace(/[.,;!?)\]]+$/, "");
      const label = bookingAction(url);
      return label ? `<a href="${escapeHtml(decodeEmailUrl(url))}" style="${bookingButtonStyle}">${label}</a>${match.slice(url.length)}` : match;
    });
  });
}

/** Builder emails carry the builder's logo; platform emails, and builders with no logo, carry ours. */
export const isPlatformEmail = ({ companyId = null, source = null, branding } = {}) =>
  branding ? branding === "platform" : !companyId || PLATFORM_EMAIL_SOURCES.has(source);

/** `builder` is the sending company's { name, logo }, looked up by the caller for builder emails. */
export function prepareOutgoingEmail(html, { companyId = null, source = null, branding, builder = null } = {}) {
  const content = bookingButtonsInEmail(html);
  const strip = () => content.replaceAll("<!--ai4hb-logo-->", "");
  const builderLogo = !isPlatformEmail({ companyId, source, branding }) && /^https?:\/\//i.test(String(builder?.logo || "")) ? builder.logo : null;
  let logo;
  if (builderLogo) {
    // Already there (a retried send): don't add it twice.
    if (content.includes(builderLogo) || content.includes(escapeHtml(builderLogo))) return strip();
    // A fixed height keeps any logo shape tidy, Outlook included.
    logo = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" data-ai4hb-brand="builder"><tr><td align="center" style="padding:20px;background:#ffffff"><img src="${escapeHtml(builderLogo)}" height="72" alt="${escapeHtml(builder.name || "")}" style="display:block;border:0;height:72px;width:auto;max-width:240px"></td></tr></table>`;
  } else {
    if (/<img\b[^>]*\bsrc\s*=\s*["'](?:[^"']*\/logo-email\.png(?:[?"'])|cid:ai4hb-logo["'])/i.test(content)) return strip();
    const origin = new URL(process.env.NEXT_PUBLIC_URL || "http://localhost:3000").origin;
    logo = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" data-ai4hb-brand="platform"><tr><td align="center" style="padding:20px;background:#ffffff"><a href="https://www.aiforhomebuilders.com"><img src="${escapeHtml(origin)}/logo-email.png" width="210" height="162" alt="AI for Homebuilders" style="display:block;border:0;width:210px;max-width:100%;height:auto"></a></td></tr></table>`;
  }
  // Templates reserve a slot inside their card. Untemplated messages get the logo prepended.
  if (content.includes("<!--ai4hb-logo-->")) return content.replace("<!--ai4hb-logo-->", logo).replaceAll("<!--ai4hb-logo-->", "");
  if (/<body\b[^>]*>/i.test(content)) return content.replace(/<body\b[^>]*>/i, (body) => body + logo);
  return logo + content;
}

function wrapEmail(content, title, companyName = "Aiforhomebuilder", headerColor = COLORS.primary, { replyable = false } = {}) {
  const currentYear = new Date().getFullYear();
  const footerNote = replyable
    ? "You're messaging an automated assistant. Reply to this email and it will pick up the conversation."
    : "This is an automated message. Please do not reply directly to this email.";

  return `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid ${COLORS.border};">
      <!--ai4hb-logo-->
      <div style="background-color: ${headerColor}; padding: 30px 40px; text-align: center; border-bottom: 3px solid ${COLORS.accent};">
        <h1 style="margin: 0; font-size: 24px; color: white; font-weight: 600;">${title}</h1>
      </div>
      <div style="padding: 40px; color: ${COLORS.textMain}; line-height: 1.8; font-size: 16px;">
        ${content}
      </div>
      <div style="background-color: ${COLORS.bgDark}; padding: 24px; text-align: center; color: ${COLORS.textMuted}; font-size: 13px;">
        <p style="margin: 0;">&copy; ${currentYear} ${companyName}. All rights reserved.</p>
        <p style="margin: 8px 0 0 0; font-size: 11px;">${footerNote}</p>
      </div>
    </div>
  `;
}

function emailButton(url, text) {
  return `
    <div style="text-align: center; margin: 32px 0;">
      <a href="${url}" style="background-color: ${COLORS.accent}; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px; display: inline-block; letter-spacing: 0.5px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
        ${text}
      </a>
    </div>
  `;
}

function emailHighlightBox(content) {
  return `
    <div style="background-color: ${COLORS.bgLight}; border-left: 4px solid ${COLORS.accent}; padding: 16px 20px; margin: 24px 0; font-size: 18px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: ${COLORS.primary};">
      ${content}
    </div>
  `;
}

// Table layout and inline styles support Gmail, Outlook, and small screens.
function websiteEmail({ preheader, eyebrow, title, greeting, introduction, rows = [], status, nextSteps, action, website = "https://www.aiforhomebuilders.com" }) {
  const escape = (value) => escapeHtml(value ?? "");
  const safeWebsite = /^https?:\/\//i.test(website) ? website.replace(/\/$/, "") : "https://www.aiforhomebuilders.com";
  const detailRows = rows.filter(([, value]) => value !== undefined && value !== null && value !== "").map(([label, value]) => `<tr><td valign="top" style="padding:11px 12px;border-bottom:1px solid #e5e0d6;color:#586171;font-size:13px;width:36%;">${escape(label)}</td><td valign="top" style="padding:11px 12px;border-bottom:1px solid #e5e0d6;color:#142133;font-size:14px;font-weight:600;word-break:break-word;">${escape(value)}</td></tr>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(title)}</title></head>
<body style="margin:0;padding:0;background:#f1f3f5;font-family:Arial,Helvetica,sans-serif;color:#142133;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escape(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f3f5;"><tr><td align="center" style="padding:32px 12px;">
<!--[if mso]><table role="presentation" width="600"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e0e4e8;border-radius:12px;overflow:hidden;">
<tr><td style="background:#ffffff;border-top:4px solid #b9903d;border-bottom:1px solid #e5e8ec;"><!--ai4hb-logo--></td></tr>
<tr><td style="padding:30px 28px 12px;"><p style="margin:0 0 10px;color:#89651f;font-size:11px;font-weight:bold;letter-spacing:1.4px;text-transform:uppercase;">${escape(eyebrow)}</p><h1 style="margin:0 0 22px;color:#142133;font-family:Georgia,serif;font-size:29px;font-weight:normal;line-height:1.25;">${escape(title)}</h1><p style="margin:0 0 14px;font-size:15px;line-height:1.7;">${escape(greeting)}</p><p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#485365;">${escape(introduction)}</p>
${status ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#f7f1e5;border-left:3px solid #b9903d;padding:14px 16px;color:#665126;font-size:14px;line-height:1.6;">${escape(status)}</td></tr></table>` : ""}
${detailRows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;background:#faf9f6;border:1px solid #e5e0d6;">${detailRows}</table>` : ""}
<h2 style="margin:24px 0 9px;font-size:16px;line-height:1.4;">What happens next</h2><p style="margin:0 0 22px;font-size:14px;color:#485365;line-height:1.7;white-space:pre-line;">${escape(nextSteps)}</p>
${action && /^(https?:\/\/|mailto:)/i.test(action.href) ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td bgcolor="#142133" style="border-radius:6px;mso-padding-alt:14px 22px;"><a href="${escape(action.href)}" style="display:inline-block;padding:14px 22px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;line-height:1.4;">${escape(action.label)}</a></td></tr></table>` : ""}
<p style="margin:0 0 18px;color:#485365;font-size:14px;line-height:1.7;">Warm regards,<br><strong style="color:#142133;">The AI for Homebuilders team</strong></p></td></tr>
<tr><td style="padding:20px 28px;background:#f7f8fa;border-top:1px solid #e5e8ec;"><p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:#697383;">This service message relates to your request. Please contact our team if you have any questions.</p><p style="margin:0;font-size:12px;line-height:1.7;"><a href="${escape(safeWebsite)}" style="color:#526174;">Visit our website</a>&nbsp; · &nbsp;<a href="${escape(safeWebsite)}/contact" style="color:#526174;">Contact</a>&nbsp; · &nbsp;<a href="${escape(safeWebsite)}/privacy" style="color:#526174;">Privacy</a>&nbsp; · &nbsp;<a href="${escape(safeWebsite)}/terms" style="color:#526174;">Terms</a></p></td></tr>
</table><!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}

function websiteInquiryEmails(inquiry, { portalUrl, bookingLink }) {
  const p = inquiry.payload;
  const website = new URL(process.env.WEBSITE_PUBLIC_URL || "https://www.aiforhomebuilders.com").origin;
  const isRequest = inquiry.type === "CONSULTATION";
  const isBooking = inquiry.type === "BOOKING";
  const isMeeting = isRequest || isBooking;
  const label = isRequest ? "Product Consultation request" : isBooking ? "Product Consultation" : inquiry.type === "EBOOK" ? "Your AI for Homebuilders guide" : inquiry.type === "DEMO" ? "Product Consultation request" : "Your message to AI for Homebuilders";
  const rows = [["Name", p.name], ["Company", p.company], ["Email", p.email], ["Phone", p.phone], ["Role", p.role], ["Annual closings", p.annualClosings || p.homesPerYear], [isRequest ? "Preferred time" : "Meeting time", p.label], ["Discussion", p.notes || p.message || p.painPoint]];
  const status = isRequest ? "Pending team confirmation. Your preferred time has been recorded; an appointment has not yet been confirmed." : isBooking ? "Your appointment is confirmed for the time below." : null;
  const adminHref = portalUrl + (isMeeting ? "/admin/sales-agent-appointments" : "/admin/leads");
  const admin = {
    to: process.env.SUPERADMIN_EMAIL, fromName: "AI for Homebuilders", replyTo: p.email,
    subject: `${isRequest ? "New Product Consultation request" : isBooking ? "Product Consultation booked" : "New website " + inquiry.type.toLowerCase() + " inquiry"}: ${p.company || p.email}`,
    html: websiteEmail({ website, preheader: `${label} from ${p.name || p.email}. ${isRequest ? "Review their preferred time and confirm availability." : "View the details in your CRM."}`, eyebrow: "Website inquiry - Team notification", title: isRequest ? "A new consultation request" : isBooking ? "A consultation is booked" : "A new website inquiry", greeting: "Hello AI4HB team,", introduction: `${p.name || p.email}${p.company ? " from " + p.company : ""} ${isRequest ? "has requested a Product Consultation" : isBooking ? "has booked a Product Consultation" : inquiry.type === "EBOOK" ? "has requested the AI for Homebuilders guide" : "has submitted a website inquiry"}.`, status, rows, nextSteps: isRequest ? "Review the visitor's preferred time and contact them to agree the appointment. This request has not reserved a calendar slot. You can review the conversation and notification status in the CRM." : "Review the details in the CRM and follow up with the visitor as appropriate.", action: { href: adminHref, label: isMeeting ? "Review consultation" : "View business lead" } }),
  };
  let intro = "Thank you for contacting AI for Homebuilders. Your message has been received, and our team will review the details.";
  let next = "Our team will follow up using the contact details you provided. If you would like to add anything, simply reply to this email.";
  let action;
  if (isRequest) { intro = "Thank you for your interest in exploring how AI can support your building business. We have received your Product Consultation request."; next = "Our team will review your preferred time and contact you to confirm availability and arrange the conversation. If your plans change or you have more to share, reply to this email."; }
  if (isBooking) { intro = "Thank you for arranging a Product Consultation with AI for Homebuilders. We look forward to learning about your business and discussing the workflows that matter to your team."; next = "Our team will contact you using the details you provided. Bring any questions about your sales or warranty operations. To request a change, reply to this email."; }
  if (inquiry.type === "EBOOK") { intro = "Thank you for your interest in AI for Homebuilders. Your guide is ready to read."; next = "Use the button below to download your guide. If it raises questions about your own workflows, reply to this email and our team can help."; action = { href: new URL("/Website%20Assets/bookpdf/ai-for-homebuilders-guide.pdf", website).href, label: "Download your free guide" }; }
  if (inquiry.type === "DEMO") { intro = "Thank you for your interest in a Product Consultation. Your request has been received."; next = "Use the link below to continue arranging a conversation with our team."; action = { href: bookingLink, label: "Arrange your consultation" }; }
  action ||= { href: process.env.SUPERADMIN_EMAIL ? "mailto:" + process.env.SUPERADMIN_EMAIL : website + "/contact", label: "Contact our team" };
  return { admin, visitor: {
    to: p.email, fromName: "AI for Homebuilders", replyTo: process.env.SUPERADMIN_EMAIL,
    subject: isRequest ? "Your Product Consultation request - AI for Homebuilders" : isBooking ? "Your Product Consultation is confirmed - AI for Homebuilders" : label,
    html: websiteEmail({ website, preheader: isRequest ? "Your preferred time is recorded. Our team will confirm availability." : isBooking ? `Your consultation: ${p.label}. We look forward to speaking with you.` : label, eyebrow: "AI for Homebuilders - " + (isMeeting ? "Product Consultation" : "Resources & support"), title: isRequest ? "Let's explore what's possible." : isBooking ? "Your consultation is confirmed." : inquiry.type === "EBOOK" ? "Your guide is ready." : "Thank you for reaching out.", greeting: `Hello ${p.name || "there"},`, introduction: intro, status, rows: isMeeting ? rows.filter(([key, value]) => !["Role", "Annual closings"].includes(key) && value && !/^(?:not provided|n\/a|skipped)$/i.test(String(value).trim())) : [], nextSteps: next, action }),
  } };
}


export const Templates = {
  getWebsiteInquiryEmails: websiteInquiryEmails,

  getB2BMeetingConfirmationEmail: ({ name, companyName, label, duration, timezone, calendly = false, meetingLink, contactEmail }) => {
    const website = new URL(process.env.WEBSITE_PUBLIC_URL || "https://www.aiforhomebuilders.com").origin;
    const joinLink = !calendly && /^https:\/\//i.test(meetingLink || "") ? meetingLink : null;
    const contact = contactEmail ? { href: `mailto:${contactEmail}`, label: "Contact our team" } : { href: `${website}/contact`, label: "Contact our team" };
    const changeInstructions = contactEmail ? "Need to change your plans? Reply to this email and our team will help." : "Need to change your plans? Contact our team using the button below.";
    return websiteEmail({
      website,
      preheader: `Your Product Consultation is confirmed for ${label}.`,
      eyebrow: "AI for Homebuilders · Product Consultation",
      title: "You're on the calendar.",
      greeting: `Hello ${name || "there"},`,
      introduction: "Your Product Consultation with AI for Homebuilders is booked. We look forward to learning about your business and exploring how AI can support your team's sales and warranty workflows.",
      status: "Booking confirmed — your meeting time is reserved.",
      rows: [["Meeting", "Product Consultation"], ["When", label], ["Time zone", timezone], ["Duration", `${duration} minutes`], ["Company", companyName]],
      nextSteps: (calendly
        ? "Look out for a separate email from Calendly with your calendar invitation and joining details."
        : joinLink
          ? "A calendar invitation is attached. When it's time, use the Join meeting button below."
          : "A calendar invitation is attached. Our team will contact you using the email or phone number you provided.") + "\n\n" + changeInstructions,
      action: joinLink ? { href: joinLink, label: "Join meeting" } : contact,
    });
  },

  getB2BCampaignEmail: (bodyHtml, { bookingLink, unsubscribeLink, portalUrl, websiteUrl, bookingButton = true }) => {
    const site = escapeHtml(websiteUrl);
    const unsubscribe = escapeHtml(unsubscribeLink);
    const logo = escapeHtml(`${portalUrl}/logo-email.png`);
    const body = bookingButtonsInEmail(bodyHtml);
    const fallbackButton = !bookingButton || body.includes(`href="${escapeHtml(bookingLink)}"`) ? "" : emailButton(escapeHtml(bookingLink), "Book a Product Consultation");
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f1f3f5;font-family:Arial,Helvetica,sans-serif;color:#334155">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #e5e7eb;border-radius:10px">
<tr><td align="center" style="padding:20px;border-top:4px solid #b48c3c;border-bottom:1px solid #e5e7eb"><a href="${site}"><img src="${logo}" width="210" height="162" alt="AI for Homebuilders" style="display:block;border:0;width:210px;max-width:100%;height:auto"></a></td></tr>
<tr><td style="padding:28px 32px;font-size:15px;line-height:1.7">${body}${fallbackButton}<p style="margin:20px 0 0;color:#64748b;font-size:13px">Questions? Reply to this email and our team will help.</p></td></tr>
<tr><td align="center" style="padding:22px;background:#f8f9fa;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.8;color:#64748b"><p style="margin:0"><strong>AI for Homebuilders</strong><br><a href="${site}" style="color:#0f3b3d">Visit our website</a> &middot; <a href="${unsubscribe}" style="color:#0f3b3d">Unsubscribe</a></p><p style="margin:8px 0 0">&copy; ${new Date().getFullYear()} AI for Homebuilders. All rights reserved.</p></td></tr>
</table></td></tr></table></body></html>`;
  },

  getEmailChangeVerifyEmail: (name, oldEmail, newEmail, confirmUrl, hoursValid) => {
    const content = `
      <p>Hi ${name || "there"},</p>
      <p>A request was made to change the sign-in email on your account from
      <strong>${oldEmail}</strong> to <strong>${newEmail}</strong>.</p>
      <p>Confirm below and this address becomes the one you sign in with. Until you do,
      nothing changes and you keep signing in with your current address.</p>
      ${emailButton(confirmUrl, "Confirm this email address")}
      <p style="font-size: 14px; color: ${COLORS.textMuted};">This link expires in ${hoursValid} hours.
      If you did not request this, you can ignore this email — the change will not happen.</p>
    `;
    return wrapEmail(content, "Confirm your new email");
  },

  getEmailChangeNoticeEmail: (name, oldEmail, newEmail, hoursValid) => {
    const content = `
      <p>Hi ${name || "there"},</p>
      <p>Someone requested that the sign-in email on your account be changed from
      <strong>${oldEmail}</strong> to <strong>${newEmail}</strong>.</p>
      <p>This is a notice only — no action is needed if you made this request. The change
      takes effect only after it is confirmed from the new address, within ${hoursValid} hours.</p>
      ${emailHighlightBox("Did not request this?")}
      <p>Change your password immediately and contact your administrator. As long as the
      request is not confirmed, your current address stays in place.</p>
    `;
    return wrapEmail(content, "Sign-in email change requested");
  },

  getTicketUpdateEmail: (homeownerName, ticket, statusLabel, portalUrl, companyName) => {
    const ticketId = ticket.id;
    const ticketRef = formatTicketRef(ticket);
    const content = `
      <p style="margin-top: 0;">Hello <strong>${homeownerName}</strong>,</p>
      <p>The status of your warranty ticket <strong>${ticketRef}</strong> has been updated to:</p>
      ${emailHighlightBox(statusLabel)}
      <p>Our team is working to resolve this as quickly as possible. You can track the progress of your claim in the portal.</p>
      ${emailButton(`${portalUrl}/warranty/tickets/${ticketId}`, "View Ticket in Portal")}
    `;
    return wrapEmail(content, "Warranty Ticket Update", companyName, COLORS.accent);
  },


  getTicketCreatedHomeownerEmail: (homeownerName, ticket, issueType, portalUrl, companyName) => {
    const ticketId = ticket.id;
    const ticketRef = formatTicketRef(ticket);
    const content = `
      <p style="margin-top: 0;">Hello <strong>${homeownerName}</strong>,</p>
      <p>We've received your warranty request and opened ticket <strong>${ticketRef}</strong>.</p>
      ${emailHighlightBox(issueType)}
      <p>Our team will review it and be in touch. You can follow the progress of your claim in the portal at any time.</p>
      ${emailButton(`${portalUrl}/warranty/tickets/${ticketId}`, "View Ticket in Portal")}
    `;
    return wrapEmail(content, "Warranty Ticket Received", companyName, COLORS.accent);
  },

  getTicketCreatedAdminEmail: (ticket, issueType, priority, isEmergency, homeownerName, propertyAddress, portalUrl, companyName) => {
    const ticketId = ticket.id;
    const ticketRef = formatTicketRef(ticket);
    const urgencyNote = isEmergency
      ? `<p style="color: #b91c1c; font-weight: 600; margin-top: 0;">This ticket was flagged as an emergency and needs immediate attention.</p>`
      : "";
    const content = `
      ${urgencyNote}
      <p${isEmergency ? "" : ' style="margin-top: 0;"'}>A new warranty ticket has been filed and is waiting for review.</p>
      <table style="margin: 24px 0; font-size: 15px; color: ${COLORS.textMain}; width: 100%; border-collapse: collapse;">
        <tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600; width: 120px;">Ticket</td><td style="padding: 12px 0;">${ticketRef}</td></tr>
        <tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600;">Issue</td><td style="padding: 12px 0;">${issueType}</td></tr>
        <tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600;">Priority</td><td style="padding: 12px 0;">${priorityLabel(priority)}</td></tr>
        <tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600;">Homeowner</td><td style="padding: 12px 0;">${homeownerName}</td></tr>
        <tr><td style="padding: 12px 12px 12px 0; font-weight: 600;">Property</td><td style="padding: 12px 0;">${propertyAddress || "Not specified"}</td></tr>
      </table>
      ${emailButton(`${portalUrl}/warranty/tickets/${ticketId}`, "Open Ticket")}
    `;
    return wrapEmail(content, "New Warranty Ticket", companyName, COLORS.primary);
  },

  getSalesAppointmentAdminEmail: (kind, details, portalUrl, companyName) => {
    const esc = (v) =>
      String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const heading = {
      BOOKED: "New Sales Appointment",
      ASSIGNED: "Sales Appointment Assigned",
      RESCHEDULED: "Sales Appointment Rescheduled",
      CANCELLED: "Sales Appointment Cancelled",
    }[kind] || "Sales Appointment Update";
    const intro = {
      BOOKED: "A new sales appointment has been booked.",
      ASSIGNED: "A sales appointment has been assigned to you.",
      RESCHEDULED: "A sales appointment has been moved to a new time.",
      CANCELLED: "A sales appointment has been cancelled.",
    }[kind] || "A sales appointment has changed.";
    const row = (label, value, last = false) =>
      value
        ? `<tr${last ? "" : ` style="border-bottom: 1px solid ${COLORS.border};"`}><td style="padding: 12px 12px 12px 0; font-weight: 600; width: 130px;">${label}</td><td style="padding: 12px 0;">${value}</td></tr>`
        : "";
    const rows = [
      row("Lead", esc(details.leadName)),
      row("Contact", esc(details.contact)),
      row("Appointment", esc(details.title)),
      row(kind === "CANCELLED" ? "Was" : "When", esc(details.when)),
      row("Previously", kind === "RESCHEDULED" ? esc(details.previousWhen) : ""),
      row("Type", details.locationType === "ONSITE" ? "On site" : "Virtual"),
      row("Notes", esc(details.notes).replace(/\n/g, "<br>")),
      row("Booked via", esc(details.bookedVia), true),
    ].join("");
    const content = `
      <p style="margin-top: 0;">${intro}</p>
      <table style="margin: 24px 0; font-size: 15px; color: ${COLORS.textMain}; width: 100%; border-collapse: collapse;">${rows}</table>
      ${emailButton(`${portalUrl}/sales/scheduling`, "Open Appointments")}
    `;
    return wrapEmail(content, heading, companyName, COLORS.primary);
  },

  getTicketReminderEmail: (ticket, issueType, priority, isEmergency, homeownerName, ageLabel, portalUrl, companyName) => {
    const ticketId = ticket.id;
    const ticketRef = formatTicketRef(ticket);
    const lead = isEmergency
      ? `This <strong>emergency</strong> ticket has been open for ${ageLabel} and has not been actioned yet.`
      : `This ticket has been open for ${ageLabel} and has not been actioned yet.`;
    const content = `
      <p style="margin-top: 0;">${lead}</p>
      <table style="margin: 24px 0; font-size: 15px; color: ${COLORS.textMain}; width: 100%; border-collapse: collapse;">
        <tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600; width: 120px;">Ticket</td><td style="padding: 12px 0;">${ticketRef}</td></tr>
        <tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600;">Issue</td><td style="padding: 12px 0;">${issueType}</td></tr>
        <tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600;">Priority</td><td style="padding: 12px 0;">${priorityLabel(priority)}</td></tr>
        <tr><td style="padding: 12px 12px 12px 0; font-weight: 600;">Homeowner</td><td style="padding: 12px 0;">${homeownerName}</td></tr>
      </table>
      <p>Moving it out of <strong>Open</strong> stops these reminders.</p>
      ${emailButton(`${portalUrl}/warranty/tickets/${ticketId}`, "Review Ticket")}
    `;
    return wrapEmail(content, "Ticket Awaiting Action", companyName, isEmergency ? "#b91c1c" : COLORS.primary);
  },

  getTicketDispatchStaffEmail: (
    { ticketId, ticketRef, issueType, ticketCategory, description, priority, warrantyYear, whenLabel,
      durationMinutes, address, homeownerName, homeownerEmail, notes, staffName },
    portalUrl,
    companyName,
    { rescheduled = false } = {},
  ) => {
    const rows = [
      ["When", `${whenLabel}${durationMinutes ? ` (${durationMinutes} min)` : ""}`],
      ...(staffName ? [] : [["Assigned to", "No one yet"]]),
      ["Property", address || "Not specified"],
      ["Homeowner", homeownerEmail ? `${homeownerName} &mdash; ${homeownerEmail}` : homeownerName],
      ["Ticket", `${ticketRef}`],
      ["Issue", issueType],
      ...(ticketCategory ? [["Source", ticketCategory]] : []),
      ["Priority", priorityLabel(priority || "MEDIUM")],
      ["Warranty year", `Year ${warrantyYear ?? 1}`],
    ];
    const content = `
      <p style="margin-top: 0;">${
        rescheduled
          ? `The visit for ticket <strong>${ticketRef}</strong> has been moved.`
          : staffName
            ? `You have been assigned to ticket <strong>${ticketRef}</strong>.`
            : `The homeowner booked a visit for ticket <strong>${ticketRef}</strong>. No one is assigned yet.`
      }</p>
      ${emailHighlightBox(whenLabel)}
      <table style="margin: 24px 0; font-size: 15px; color: ${COLORS.textMain}; width: 100%; border-collapse: collapse;">
        ${rows.map(([k, v]) => `<tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600; width: 140px;">${k}</td><td style="padding: 12px 0;">${v}</td></tr>`).join("")}
      </table>
      ${description ? `<div style="background-color: ${COLORS.bgLight}; padding: 16px 20px; margin: 24px 0; border-radius: 6px;"><p style="margin: 0 0 6px 0; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: ${COLORS.textMuted};">What the homeowner reported</p><p style="margin: 0; font-size: 15px; white-space: pre-line;">${description}</p></div>` : ""}
      ${notes ? `<p style="font-size: 14px; color: ${COLORS.textMuted};"><strong>Dispatch notes:</strong> ${notes}</p>` : ""}
      ${emailButton(`${portalUrl}/warranty/tickets/${ticketId}`, "Open the ticket")}
    `;
    return wrapEmail(content, rescheduled ? "Visit Rescheduled" : "New Assignment", companyName, COLORS.primary);
  },

  getTicketDispatchHomeownerEmail: (
    { ticketId, ticketRef, issueType, whenLabel, address, staffName, homeownerName, manageUrl },
    portalUrl,
    companyName,
    { rescheduled = false } = {},
  ) => {
    const rows = [
      ["When", whenLabel],
      ...(staffName ? [["Visiting", staffName]] : []),
      ["Address", address || "Your property"],
    ];
    const content = `
      <p style="margin-top: 0;">Hello <strong>${homeownerName}</strong>,</p>
      <p>${
        rescheduled
          ? `Your repair visit for <strong>${issueType}</strong> has been moved to a new time.`
          : `We have booked a repair visit for your <strong>${issueType}</strong> claim.`
      }</p>
      ${emailHighlightBox(whenLabel)}
      <table style="margin: 24px 0; font-size: 15px; color: ${COLORS.textMain}; width: 100%; border-collapse: collapse;">
        ${rows.map(([k, v]) => `<tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600; width: 120px;">${k}</td><td style="padding: 12px 0;">${v}</td></tr>`).join("")}
      </table>
      <p>Please make sure someone over 18 is home and the area is accessible. We'll send you a reminder before the visit.</p>
      ${emailButton(manageUrl || `${portalUrl}/warranty/tickets/${ticketId}`, manageUrl ? "Change or cancel this visit" : "View your claim")}
    `;
    return wrapEmail(content, rescheduled ? "Visit Rescheduled" : "Repair Visit Booked", companyName, COLORS.primary);
  },

  getTicketBookingInviteEmail: (
    { ticketId, ticketRef, issueType, address, staffName, homeownerName },
    bookingUrl,
    companyName,
    { nudge = false } = {},
  ) => {
    const content = `
      <p style="margin-top: 0;">Hello <strong>${homeownerName}</strong>,</p>
      <p>${
        nudge
          ? `You have not picked a time yet for your <strong>${issueType}</strong> repair visit. Choose one below and we'll lock it in.`
          : staffName
            ? `<strong>${staffName}</strong> has been assigned to your <strong>${issueType}</strong> claim. Pick a time that suits you and they'll come to you.`
            : `We're ready to book a repair visit for your <strong>${issueType}</strong> claim. Pick a time that suits you and we'll come to you.`
      }</p>
      ${emailButton(bookingUrl, "Choose your appointment time")}
      <table style="margin: 24px 0; font-size: 15px; color: ${COLORS.textMain}; width: 100%; border-collapse: collapse;">
        ${staffName ? `<tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600; width: 120px;">Visiting</td><td style="padding: 12px 0;">${staffName}</td></tr>` : ""}
        <tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600;">Address</td><td style="padding: 12px 0;">${address || "Your property"}</td></tr>
        <tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600;">Claim</td><td style="padding: 12px 0;">${ticketRef}</td></tr>
      </table>
      <p style="font-size: 14px; color: ${COLORS.textMuted};">The times shown are the ones
      ${staffName || "our team"} has free. If none of them work, reply to this
      email and we'll sort something out.</p>
    `;
    return wrapEmail(
      content,
      nudge ? "Still Need to Book" : "Choose Your Appointment",
      companyName,
      COLORS.primary,
    );
  },

  getTicketAssignmentEmail: (
    { ticketId, ticketRef, issueType, ticketCategory, description, priority, warrantyYear, address,
      homeownerName, homeownerEmail, notes },
    portalUrl,
    companyName,
  ) => {
    const rows = [
      ["Property", address || "Not specified"],
      ["Homeowner", homeownerEmail ? `${homeownerName} &mdash; ${homeownerEmail}` : homeownerName],
      ["Ticket", `${ticketRef}`],
      ["Issue", issueType],
      ...(ticketCategory ? [["Source", ticketCategory]] : []),
      ["Priority", priorityLabel(priority || "MEDIUM")],
      ["Warranty year", `Year ${warrantyYear ?? 1}`],
    ];
    const content = `
      <p style="margin-top: 0;">You have been assigned to ticket <strong>${ticketRef}</strong>.</p>
      ${emailHighlightBox("Awaiting the homeowner's chosen time")}
      <p>The homeowner has been sent your available times. You'll get a confirmation
      with the details as soon as they pick one.</p>
      <table style="margin: 24px 0; font-size: 15px; color: ${COLORS.textMain}; width: 100%; border-collapse: collapse;">
        ${rows.map(([k, v]) => `<tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600; width: 140px;">${k}</td><td style="padding: 12px 0;">${v}</td></tr>`).join("")}
      </table>
      ${description ? `<div style="background-color: ${COLORS.bgLight}; padding: 16px 20px; margin: 24px 0; border-radius: 6px;"><p style="margin: 0 0 6px 0; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: ${COLORS.textMuted};">What the homeowner reported</p><p style="margin: 0; font-size: 15px; white-space: pre-line;">${description}</p></div>` : ""}
      ${notes ? `<p style="font-size: 14px; color: ${COLORS.textMuted};"><strong>Dispatch notes:</strong> ${notes}</p>` : ""}
      ${emailButton(`${portalUrl}/warranty/tickets/${ticketId}`, "Open the ticket")}
    `;
    return wrapEmail(content, "New Assignment", companyName, COLORS.primary);
  },

  getTicketResolvedEmail: ({ ticketId, ticketRef, issueType, homeownerName }, portalUrl, companyName) => {
    const content = `
      <p style="margin-top: 0;">Hello <strong>${homeownerName}</strong>,</p>
      <p>Your warranty claim for <strong>${issueType}</strong> (ticket <strong>${ticketRef}</strong>)
      has been marked resolved.</p>
      ${emailHighlightBox("Thank you")}
      <p>Thank you for your patience while we took care of this, and for giving us the chance
      to put it right. If the issue comes back or anything still isn't right, open a new claim
      and we'll pick it straight back up.</p>
      ${emailButton(`${portalUrl}/warranty/tickets/${ticketId}`, "View your claim")}
    `;
    return wrapEmail(content, "Claim Resolved", companyName, COLORS.primary);
  },

  getTicketAppointmentReminderEmail: (role, { ticketId, ticketRef, issueType, whenLabel, address, tradeName, homeownerName, manageUrl }, windowLabel, portalUrl, companyName) => {
    const forHomeowner = role === "homeowner";
    const lead = forHomeowner
      ? `A reminder that your repair visit is ${windowLabel}.`
      : `A reminder that you have a repair visit ${windowLabel}.`;
    const rows = [
      ["When", whenLabel],
      ["Ticket", `${ticketRef}`],
      ["Issue", issueType],
      ["Property", address || "Not specified"],
      ...(forHomeowner ? (tradeName ? [["Attending", tradeName]] : []) : [["Homeowner", homeownerName]]),
    ];
    const content = `
      <p style="margin-top: 0;">${lead}</p>
      ${emailHighlightBox(whenLabel)}
      <table style="margin: 24px 0; font-size: 15px; color: ${COLORS.textMain}; width: 100%; border-collapse: collapse;">
        ${rows.map(([k, v]) => `<tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600; width: 120px;">${k}</td><td style="padding: 12px 0;">${v}</td></tr>`).join("")}
      </table>
      ${
        forHomeowner && manageUrl
          ? `${emailButton(manageUrl, "Change or cancel this visit")}<p style="font-size: 14px; color: ${COLORS.textMuted}; text-align: center;">Need a different time? You can move it yourself with the button above.</p>`
          : emailButton(`${portalUrl}/warranty/tickets/${ticketId}`, "View Ticket")
      }
    `;
    return wrapEmail(content, "Appointment Reminder", companyName, COLORS.accent);
  },

  getTicketAppointmentCancelledEmail: (role, { ticketId, ticketRef, issueType, whenLabel }, portalUrl, companyName) => {
    const who = role === "homeowner" ? "Your" : "The";
    const content = `
      <p style="margin-top: 0;">${who} repair visit for ticket <strong>${ticketRef}</strong> (${issueType}) has been cancelled.</p>
      ${emailHighlightBox(`Cancelled — ${whenLabel}`)}
      <p>If this was not expected, please get in touch and we'll rebook.</p>
      ${emailButton(`${portalUrl}/warranty/tickets/${ticketId}`, "View Ticket")}
    `;
    return wrapEmail(content, "Appointment Cancelled", companyName, COLORS.primary);
  },

  getSignupVerificationEmail: (companyName, actionLink) => {
    const content = `
      <p style="margin-top: 0;">Hi ${companyName},</p>
      <p>Thank you for signing up for Aiforhomebuilder. Please click the button below to verify your email address and activate your account:</p>
      ${emailButton(actionLink, "Verify Email Address")}
      <p style="font-size: 14px; color: ${COLORS.textMuted};">If you did not request this, please safely ignore this email.</p>
    `;
    return wrapEmail(content, "Welcome to Aiforhomebuilder!");
  },

  getAdminNewTenantEmail: (companyName, companyEmail, companyPhone, adminUrl) => {
    const content = `
      <p style="margin-top: 0;">A new company just signed up. Please schedule an onboarding appointment with the new tenant.</p>
      <table style="margin: 24px 0; font-size: 15px; color: ${COLORS.textMain}; width: 100%; border-collapse: collapse;">
        <tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600; width: 120px;">Company</td><td style="padding: 12px 0;">${companyName}</td></tr>
        <tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600;">Email</td><td style="padding: 12px 0;">${companyEmail}</td></tr>
        <tr><td style="padding: 12px 12px 12px 0; font-weight: 600;">Phone</td><td style="padding: 12px 0;">${companyPhone || "—"}</td></tr>
      </table>
      <p>You can review the tenant verification status here:</p>
      ${emailButton(adminUrl, "Open Verifications")}
    `;
    return wrapEmail(content, "New Tenant Registration");
  },

  getHomeownerWelcomeEmail: ({ name, address, coverageEnd }, actionLink, companyName) => {
    const content = `
      <p style="margin-top: 0;">Hello <strong>${name}</strong>,</p>
      <p>Congratulations on your new home${address ? ` at <strong>${address}</strong>` : ""}! Your warranty
      account with ${companyName} is ready. If anything needs fixing, you can report it any time and
      our warranty assistant will help you straight away.</p>
      ${coverageEnd ? emailHighlightBox(`Warranty coverage until ${coverageEnd}`) : ""}
      ${emailButton(actionLink, "Set your password")}
      <p style="font-size: 14px; color: ${COLORS.textMuted};">This link expires after a short time. If it has,
      use "Forgot password" on the sign-in page with this email address.</p>
    `;
    return wrapEmail(content, "Welcome Home", companyName, COLORS.primary);
  },

  /** Staff and trades: "you've been added, set your password". */
  getAccountInviteEmail: ({ name, roleLabel, existingAccount }, actionLink, companyName) => {
    const content = `
      <p style="margin-top: 0;">Hello <strong>${escapeHtml(name)}</strong>,</p>
      <p>${escapeHtml(companyName)} has added you as ${roleLabel} on their warranty portal.
      ${existingAccount
        ? "You can use your existing login; their jobs now show alongside your others."
        : "Set your password to sign in."}</p>
      ${emailButton(actionLink, existingAccount ? "Sign in" : "Set your password")}
      ${existingAccount ? "" : `<p style="font-size: 14px; color: ${COLORS.textMuted};">This link expires after a short time. If it has,
      use "Forgot password" on the sign-in page with this email address.</p>`}
    `;
    return wrapEmail(content, "You've been invited", companyName, COLORS.primary);
  },

  getSuperStaffInviteEmail: (name, actionLink) => {
    const content = `
      <p style="margin-top: 0;">Hello <strong>${escapeHtml(name)}</strong>,</p>
      <p>You've been added to the Aiforhomebuilder admin team. Set your password, then sign in on the normal sign-in page.</p>
      ${emailButton(actionLink, "Set your password")}
      <p style="font-size: 14px; color: ${COLORS.textMuted};">This link expires after a short time. If it has,
      use "Forgot password" on the sign-in page with this email address.</p>
    `;
    return wrapEmail(content, "You've been invited");
  },

  getForgotPasswordEmail: (actionLink) => {
    const content = `
      <p style="margin-top: 0;">Hi,</p>
      <p>We received a request to reset your password. Click the button below to choose a new password:</p>
      ${emailButton(actionLink, "Reset Password")}
      <p style="font-size: 14px; color: ${COLORS.textMuted};">If you did not request a password reset, please safely ignore this email.</p>
    `;
    return wrapEmail(content, "Password Reset Request");
  },

  getSuperadminCodeEmail: (code) => {
    const content = `
      <p style="margin-top: 0;">Your Super Admin sign-in code is:</p>
      <p style="font-size: 28px; font-weight: bold; letter-spacing: 6px; color: ${COLORS.primary};">${code}</p>
      <p style="font-size: 14px; color: ${COLORS.textMuted};">It works once, for 10 minutes. If you did not just sign in, someone has your Super Admin password: change it now.</p>
    `;
    return wrapEmail(content, "Super Admin Sign-in Code");
  },


  getWorkspaceActiveEmail: (companyName, portalUrl) => {
    const content = `
      <h2 style="color: ${COLORS.primary}; margin-top: 0;">You're all set, ${companyName}!</h2>
      <p>Your submitted documents have been verified and your signed agreement has been accepted. Your <strong>Warranty Care</strong> workspace is now fully unlocked.</p>
      ${emailButton(portalUrl, "Open Your Workspace")}
    `;
    return wrapEmail(content, "Workspace Activated");
  },

  getUnmarkedMeetingsEmail: (meetings, adminUrl) => {
    const rows = meetings
      .map((m, i) => `<tr style="${i < meetings.length - 1 ? `border-bottom: 1px solid ${COLORS.border};` : ""}"><td style="padding: 12px 12px 12px 0; font-weight: 600;">${escapeHtml(m.company)}${m.contact ? `<br><span style="font-weight: 400; color: ${COLORS.textMuted}; font-size: 14px;">${escapeHtml(m.contact)}</span>` : ""}</td><td style="padding: 12px 0; text-align: right;">${escapeHtml(m.when)}</td></tr>`)
      .join("");
    const content = `
      <p style="margin-top: 0;">These meetings have passed but are still marked <strong>Confirmed</strong>, so each builder's nurture journey is paused until you record what happened.</p>
      <table style="margin: 24px 0; font-size: 15px; color: ${COLORS.textMain}; width: 100%; border-collapse: collapse;">${rows}</table>
      <p>Mark each one Completed, No-show or Cancelled. A no-show gets a rebooking email, and a cancelled one goes back into nurture.</p>
      ${emailButton(adminUrl, "Open Appointments")}
    `;
    return wrapEmail(content, `${meetings.length} Meeting${meetings.length === 1 ? "" : "s"} Need an Outcome`);
  },

  /** Any Super Admin notice: its own HTML inside the standard card. */
  getAdminNoticeEmail: (title, contentHtml) => wrapEmail(`<div style="font-size: 15px;">${contentHtml}</div>`, escapeHtml(title)),

  getAdminVerificationDocEmail: (companyName, adminUrl) => {
    const content = `
      <p style="margin-top: 0;"><strong>${companyName}</strong> has just submitted a new verification document (invoice).</p>
      <p>Please review and approve the document to unlock their workspace.</p>
      ${emailButton(adminUrl, "Review Verification")}
    `;
    return wrapEmail(content, "Verification Document Submitted");
  },

  getNurtureEmail: (userHtml, companyName) => {
    return wrapEmail(bookingButtonsInEmail(userHtml), "A message from " + companyName, companyName, COLORS.primary, { replyable: true });
  },

  getAnnouncementEmail: (bodyHtml, companyName, ctaHref) => {
    let content = bodyHtml;
    if (ctaHref) {
      content += emailButton(ctaHref, "Learn more");
    }
    return wrapEmail(content, companyName || "Warranty Care & Sales Portal", companyName || "Aiforhomebuilder");
  },

  getAppointmentConfirmationEmail: (role, appointment, formattedDate, actionLink) => {
    const isHomeowner = role === "homeowner";
    const title = isHomeowner ? "Your Appointment is Confirmed" : "New Appointment Scheduled";
    const companyName = isHomeowner ? (appointment.company?.name || "Aiforhomebuilder") : "Aiforhomebuilder";
    const appointmentType = appointment.title || appointment.locationType || "Appointment";

    let detailsHtml = "";
    if (isHomeowner) {
      detailsHtml = `
        <p>Your appointment has been successfully scheduled.</p>
        <div style="background-color: ${COLORS.bgLight}; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <p style="margin: 0 0 10px 0;"><strong>Type:</strong> ${appointmentType}</p>
          <p style="margin: 0 0 10px 0;"><strong>Date:</strong> ${formattedDate}</p>
          ${appointment.notes ? `<p style="margin: 0;"><strong>Notes:</strong> ${appointment.notes}</p>` : ""}
        </div>
      `;
    } else {
      detailsHtml = `
        <p>A new appointment has been scheduled by a homeowner.</p>
        <div style="background-color: ${COLORS.bgLight}; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <p style="margin: 0 0 10px 0;"><strong>Homeowner:</strong> ${appointment.homeowner?.user?.name || "Unknown"} (${appointment.homeowner?.user?.email || "No email"})</p>
          <p style="margin: 0 0 10px 0;"><strong>Type:</strong> ${appointmentType}</p>
          <p style="margin: 0 0 10px 0;"><strong>Date:</strong> ${formattedDate}</p>
          ${appointment.notes ? `<p style="margin: 0;"><strong>Notes:</strong> ${appointment.notes}</p>` : ""}
        </div>
      `;
    }

    const content = `
      ${detailsHtml}
      ${actionLink ? emailButton(actionLink, isHomeowner ? "View Appointment" : "View Schedule") : ""}
    `;

    return wrapEmail(content, title, companyName);
  },

  getAppointmentCancellationEmail: (role, appointment, formattedDate, actionLink) => {
    const isHomeowner = role === "homeowner";
    const title = "Appointment Cancelled";
    const companyName = isHomeowner ? (appointment.company?.name || "Aiforhomebuilder") : "Aiforhomebuilder";
    const appointmentType = appointment.title || appointment.locationType || "Appointment";

    let detailsHtml = "";
    if (isHomeowner) {
      detailsHtml = `
        <p>Your appointment has been cancelled.</p>
        <div style="background-color: ${COLORS.bgLight}; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <p style="margin: 0 0 10px 0;"><strong>Type:</strong> ${appointmentType}</p>
          <p style="margin: 0 0 10px 0;"><strong>Date:</strong> ${formattedDate}</p>
        </div>
        <p>If you need to reschedule, please visit the portal.</p>
      `;
    } else {
      detailsHtml = `
        <p>An appointment has been cancelled.</p>
        <div style="background-color: ${COLORS.bgLight}; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <p style="margin: 0 0 10px 0;"><strong>Homeowner:</strong> ${appointment.homeowner?.user?.name || "Unknown"}</p>
          <p style="margin: 0 0 10px 0;"><strong>Type:</strong> ${appointmentType}</p>
          <p style="margin: 0 0 10px 0;"><strong>Date:</strong> ${formattedDate}</p>
        </div>
      `;
    }

    const content = `
      ${detailsHtml}
      ${actionLink ? emailButton(actionLink, "Open Portal") : ""}
    `;

    return wrapEmail(content, title, companyName, "#7f1d1d"); 
  },

  getSyncAlertEmail: (companyName, streak, action, lastMessage, errorListHtml, cooldownHrs) => {
    const content = `
      <p><strong>${companyName || "Your account"}</strong> has had
      <strong>${streak} consecutive ${action} failures</strong>. New and updated
      leads are <strong>not reaching the portal</strong> until this is resolved.</p>
      <p style="margin-top:20px;"><strong>Most recent error</strong></p>
      <div style="background-color: ${COLORS.bgLight}; border-left: 4px solid #b91c1c; padding: 12px 16px; margin: 8px 0 0 0; color: #475569; font-size: 14px;">
        ${lastMessage}
      </div>
      ${errorListHtml}
      <p style="margin-top:24px;"><strong>What to check</strong></p>
      <ul style="padding-left:18px;color:#475569;">
        <li>Has the Salesforce connection expired or been revoked? Reconnect it in Settings → Integrations.</li>
        <li>Did the connected app's credentials or permissions change?</li>
        <li>Is the org over its API request limit?</li>
      </ul>
      <p style="margin-top:24px;font-size:13px;color:#94a3b8;">
        You'll only get one of these every ${cooldownHrs}h while the failure persists.
      </p>
    `;
    return wrapEmail(content, "Salesforce Sync Is Failing", "Aiforhomebuilder", "#7f1d1d");
  },

  getNotifyOwnerEmail: (leadName, contactInfo, message, companyName) => {
    const content = `
      <p style="margin-top: 0;">An automation flagged <strong>${leadName}</strong> (${contactInfo}).</p>
      <p>${message}</p>
    `;
    return wrapEmail(content, "Automation Follow-Up", companyName || "Aiforhomebuilder");
  },

  getBrandedAgentEmail: (bodyText, companyName) => {
    const body = bodyText.replace(/\n/g, "<br />");
    const content = `
      ${body}
      <p style="margin-top: 24px; font-size: 12px; color: ${COLORS.textMuted};">This is an automated scheduling assistant. A member of the team can take over any time — just ask.</p>
    `;
    return wrapEmail(content, companyName || "Scheduling", companyName || "Aiforhomebuilder", COLORS.primary, {
      replyable: true,
    });
  },

  getEscalationEmail: (leadName, contactInfo, reason) => {
    const content = `
      <p style="margin-top: 0;">The scheduling assistant could not finish booking <strong>${leadName}</strong> (${contactInfo}).</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p>Please follow up to complete the appointment.</p>
    `;
    return wrapEmail(content, "Scheduling Handoff Required", "Aiforhomebuilder", "#b48c3c");
  },

  getComplianceReportEmail: (contentHtml, reportTitle) => {
    return wrapEmail(contentHtml, reportTitle || "Compliance Report", "Aiforhomebuilder");
  }
};


export const SmsTemplates = {
  getAdminNewTenantSms: (companyName, companyEmail, companyPhone) =>
    `New tenant registered: ${companyName}. Email: ${companyEmail}. Phone: ${companyPhone || "not provided"}. Please schedule an onboarding appointment.`,

  getAppointmentReminderSms: (homeownerName, type, dateStr, companyName) =>
    `Hi ${homeownerName}, reminder: You have a ${type} appointment scheduled for ${dateStr} with ${companyName}. Reply STOP to opt out.`,

  getNurtureSms: (userText, companyName) =>
    `${companyName}: ${userText}`,

  // Warranty texts mirror the emails one-for-one. sendSms prefixes the company
  // name, so it is not repeated here.
  getTicketCreatedSms: (ref, issueType, url) =>
    `We received your warranty request ${ref} (${issueType}). Track it here: ${url}`,

  getTicketStatusSms: (ref, statusLabel, url) =>
    `Your warranty ticket ${ref} is now ${statusLabel}. Details: ${url}`,

  getTicketResolvedSms: (ref, url) =>
    `Your warranty claim ${ref} is resolved. Thank you! Details: ${url}`,

  getBookingInviteSms: (ref, url, nudge) =>
    nudge
      ? `Reminder: please pick a time for your repair visit (claim ${ref}): ${url}`
      : `Please choose a time for your repair visit for claim ${ref}: ${url}`,

  getTicketAssignedSms: (ref, issueType, address, url) =>
    `You've been assigned ticket ${ref} (${issueType})${address ? ` at ${address}` : ""}. ${url}`,

  getTicketOpenReminderSms: (ref, ageLabel, url) =>
    `Reminder: ticket ${ref} has been open for ${ageLabel} with no action. ${url}`,

  getVisitSms: (role, kind, { ticketRef, whenLabel, address, homeownerName }, { rescheduled = false, windowLabel = null } = {}) => {
    const where = address ? ` at ${address}` : "";
    if (role === "homeowner") {
      if (kind === "scheduled") return `Your repair visit ${rescheduled ? "has moved to" : "is booked for"} ${whenLabel}${where}.`;
      if (kind === "reminder") return `Reminder: your repair visit is ${windowLabel} (${whenLabel})${where}.`;
      return `Your repair visit on ${whenLabel} has been cancelled.`;
    }
    if (kind === "scheduled") return `Visit ${rescheduled ? "rescheduled" : "booked"} for ticket ${ticketRef}: ${whenLabel} with ${homeownerName}${where}.`;
    if (kind === "reminder") return `Reminder: visit ${windowLabel} for ticket ${ticketRef}: ${whenLabel}${where}.`;
    return `Visit for ticket ${ticketRef} on ${whenLabel} was cancelled.`;
  },
};
