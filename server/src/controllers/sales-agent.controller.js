import prisma from "../lib/prisma.js";
import { sendSms } from "../services/sms.service.js";
import { MailService } from "../services/mail-service.js";

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

