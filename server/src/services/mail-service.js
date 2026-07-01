import nodemailer from "nodemailer";

export class MailService {
  static SMTP_HOST = process.env.SMTP_HOST || "smtp-relay.brevo.com";
  static SMTP_PORT = parseInt(process.env.SMTP_PORT || "587", 10);
  static SMTP_USER = process.env.SMTP_USER || "";
  static SMTP_PASS = process.env.SMTP_PASS || "";
  static SENDER_EMAIL = process.env.SENDER_EMAIL || "noreply@bitzsol.com";
  static SENDER_NAME = "Aiforhomebuilder";

  static transporter = (() => {
    console.log(`[Mail Service] Initializing default SMTP transporter: host=${MailService.SMTP_HOST}, port=${MailService.SMTP_PORT}`);
    return nodemailer.createTransport({
      host: MailService.SMTP_HOST,
      port: MailService.SMTP_PORT,
      secure: MailService.SMTP_PORT === 465,
      auth: {
        user: MailService.SMTP_USER,
        pass: MailService.SMTP_PASS,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      logger: false,
      debug: false,
    });
  })();

  static transporters = new Map();

  static getOrCreateTransporter(smtpConfig) {
    if (!smtpConfig) return this.transporter;
    
    const cacheKey = `${smtpConfig.host}:${smtpConfig.port}:${smtpConfig.user}`;
    if (!this.transporters.has(cacheKey)) {
      const newTransporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.port === 465,
        auth: {
          user: smtpConfig.user,
          pass: smtpConfig.pass,
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
        logger: false,
        debug: false,
      });
      this.transporters.set(cacheKey, newTransporter);
    }
    return this.transporters.get(cacheKey);
  }

  static async sendEmail({ to, subject, html, fromName, fromEmail, smtpConfig, headers }) {
    if (!smtpConfig && (!this.SMTP_USER || !this.SMTP_PASS)) {
      console.warn("[Mail Service] SMTP credentials missing and no custom config provided. Email will not be sent.");
      return { success: false, error: "SMTP credentials missing" };
    }

    const senderName = smtpConfig?.senderName || fromName || this.SENDER_NAME;
    const senderEmail = smtpConfig?.senderEmail || fromEmail || this.SENDER_EMAIL;
    const fromString = `"${senderName}" <${senderEmail}>`;
    
    const activeTransporter = this.getOrCreateTransporter(smtpConfig);
    const host = smtpConfig?.host || this.SMTP_HOST;
    const port = smtpConfig?.port || this.SMTP_PORT;

    try {
      console.log(`[Mail Service] Attempting to send email...`);
      console.log(`[Mail Service]   From: ${fromString}`);
      console.log(`[Mail Service]   To: ${to}`);
      console.log(`[Mail Service]   Subject: ${subject}`);
      console.log(`[Mail Service]   SMTP: ${host}:${port}`);

      const info = await activeTransporter.sendMail({
        from: fromString,
        to,
        subject,
        html,
        headers,
      });

      console.log(`[Mail Service] ✅ Email sent successfully!`);
      console.log(`[Mail Service]   Message ID: ${info.messageId}`);
      console.log(`[Mail Service]   Response: ${info.response}`);
      console.log(`[Mail Service]   Accepted: ${JSON.stringify(info.accepted)}`);
      console.log(`[Mail Service]   Rejected: ${JSON.stringify(info.rejected)}`);
      return { success: true, messageId: info.messageId, response: info.response };
    } catch (error) {
      console.error(`[Mail Service] ❌ Failed to send email to ${to}`);
      console.error(`[Mail Service]   Error Code: ${error.code || 'N/A'}`);
      console.error(`[Mail Service]   Error Message: ${error.message}`);
      console.error(`[Mail Service]   SMTP Response: ${error.response || 'N/A'}`);
      console.error(`[Mail Service]   Full Error:`, error);
      return { success: false, error: error?.message || "Internal error" };
    }
  }

