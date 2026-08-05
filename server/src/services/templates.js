const COLORS = {
  primary: "#0F3B3D",
  accent: "#b48c3c",
  bgLight: "#f8f9fa",
  bgDark: "#f4f4f4",
  textMain: "#334155",
  textMuted: "#666666",
  border: "#eaeaea"
};

function wrapEmail(content, title, companyName = "Aiforhomebuilder", headerColor = COLORS.primary) {
  const currentYear = new Date().getFullYear();

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
        <p style="margin: 8px 0 0 0; font-size: 11px;">This is an automated message. Please do not reply directly to this email.</p>
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
      <p style="margin-top: 24px; font-size: 12px; color: ${COLORS.textMuted};">This is an automated scheduling assistant.</p>
    `;
    return wrapEmail(content, companyName || "Scheduling", companyName || "Aiforhomebuilder");
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
