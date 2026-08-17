import prisma from "../lib/prisma.js";
import { sendSms, smsSent } from "../services/sms.service.js";
import { MailService } from "../services/mail-service.js";
import { ComplianceService } from "../services/compliance-service.js";
import { Templates } from "../services/templates.js";

export const bookAppointment = async (req, res) => {
  try {
    const { name, email, phone, preferredTime } = req.body;

    if (!name || !email || !phone || !preferredTime) {
      return res.status(400).json({ message: "Name, email, phone, and preferredTime are required" });
    }

    const appointment = await prisma.salesAgentAppointment.create({
      data: {
        name,
        email,
        phone,
        preferredTime,
      },
    });

    // Notify User - SMS. This booking belongs to AI4Homebuilders itself, not to a
    // tenant workspace, so it sends on the platform credentials — the same
    // "SYSTEM" marker the admin notification below already uses.
    const customerSms = await sendSms({
      to: phone,
      body: `Hi ${name}, your appointment with AI4Homebuilders is confirmed for ${preferredTime}. We look forward to speaking with you!`,
      smsConfig: "SYSTEM",
      tag: "sales-agent-booking",
    });
    if (!smsSent(customerSms)) {
      console.error(
        `[Sales Agent Booking] Confirmation SMS to ${phone} not delivered (${customerSms.outcome}): ${customerSms.error}`,
      );
    }

    // Notify User - Email
    try {
      await MailService.sendEmail({
        to: email,
        subject: "Appointment Confirmed - AI4Homebuilders",
        allowPlatformSender: true,
        html: `
          <h3>Appointment Confirmed</h3>
          <p>Hi ${name},</p>
          <p>Your appointment with AI4Homebuilders has been successfully booked.</p>
          <p><strong>Time:</strong> ${preferredTime}</p>
          <p>We look forward to speaking with you soon.</p>
          <p>Best,<br>The AI4HB Team</p>
        `,
      });
    } catch (emailError) {
      console.error("[Sales Agent Booking] Failed to send Email to user:", emailError);
    }

    // Notify Admin
    const adminPhone = process.env.ADMIN_NOTIFY_PHONE;
    const adminEmail = process.env.ADMIN_NOTIFY_EMAIL;

    if (adminPhone) {
      const adminSms = await sendSms({
        to: adminPhone,
        body: `New Appointment! Name: ${name}, Phone: ${phone}, Time: ${preferredTime}`,
        smsConfig: "SYSTEM",
      });
      if (!smsSent(adminSms)) {
        console.error(
          `[Sales Agent Booking] Admin SMS not delivered (${adminSms.outcome}): ${adminSms.error}`,
        );
      }
    } else {
      console.log("[Sales Agent Booking] ADMIN_NOTIFY_PHONE not set. Skipping admin SMS notification.");
    }

    if (adminEmail) {
      try {
        await MailService.sendEmail({
          to: adminEmail,
          subject: "New Sales Agent Appointment Booked",
          html: `
            <h3>New Appointment</h3>
            <p>A new appointment has been booked via the Sales Agent.</p>
            <ul>
              <li><strong>Name:</strong> ${name}</li>
              <li><strong>Email:</strong> ${email}</li>
              <li><strong>Phone:</strong> ${phone}</li>
              <li><strong>Preferred Time:</strong> ${preferredTime}</li>
            </ul>
          `,
          allowPlatformSender: true,
        });
      } catch (adminEmailError) {
        console.error("[Sales Agent Booking] Failed to send Email to admin:", adminEmailError);
      }
    } else {
      console.log("[Sales Agent Booking] ADMIN_NOTIFY_EMAIL not set. Skipping admin email notification.");
    }

    return res.status(201).json({
      message: "Appointment booked successfully",
      appointment,
    });
  } catch (error) {
    console.error("[Sales Agent Booking] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};



export const simulateInbound = async (req, res) => {
  try {
    const { leadId = "demo-lead", body = "I am interested in a home.", channel = "SMS" } = req.body;
    
    // We fetch a dummy/default company for the demo.
    const company = await prisma.company.findFirst();
    if (!company) {
      return res.status(500).json({ message: "No company found for demo" });
    }

    const { inngest } = await import("../lib/inngest.js");
    
    await inngest.send({ name: "campaign.exit", data: { leadId, reason: "REPLY" } });
    
    await inngest.send({
      name: "lead.reply.received",
      data: { leadId, companyId: company.id, channel, body, sender: "+1234567890" },
    });
    
    return res.json({ message: "Inbound message simulated and Inngest agent triggered successfully." });
  } catch (error) {
    console.error("[Simulate Inbound] Error:", error);
    return res.status(500).json({ message: error.message || "Failed to trigger Inngest event. Make sure Inngest Dev Server is running." });
  }
};


/* ------------------------------------------------------------------ *
 * Botpress outbound messaging.
 *
 * Botpress decides what to say and who to say it to; delivery is ours.
 * Everything here sends on the platform's own credentials — Telnyx/Twilio for
 * SMS, Brevo for email — never a tenant's integration, because these messages
 * come from AI4Homebuilders rather than from any one workspace.
 * ------------------------------------------------------------------ */

const MAX_MESSAGE_CHARS = 1600;
const EMAIL_RE = /^[^\s@]+@([^\s@.,]+\.)+[^\s@.,]{2,}$/;
const PLATFORM_SENDER_NAME = "AI4Homebuilders";

function normalizePhone(value) {
  return String(value || "").replace(/[^\d+]/g, "");
}

function isValidPhone(value) {
  return /^\+?\d{10,15}$/.test(normalizePhone(value));
}

/**
 * POST /api/public/sales-agent/message
 *
 * Body: { message, email?, phone?, subject?, name? }
 * Sends to whichever contact details are supplied — both when both are given.
 * Always reports per-channel outcomes rather than a single pass/fail, so the
 * caller can tell "the text failed but the email landed" from "nothing sent".
 */
export const sendAgentMessage = async (req, res) => {
  try {
    const { message, email, phone, subject, name } = req.body || {};

    const text = typeof message === "string" ? message.trim() : "";
    if (!text) {
      return res.status(400).json({ message: "message is required" });
    }
    if (text.length > MAX_MESSAGE_CHARS) {
      return res
        .status(400)
        .json({ message: `message is too long (${text.length} chars, max ${MAX_MESSAGE_CHARS})` });
    }

    const wantsEmail = !!email;
    const wantsSms = !!phone;
    if (!wantsEmail && !wantsSms) {
      return res.status(400).json({ message: "Provide an email address, a phone number, or both" });
    }
    if (wantsEmail && !EMAIL_RE.test(String(email).trim())) {
      return res.status(400).json({ message: "email is not a valid address" });
    }
    if (wantsSms && !isValidPhone(phone)) {
      return res.status(400).json({ message: "phone must be 10-15 digits, country code included" });
    }

    const results = {};

    if (wantsSms) {
      const to = normalizePhone(phone);
      // Every platform text carries the opt-out line, same as the agent's own.
      const body = ComplianceService.addSmsOptOutSuffix(text);
      const result = await sendSms({ to, body, smsConfig: "SYSTEM", tag: "botpress-message" });
      const delivered = smsSent(result);
      if (!delivered) {
        console.error(
          `[Agent Message] SMS to ${to} not delivered (${result.outcome}): ${result.error}`,
        );
      }
      results.sms = {
        to,
        delivered,
        outcome: result.outcome,
        messageId: result.messageId || null,
        characters: body.length,
        error: delivered ? null : result.error || null,
      };
    }

    if (wantsEmail) {
      const to = String(email).trim();
      const lines = name ? `Hi ${name},\n\n${text}` : text;
      const result = await MailService.sendEmail({
        to,
        subject: (typeof subject === "string" && subject.trim()) || `A message from ${PLATFORM_SENDER_NAME}`,
        html: Templates.getBrandedAgentEmail(lines, PLATFORM_SENDER_NAME),
        fromName: PLATFORM_SENDER_NAME,
        allowPlatformSender: true,
      });
      if (!result.success) {
        console.error(
          `[Agent Message] Email to ${to} not delivered (${result.outcome}): ${result.error}`,
        );
      }
      results.email = {
        to,
        delivered: !!result.success,
        outcome: result.outcome,
        error: result.success ? null : result.error || null,
      };
    }

    const attempted = Object.values(results);
    const anyDelivered = attempted.some((r) => r.delivered);

    // Nothing got through: say so with a 502 rather than a cheerful 200.
    return res.status(anyDelivered ? 200 : 502).json({
      ok: anyDelivered,
      results,
    });
  } catch (error) {
    console.error("[Agent Message] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
