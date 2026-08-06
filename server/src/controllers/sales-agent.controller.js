import prisma from "../lib/prisma.js";
import { sendSms } from "../services/sms.service.js";
import { MailService } from "../services/mail-service.js";
import { runClaudeTurn } from "../inngest/functions/appointment.js";
import { query as kbQuery } from "../services/vector-store.service.js";
import { KB_SCOPES } from "../lib/sales-ai.js";
import { getAvailableSlots, getAvailabilitySetting } from "../services/scheduling-service.js";
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

    // Notify User - SMS
    try {
      await sendSms({
        to: phone,
        body: `Hi ${name}, your appointment with AI4Homebuilders is confirmed for ${preferredTime}. We look forward to speaking with you!`,
      });
    } catch (smsError) {
      console.error("[Sales Agent Booking] Failed to send SMS to user:", smsError);
    }

    // Notify User - Email
    try {
      await MailService.sendEmail({
        to: email,
        subject: "Appointment Confirmed - AI4Homebuilders",
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
      try {
        await sendSms({
          to: adminPhone,
          body: `New Appointment! Name: ${name}, Phone: ${phone}, Time: ${preferredTime}`,
          smsConfig: "SYSTEM"
        });
      } catch (adminSmsError) {
        console.error("[Sales Agent Booking] Failed to send SMS to admin:", adminSmsError);
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



export const chatDemo = async (req, res) => {
  try {
    const { messages = [] } = req.body;
    
    // We fetch a dummy/default company for the demo.
    const company = await prisma.company.findFirst();
    if (!company) {
      return res.status(500).json({ message: "No company found for demo" });
    }

    // Mock lead object
    const lead = {
      id: "demo-lead",
      companyId: company.id,
      company: company,
      firstName: "Guest",
      lastName: "User",
      email: "demo@example.com"
    };

    const latestMessage = messages[messages.length - 1]?.content || "";

    // KB Retrieval
    let kbChunks = [];
    try {
      kbChunks = await kbQuery(company.id, latestMessage, 5, KB_SCOPES.scheduling, "appointment-agent");
    } catch (e) {
      console.error("[Demo Chat] KB retrieval failed:", e.message);
    }

    // Fetch slots
    const setting = await getAvailabilitySetting(company.id);
    const tz = setting?.timezone || "America/Los_Angeles";
    const s = await getAvailableSlots({ companyId: company.id, agentId: null, days: 14, limit: 8, displayTz: tz });
    const slots = s.map((x) => ({ iso: x.iso, label: x.label }));

    const response = await runClaudeTurn({
      lead,
      company,
      channel: "WEBCHAT",
      transcript: messages,
      slots,
      timezone: tz,
      kbChunks
    });

    return res.json({
      action: response.action,
      message: response.message,
      slot_iso: response.slot_iso
    });

  } catch (error) {
    console.error("[Sales Agent Demo Chat] Error:", error);
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

