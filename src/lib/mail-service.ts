export interface MailOptions {
  to: string;
  subject: string;
  html: string;
}

export class MailService {
  private static BREVO_API_KEY = process.env.BREVO_API_KEY;
  private static SENDER_EMAIL = process.env.SENDER_EMAIL || "noreply@bitzsol.com";
  private static SENDER_NAME = "Ai.Lumen Warranty Care";

  static async sendEmail({ to, subject, html }: MailOptions) {
    if (!this.BREVO_API_KEY) {
      console.warn("[Mail Service] BREVO_API_KEY is not set. Email will not be sent.");
      return { success: false, error: "API Key missing" };
    }

    try {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "accept": "application/json",
          "api-key": this.BREVO_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sender: {
            name: this.SENDER_NAME,
            email: this.SENDER_EMAIL,
          },
          to: [{ email: to }],
          subject: subject,
          htmlContent: html,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error("[Mail Service] Brevo API Error:", data);
        return { success: false, error: data.message };
      }

      console.log(`[Mail Service] Email sent successfully to ${to}. Message ID: ${data.messageId}`);
      return { success: true, messageId: data.messageId };
    } catch (error) {
      console.error("[Mail Service] Failed to send email:", error);
      return { success: false, error: "Internal error" };
    }
  }

  static async sendTicketStatusUpdate(to: string, homeownerName: string, ticketId: string, status: string) {
    const statusLabel = status.replace("_", " ").toLowerCase();
    const subject = `Ticket Update: ${ticketId} is now ${statusLabel}`;
    
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
            <a href="https://warranty-portal.bitzsol.com/tickets/${ticketId}" 
               style="background: #b48c3c; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">
               View Ticket in Portal
            </a>
          </div>
        </div>
        <div style="background: #f4f4f4; padding: 20px; text-align: center; color: #666; font-size: 12px;">
          <p>&copy; 2026 Ai.Lumen Warranty Care. All rights reserved.</p>
        </div>
      </div>
    `;

    return this.sendEmail({ to, subject, html });
  }

  static async sendVerificationOtp(to: string, otp: string) {
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
          <p>&copy; 2026 Ai.Lumen Warranty Care. All rights reserved.</p>
        </div>
      </div>
    `;

    return this.sendEmail({ to, subject, html });
  }

  static async sendPasswordResetOtp(to: string, otp: string) {
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
          <p>&copy; 2026 Ai.Lumen Warranty Care. All rights reserved.</p>
        </div>
      </div>
    `;

    return this.sendEmail({ to, subject, html });
  }
}

