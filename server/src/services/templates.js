const COLORS = {
  primary: "#0F3B3D",
  accent: "#b48c3c",
  bgLight: "#f8f9fa",
  bgDark: "#f4f4f4",
  textMain: "#334155",
  textMuted: "#666666",
  border: "#eaeaea"
};

function wrapEmail(content, title, companyName = "Aiforhomebuilder", headerColor = COLORS.primary, { replyable = false } = {}) {
  const currentYear = new Date().getFullYear();
  const footerNote = replyable
    ? "You're messaging an automated assistant. Reply to this email and it will pick up the conversation."
    : "This is an automated message. Please do not reply directly to this email.";

  return `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid ${COLORS.border};">
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

function emailDashBox(content) {
  return `
    <div style="background-color: ${COLORS.bgLight}; border: 2px dashed ${COLORS.accent}; padding: 20px; margin: 24px auto; max-width: 250px; font-size: 32px; font-weight: bold; letter-spacing: 5px; color: ${COLORS.primary}; text-align: center; border-radius: 8px;">
      ${content}
    </div>
  `;
}

export const Templates = {

  // --- Account email change ---

  /// Sent to the NEW address. Clicking the link is what proves the person
  /// asking for the change can actually receive mail there.
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

  /// Sent to the OLD address at the same time, so a change made from a hijacked
  /// session cannot go unnoticed by whoever actually owns the account.
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

  // --- Mail Service (ticket updates) ---

  getTicketUpdateEmail: (homeownerName, ticketId, statusLabel, portalUrl, companyName) => {
    const content = `
      <p style="margin-top: 0;">Hello <strong>${homeownerName}</strong>,</p>
      <p>The status of your warranty ticket <strong>#${ticketId}</strong> has been updated to:</p>
      ${emailHighlightBox(statusLabel)}
      <p>Our team is working to resolve this as quickly as possible. You can track the progress of your claim in the portal.</p>
      ${emailButton(`${portalUrl}/warranty/tickets/${ticketId}`, "View Ticket in Portal")}
    `;
    return wrapEmail(content, "Warranty Ticket Update", companyName, COLORS.accent);
  },


  /// Sent to the homeowner the moment their ticket is filed, from either the
  /// portal form or the warranty agent.
  getTicketCreatedHomeownerEmail: (homeownerName, ticketId, issueType, portalUrl, companyName) => {
    const content = `
      <p style="margin-top: 0;">Hello <strong>${homeownerName}</strong>,</p>
      <p>We've received your warranty request and opened ticket <strong>#${ticketId}</strong>.</p>
      ${emailHighlightBox(issueType)}
      <p>Our team will review it and be in touch. You can follow the progress of your claim in the portal at any time.</p>
      ${emailButton(`${portalUrl}/warranty/tickets/${ticketId}`, "View Ticket in Portal")}
    `;
    return wrapEmail(content, "Warranty Ticket Received", companyName, COLORS.accent);
  },

  /// Sent to company admins when a ticket is filed. Leads with priority so an
  /// emergency is obvious in the inbox preview.
  getTicketCreatedAdminEmail: (ticketId, issueType, priority, isEmergency, homeownerName, propertyAddress, portalUrl, companyName) => {
    const urgencyNote = isEmergency
      ? `<p style="color: #b91c1c; font-weight: 600; margin-top: 0;">This ticket was flagged as an emergency and needs immediate attention.</p>`
      : "";
    const content = `
      ${urgencyNote}
      <p${isEmergency ? "" : ' style="margin-top: 0;"'}>A new warranty ticket has been filed and is waiting for review.</p>
      <table style="margin: 24px 0; font-size: 15px; color: ${COLORS.textMain}; width: 100%; border-collapse: collapse;">
        <tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600; width: 120px;">Ticket</td><td style="padding: 12px 0;">#${ticketId}</td></tr>
        <tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600;">Issue</td><td style="padding: 12px 0;">${issueType}</td></tr>
        <tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600;">Priority</td><td style="padding: 12px 0;">${priority}</td></tr>
        <tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600;">Homeowner</td><td style="padding: 12px 0;">${homeownerName}</td></tr>
        <tr><td style="padding: 12px 12px 12px 0; font-weight: 600;">Property</td><td style="padding: 12px 0;">${propertyAddress || "Not specified"}</td></tr>
      </table>
      ${emailButton(`${portalUrl}/warranty/tickets/${ticketId}`, "Open Ticket")}
    `;
    return wrapEmail(content, "New Warranty Ticket", companyName, COLORS.primary);
  },

  /// Stale-ticket nag. `ageLabel` is pre-formatted by the caller so the copy
  /// reads naturally for both the 4h emergency cycle and the 48h standard one.
  getTicketReminderEmail: (ticketId, issueType, priority, isEmergency, homeownerName, ageLabel, portalUrl, companyName) => {
    const lead = isEmergency
      ? `This <strong>emergency</strong> ticket has been open for ${ageLabel} and has not been actioned yet.`
      : `This ticket has been open for ${ageLabel} and has not been actioned yet.`;
    const content = `
      <p style="margin-top: 0;">${lead}</p>
      <table style="margin: 24px 0; font-size: 15px; color: ${COLORS.textMain}; width: 100%; border-collapse: collapse;">
        <tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600; width: 120px;">Ticket</td><td style="padding: 12px 0;">#${ticketId}</td></tr>
        <tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600;">Issue</td><td style="padding: 12px 0;">${issueType}</td></tr>
        <tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600;">Priority</td><td style="padding: 12px 0;">${priority}</td></tr>
        <tr><td style="padding: 12px 12px 12px 0; font-weight: 600;">Homeowner</td><td style="padding: 12px 0;">${homeownerName}</td></tr>
      </table>
      <p>Moving it out of <strong>Open</strong> stops these reminders.</p>
      ${emailButton(`${portalUrl}/warranty/tickets/${ticketId}`, "Review Ticket")}
    `;
    return wrapEmail(content, "Ticket Awaiting Action", companyName, isEmergency ? "#b91c1c" : COLORS.primary);
  },

  /// Sent to the assigned staff member when a ticket is dispatched to them, and
  /// again if the visit is moved. Staff get the whole picture — they are the one
  /// turning up, so everything they might need is in the mail rather than behind
  /// a login.
  getTicketDispatchStaffEmail: (
    { ticketId, issueType, ticketCategory, description, priority, warrantyYear, whenLabel,
      durationMinutes, address, homeownerName, homeownerEmail, notes },
    portalUrl,
    companyName,
    { rescheduled = false } = {},
  ) => {
    const rows = [
      ["When", `${whenLabel}${durationMinutes ? ` (${durationMinutes} min)` : ""}`],
      ["Property", address || "Not specified"],
      ["Homeowner", homeownerEmail ? `${homeownerName} &mdash; ${homeownerEmail}` : homeownerName],
      ["Ticket", `#${ticketId}`],
      ["Issue", issueType],
      ...(ticketCategory ? [["Source", ticketCategory]] : []),
      ["Priority", priority || "MEDIUM"],
      ["Warranty year", `Year ${warrantyYear ?? 1}`],
    ];
    const content = `
      <p style="margin-top: 0;">${
        rescheduled
          ? `The visit for ticket <strong>#${ticketId}</strong> has been moved.`
          : `You have been assigned to ticket <strong>#${ticketId}</strong>.`
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

  /// The homeowner's half of the same event. Deliberately thin: when someone is
  /// coming and who it is. Priority, warranty year and internal notes are the
  /// builder's business, not theirs.
  getTicketDispatchHomeownerEmail: (
    { ticketId, issueType, whenLabel, address, staffName, homeownerName, manageUrl },
    portalUrl,
    companyName,
    { rescheduled = false } = {},
  ) => {
    const rows = [
      ["When", whenLabel],
      ["Visiting", staffName || companyName],
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

  /// The homeowner's booking invitation. This is the only route to a scheduled
  /// visit, so the link is the whole point of the mail — everything else is kept
  /// out of the way of it.
  getTicketBookingInviteEmail: (
    { ticketId, issueType, address, staffName, homeownerName },
    bookingUrl,
    companyName,
    { nudge = false } = {},
  ) => {
    const content = `
      <p style="margin-top: 0;">Hello <strong>${homeownerName}</strong>,</p>
      <p>${
        nudge
          ? `You have not picked a time yet for your <strong>${issueType}</strong> repair visit. Choose one below and we'll lock it in.`
          : `<strong>${staffName || "One of our team"}</strong> has been assigned to your <strong>${issueType}</strong> claim. Pick a time that suits you and they'll come to you.`
      }</p>
      ${emailButton(bookingUrl, "Choose your appointment time")}
      <table style="margin: 24px 0; font-size: 15px; color: ${COLORS.textMain}; width: 100%; border-collapse: collapse;">
        <tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600; width: 120px;">Visiting</td><td style="padding: 12px 0;">${staffName || companyName}</td></tr>
        <tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600;">Address</td><td style="padding: 12px 0;">${address || "Your property"}</td></tr>
        <tr style="border-bottom: 1px solid ${COLORS.border};"><td style="padding: 12px 12px 12px 0; font-weight: 600;">Claim</td><td style="padding: 12px 0;">#${ticketId}</td></tr>
      </table>
      <p style="font-size: 14px; color: ${COLORS.textMuted};">The times shown are the ones
      ${staffName || "your assigned team member"} has free. If none of them work, reply to this
      email and we'll sort something out.</p>
    `;
    return wrapEmail(
      content,
      nudge ? "Still Need to Book" : "Choose Your Appointment",
      companyName,
      COLORS.primary,
    );
  },

  /// Tells the assigned staff member the job is theirs, before any time exists.
  /// The homeowner is the one who picks, so this mail is a heads-up plus the
  /// full ticket, not a calendar entry.
  getTicketAssignmentEmail: (
    { ticketId, issueType, ticketCategory, description, priority, warrantyYear, address,
      homeownerName, homeownerEmail, notes },
    portalUrl,
    companyName,
  ) => {
    const rows = [
      ["Property", address || "Not specified"],
      ["Homeowner", homeownerEmail ? `${homeownerName} &mdash; ${homeownerEmail}` : homeownerName],
      ["Ticket", `#${ticketId}`],
      ["Issue", issueType],
      ...(ticketCategory ? [["Source", ticketCategory]] : []),
      ["Priority", priority || "MEDIUM"],
      ["Warranty year", `Year ${warrantyYear ?? 1}`],
    ];
    const content = `
      <p style="margin-top: 0;">You have been assigned to ticket <strong>#${ticketId}</strong>.</p>
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

  /// Sent to the homeowner when the ticket is closed out.
  getTicketResolvedEmail: ({ ticketId, issueType, homeownerName }, portalUrl, companyName) => {
    const content = `
      <p style="margin-top: 0;">Hello <strong>${homeownerName}</strong>,</p>
      <p>Your warranty claim for <strong>${issueType}</strong> (ticket <strong>#${ticketId}</strong>)
      has been marked resolved.</p>
      ${emailHighlightBox("Thank you")}
      <p>Thank you for your patience while we took care of this, and for giving us the chance
      to put it right. If the issue comes back or anything still isn't right, open a new claim
      and we'll pick it straight back up.</p>
      ${emailButton(`${portalUrl}/warranty/tickets/${ticketId}`, "View your claim")}
    `;
    return wrapEmail(content, "Claim Resolved", companyName, COLORS.primary);
  },

  /// 24-hour and 1-hour appointment reminders, for either side.
  getTicketAppointmentReminderEmail: (role, { ticketId, issueType, whenLabel, address, tradeName, homeownerName, manageUrl }, windowLabel, portalUrl, companyName) => {
    const forHomeowner = role === "homeowner";
    const lead = forHomeowner
      ? `A reminder that your repair visit is ${windowLabel}.`
      : `A reminder that you have a repair visit ${windowLabel}.`;
    const rows = [
      ["When", whenLabel],
      ["Ticket", `#${ticketId}`],
      ["Issue", issueType],
      ["Property", address || "Not specified"],
      forHomeowner ? ["Attending", tradeName || companyName] : ["Homeowner", homeownerName],
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

  /// Sent to both sides when a scheduled visit is called off.
  getTicketAppointmentCancelledEmail: (role, { ticketId, issueType, whenLabel }, portalUrl, companyName) => {
    const who = role === "homeowner" ? "Your" : "The";
    const content = `
      <p style="margin-top: 0;">${who} repair visit for ticket <strong>#${ticketId}</strong> (${issueType}) has been cancelled.</p>
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

  getForgotPasswordEmail: (actionLink) => {
    const content = `
      <p style="margin-top: 0;">Hi,</p>
      <p>We received a request to reset your password. Click the button below to choose a new password:</p>
      ${emailButton(actionLink, "Reset Password")}
      <p style="font-size: 14px; color: ${COLORS.textMuted};">If you did not request a password reset, please safely ignore this email.</p>
    `;
    return wrapEmail(content, "Password Reset Request");
  },

  // --- Superadmin / Company Controllers ---

  getWorkspaceActiveEmail: (companyName, portalUrl) => {
    const content = `
      <h2 style="color: ${COLORS.primary}; margin-top: 0;">You're all set, ${companyName}!</h2>
      <p>Your invoice payment has been verified and your <strong>Warranty Care</strong> workspace is now fully unlocked.</p>
      ${emailButton(portalUrl, "Open Your Workspace")}
    `;
    return wrapEmail(content, "Workspace Activated");
  },

  getAdminVerificationDocEmail: (companyName, adminUrl) => {
    const content = `
      <p style="margin-top: 0;"><strong>${companyName}</strong> has just submitted a new verification document (invoice).</p>
      <p>Please review and approve the document to unlock their workspace.</p>
      ${emailButton(adminUrl, "Review Verification")}
    `;
    return wrapEmail(content, "Verification Document Submitted");
  },

  // --- Campaign / Inngest Functions ---

  // Nurture campaign wrapper (wraps user-generated content)
  getNurtureEmail: (userHtml, companyName) => {
    return wrapEmail(userHtml, "A message from " + companyName, companyName);
  },

  // Announcement wrapper (wraps user-generated content + optional CTA link)
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

    let detailsHtml = "";
    if (isHomeowner) {
      detailsHtml = `
        <p>Your appointment has been successfully scheduled.</p>
        <div style="background-color: ${COLORS.bgLight}; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <p style="margin: 0 0 10px 0;"><strong>Type:</strong> ${appointment.type}</p>
          <p style="margin: 0 0 10px 0;"><strong>Date:</strong> ${formattedDate}</p>
          ${appointment.notes ? `<p style="margin: 0;"><strong>Notes:</strong> ${appointment.notes}</p>` : ""}
        </div>
      `;
    } else {
      detailsHtml = `
        <p>A new appointment has been scheduled by a homeowner.</p>
        <div style="background-color: ${COLORS.bgLight}; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <p style="margin: 0 0 10px 0;"><strong>Homeowner:</strong> ${appointment.homeowner?.user?.name || "Unknown"} (${appointment.homeowner?.user?.email || "No email"})</p>
          <p style="margin: 0 0 10px 0;"><strong>Type:</strong> ${appointment.type}</p>
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

    let detailsHtml = "";
    if (isHomeowner) {
      detailsHtml = `
        <p>Your appointment has been cancelled.</p>
        <div style="background-color: ${COLORS.bgLight}; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <p style="margin: 0 0 10px 0;"><strong>Type:</strong> ${appointment.type}</p>
          <p style="margin: 0 0 10px 0;"><strong>Date:</strong> ${formattedDate}</p>
        </div>
        <p>If you need to reschedule, please visit the portal.</p>
      `;
    } else {
      detailsHtml = `
        <p>An appointment has been cancelled.</p>
        <div style="background-color: ${COLORS.bgLight}; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <p style="margin: 0 0 10px 0;"><strong>Homeowner:</strong> ${appointment.homeowner?.user?.name || "Unknown"}</p>
          <p style="margin: 0 0 10px 0;"><strong>Type:</strong> ${appointment.type}</p>
          <p style="margin: 0 0 10px 0;"><strong>Date:</strong> ${formattedDate}</p>
        </div>
      `;
    }

    const content = `
      ${detailsHtml}
      ${actionLink ? emailButton(actionLink, "Open Portal") : ""}
    `;

    return wrapEmail(content, title, companyName, "#7f1d1d"); // red header for cancellation
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

  // --- Automation / Appointment Agent ---

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

// ---------------------------------------------------------------------------
// SPECIFIC SMS TEMPLATES
// ---------------------------------------------------------------------------

export const SmsTemplates = {
  getAdminNewTenantSms: (companyName, companyEmail, companyPhone) =>
    `New tenant registered: ${companyName}. Email: ${companyEmail}. Phone: ${companyPhone || "not provided"}. Please schedule an onboarding appointment.`,

  getAppointmentReminderSms: (homeownerName, type, dateStr, companyName) =>
    `Hi ${homeownerName}, reminder: You have a ${type} appointment scheduled for ${dateStr} with ${companyName}. Reply STOP to opt out.`,

  getNurtureSms: (userText, companyName) =>
    `${companyName}: ${userText}`
};
