import prisma from "../lib/prisma.js";
import { triggerAutomation } from "../lib/automation-events.js";
import { writeBackLeadToSalesforce } from "../services/salesforce-writeback.js";

export const getAppointments = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const companyId = req.user.companyId;
    const isHomeowner =
      String(req.user.role || "").toUpperCase() === "HOMEOWNER";

    const appointments = await prisma.salesAppointment.findMany({
      where: {
        lead: { companyId, ...(isHomeowner ? { ownerId: req.user.id } : {}) },
      },
      include: {
        lead: {
          select: { firstName: true, lastName: true, email: true, phone: true },
        },
        agent: {
          select: { name: true, email: true },
        },
      },
      orderBy: { time: "asc" },
    });

    return res.json(appointments);
  } catch (error) {
    console.error("[Appointments GET] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const bookAppointment = async (req, res) => {
  try {
    const { leadId, title, time, agentId } = req.body;

    if (!leadId || !title || !time) {
      return res
        .status(400)
        .json({ message: "Missing required fields: leadId, title, time" });
    }

    let assignedAgentId = agentId;
    if (!assignedAgentId) {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
      });
      if (lead?.ownerId) {
        assignedAgentId = lead.ownerId;
      } else {
        const company = lead
          ? await prisma.company.findUnique({
              where: { id: lead.companyId },
              include: { users: true },
            })
          : null;
        const fallback =
          company?.defaultLeadOwner ||
          company?.users.find((u) => u.role === "ADMIN")?.id;
        if (!fallback) {
          return res
            .status(400)
            .json({ message: "No agent available to assign appointment." });
        }
        assignedAgentId = fallback;
      }
    }

    const appointment = await prisma.salesAppointment.create({
      data: {
        leadId,
        title,
        time: new Date(time),
        agentId: assignedAgentId,
        status: "CONFIRMED",
      },
    });

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        status: "Appointment Set",
      },
    });

    await prisma.leadTimeline.create({
      data: {
        leadId,
        type: "APPOINTMENT_SET",
        description: `Scheduled appointment: "${title}" for ${new Date(time).toLocaleString()}`,
        metadata: { appointmentId: appointment.id, time },
      },
    });

    const { inngest } = await import("../lib/inngest.js");
    await inngest.send({
      name: "campaign.exit",
      data: {
        leadId,
        reason: "APPOINTMENT",
      },
    });

    const apptLead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { companyId: true },
    });
    if (apptLead?.companyId) {
      await triggerAutomation({
        companyId: apptLead.companyId,
        leadId,
        event: "APPOINTMENT_BOOKED",
        context: { appointmentId: appointment.id, bookedVia: "CTA" },
      });
      writeBackLeadToSalesforce(apptLead.companyId, leadId, {
        status: "Appointment Set",
      }).catch((e) =>
        console.error(
          "[Appointment Book] Salesforce write-back failed:",
          e?.message || e,
        ),
      );
    }

    return res.status(201).json(appointment);
  } catch (error) {
    console.error("[Appointment Book] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getSlots = async (req, res) => {
  try {
    const { date } = req.query;
    const queryDate = date ? new Date(date) : new Date();
    const slots = [];
    const baseHour = 9;
    for (let i = 0; i < 8; i++) {
      const hour = baseHour + i;
      const timeString = `${hour.toString().padStart(2, "0")}:00`;
      slots.push({
        time: timeString,
        available: true,
        dateTimeString: new Date(
          queryDate.setHours(hour, 0, 0, 0),
        ).toISOString(),
      });
    }

    return res.json(slots);
  } catch (error) {
    console.error("[Get Slots] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const triggerCta = async (req, res) => {
  try {
    const { leadId, ctaType } = req.body;

    if (!leadId) {
      return res.status(400).json({ message: "leadId is required" });
    }

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
    });

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    await prisma.leadTimeline.create({
      data: {
        leadId,
        type: "SYNC_UPDATE",
        description: `Lead clicked nurture campaign CTA: "${ctaType || "Booking AppointmentLink"}"`,
        metadata: { ctaType, clickedAt: new Date() },
      },
    });

    return res.json({
      success: true,
      message: "CTA click recorded",
      bookingUrl: `${process.env.NEXT_PUBLIC_URL || "http://localhost:3000"}/sales/scheduling?leadId=${leadId}`,
    });
  } catch (error) {
    console.error("[CTA Trigger] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