  static async sendTicketStatusUpdate(to, homeownerName, ticketId, status, company = null, smtpConfig = null) {
    const statusLabel = status.replace("_", " ").toLowerCase();
    const subject = `Ticket Update: ${ticketId} is now ${statusLabel}`;

    const companyName = company?.name || "Aiforhomebuilder";
    const companyEmail = company?.email || this.SENDER_EMAIL;
    const portalUrl = process.env.NEXT_PUBLIC_URL || "http://localhost:3000";

    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden;">
        <div style="background: #b48c3c; color: white; padding: 20px; text-align: center;">
          <h1 style="margin: 0; font-size: 24px;">Warranty Ticket Update</h1>
        </div>
        <div style="padding: 30px; line-height: 1.6; color: #333;">
          <p>Hello <strong>${homeownerName}</strong>,</p>
          <p>The status of your warranty ticket <strong>#${ticketId}</strong> has been updated to:</p>
          <div style="background: #f8f9fa; border-left: 4px solid #b48c3c; padding: 15px; margin: 20px 0; font-size: 18px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">
            ${statusLabel}
          </div>
          <p>Our team is working to resolve this as quickly as possible. You can track the progress of your claim in the portal.</p>
          <div style="text-align: center; margin-top: 30px;">
            <a href="${portalUrl}/warranty/tickets/${ticketId}" 
               style="background: #b48c3c; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">
               View Ticket in Portal
            </a>
          </div>
        </div>
        <div style="background: #f4f4f4; padding: 20px; text-align: center; color: #666; font-size: 12px;">
          <p>&copy; ${new Date().getFullYear()} ${companyName}. All rights reserved.</p>
        </div>
      </div>
    `;

    return this.sendEmail({ to, subject, html, fromName: companyName, fromEmail: companyEmail, smtpConfig });
  }

  static async sendVerificationOtp(to, otp) {
    const subject = `Your Verification Code is ${otp}`;

    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden;">
        <div style="background: #0F3B3D; color: white; padding: 20px; text-align: center;">
          <h1 style="margin: 0; font-size: 24px;">Verify Your Email</h1>
        </div>
        <div style="padding: 30px; line-height: 1.6; color: #333; text-align: center;">
          <p>Hello,</p>
          <p>Please use the following 6-digit code to complete your signup process:</p>
          <div style="background: #f8f9fa; border: 2px dashed #b48c3c; padding: 15px; margin: 20px auto; max-width: 200px; font-size: 32px; font-weight: bold; letter-spacing: 5px;">
            ${otp}
          </div>
          <p>This code will expire in 10 minutes.</p>
          <p>If you did not request this, please ignore this email.</p>
        </div>
        <div style="background: #f4f4f4; padding: 20px; text-align: center; color: #666; font-size: 12px;">
          <p>&copy; 2026 Aiforhomebuilder. All rights reserved.</p>
        </div>
      </div>
    `;

    return this.sendEmail({ to, subject, html });
  }

  static async sendPasswordResetOtp(to, otp) {
    const subject = `Reset Your Password - Verification Code: ${otp}`;

    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden;">
        <div style="background: #0F3B3D; color: white; padding: 20px; text-align: center;">
          <h1 style="margin: 0; font-size: 24px;">Reset Your Password</h1>
        </div>
        <div style="padding: 30px; line-height: 1.6; color: #333; text-align: center;">
          <p>Hello,</p>
          <p>We received a request to reset your account password. Please use the following 6-digit verification code to proceed:</p>
          <div style="background: #f8f9fa; border: 2px dashed #b48c3c; padding: 15px; margin: 20px auto; max-width: 200px; font-size: 32px; font-weight: bold; letter-spacing: 5px;">
            ${otp}
          </div>
          <p>This code is valid for 10 minutes.</p>
          <p>If you did not request a password reset, please ignore this email; your password will remain unchanged.</p>
        </div>
        <div style="background: #f4f4f4; padding: 20px; text-align: center; color: #666; font-size: 12px;">
          <p>&copy; 2026 Aiforhomebuilder. All rights reserved.</p>
        </div>
      </div>
    `;

    return this.sendEmail({ to, subject, html });
  }
}
