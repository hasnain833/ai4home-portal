import prisma from "../lib/prisma.js";
import { triggerAutomation } from "../lib/automation-events.js";
import { writeBackLeadToSalesforce } from "../services/salesforce-writeback.js";
import { appointmentTokenData, getOrCreateLeadBookingToken } from "../lib/public-tokens.js";
import { LEAD_STATUS } from "../lib/lead-statuses.js";

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
    const companyId = req.user?.companyId;

    if (!leadId || !title || !time) {
      return res
        .status(400)
        .json({ message: "Missing required fields: leadId, title, time" });
    }
    if (!companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const lead = await prisma.lead.findFirst({
      where: { id: leadId, companyId },
    });
    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    let assignedAgentId = agentId;
    if (!assignedAgentId) {
      if (lead?.ownerId) {
        assignedAgentId = lead.ownerId;
      } else {
        const company = await prisma.company.findUnique({
          where: { id: lead.companyId },
          include: { users: true },
        });
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

    const assignedAgent = await prisma.user.findFirst({
      where: { id: assignedAgentId, companyId },
      select: { id: true },
    });
    if (!assignedAgent) {
      return res.status(400).json({ message: "Assigned agent is not available for this company." });
    }

    const appointment = await prisma.salesAppointment.create({
      data: {
        leadId,
        title,
        time: new Date(time),
        agentId: assignedAgentId,
        status: "CONFIRMED",
        ...appointmentTokenData(),
      },
    });

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        status: LEAD_STATUS.APPOINTMENT_SET,
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
        status: LEAD_STATUS.APPOINTMENT_SET,
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
    if (!req.user?.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }
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
    const { leadId } = req.body;
    const companyId = req.user?.companyId;

    if (!leadId) {
      return res.status(400).json({ message: "leadId is required" });
    }
    if (!companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const lead = await prisma.lead.findFirst({
      where: { id: leadId, companyId },
    });

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    const bookingToken = await getOrCreateLeadBookingToken(leadId);

    return res.json({
      success: true,
      message: "CTA click recorded",
      bookingUrl: `${process.env.NEXT_PUBLIC_URL || ""}/book/${bookingToken}`,
    });
  } catch (error) {
    console.error("[CTA Trigger] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
