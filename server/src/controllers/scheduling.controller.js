import prisma from "../lib/prisma.js";
import * as GoogleCalendar from "../services/google-calendar.service.js";
import {
  getAvailabilitySetting,
  getAvailableSlots,
  bookSlot,
  rescheduleAppointment,
  cancelAppointment,
  resolveAgentId,
  leadTimezone,
  AVAILABILITY_DEFAULTS,
} from "../services/scheduling-service.js";
import { clampMaxTurns } from "../inngest/functions/appointment.js";
import { snapshotSalesConfig } from "../services/sales-config-version.service.js";

const TIME_RE = /^\d{1,2}:\d{2}$/;
function isHomeowner(req) {
  return String(req.user?.role || "").toUpperCase() === "HOMEOWNER";
}

function leadScope(req) {
  return {
    companyId: req.user.companyId,
    ...(isHomeowner(req) ? { ownerId: req.user.id } : {}),
  };
}

export const getSettings = async (req, res) => {
  try {
    if (!req.user?.companyId)
      return res.status(403).json({ message: "No company associated" });
    const companyId = req.user.companyId;

    const setting = await getAvailabilitySetting(companyId);
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { appointmentMode: true, agentMaxTurns: true },
    });

    if (isHomeowner(req)) {
      return res.json({
        setting,
        appointmentMode: company?.appointmentMode || "AI",
        canEditAvailability: false,
      });
    }

    const googleConn = await prisma.calendarConnection.findUnique({
      where: { companyId_provider: { companyId, provider: "GOOGLE" } },
      select: { isActive: true, accountEmail: true },
    });

    return res.json({
      setting,
      appointmentMode: company?.appointmentMode || "AI",
      agentMaxTurns: company?.agentMaxTurns ?? 4,
      canEditAvailability: true,
      googleConfigured: GoogleCalendar.isGoogleConfigured(),
      integrations: {
        google: {
          connected: !!googleConn?.isActive,
          accountEmail: googleConn?.accountEmail || null,
        },
        microsoft: { connected: false, accountEmail: null }, // stub — not yet implemented
      },
    });
  } catch (error) {
    console.error("[Scheduling getSettings] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateSettings = async (req, res) => {
  try {
    if (!req.user?.companyId)
      return res.status(403).json({ message: "No company associated" });
    const companyId = req.user.companyId;
    const {
      dayStart,
      dayEnd,
      bufferMinutes,
      slotDuration,
      workingDays,
      timezone,
      reminderHours,
      appointmentMode,
      agentMaxTurns,
    } = req.body;

    if (dayStart && !TIME_RE.test(dayStart))
      return res.status(400).json({ message: "dayStart must be HH:mm" });
    if (dayEnd && !TIME_RE.test(dayEnd))
      return res.status(400).json({ message: "dayEnd must be HH:mm" });

    const data = {};
    if (dayStart !== undefined) data.dayStart = dayStart;
    if (dayEnd !== undefined) data.dayEnd = dayEnd;
    if (bufferMinutes !== undefined)
      data.bufferMinutes = Math.max(0, parseInt(bufferMinutes, 10) || 0);
    if (slotDuration !== undefined)
      data.slotDuration = Math.max(5, parseInt(slotDuration, 10) || 30);
    if (workingDays !== undefined) data.workingDays = workingDays;
    if (timezone !== undefined) data.timezone = timezone;
    if (Array.isArray(reminderHours))
      data.reminderHours = reminderHours.map(Number).filter((n) => n > 0);

    const setting = await prisma.availabilitySetting.upsert({
      where: { companyId },
      create: { companyId, ...AVAILABILITY_DEFAULTS, ...data },
      update: data,
    });

    const companyData = {};
    if (appointmentMode && ["OFF", "SIMPLE", "AI"].includes(appointmentMode)) {
      companyData.appointmentMode = appointmentMode;
    }
    if (agentMaxTurns !== undefined) {
      companyData.agentMaxTurns = clampMaxTurns(agentMaxTurns);
    }
    if (Object.keys(companyData).length > 0) {
      await prisma.company.update({
        where: { id: companyId },
        data: companyData,
      });
      // SW-KB-007: snapshot the updated agent toggles for rollback.
      await snapshotSalesConfig(companyId, {
        changeType: "SAVE",
        note: "Agent behavior toggles updated",
        userId: req.user.id,
      });
    }

    return res.json({
      setting,
      appointmentMode: companyData.appointmentMode,
      agentMaxTurns: companyData.agentMaxTurns,
    });
  } catch (error) {
    console.error("[Scheduling updateSettings] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getSlots = async (req, res) => {
  try {
    if (!req.user?.companyId)
      return res.status(403).json({ message: "No company associated" });
    const { leadId, days, limit } = req.query;
    let agentId = isHomeowner(req) ? req.user.id : req.query.agentId;
    let displayTz;
    if (leadId) {
      const lead = await prisma.lead.findFirst({
        where: { id: leadId, ...leadScope(req) },
      });
      if (lead) {
        agentId = agentId || (await resolveAgentId(lead));
        const setting = await getAvailabilitySetting(req.user.companyId);
        displayTz = leadTimezone(lead, setting);
      }
    }

    const slots = await getAvailableSlots({
      companyId: req.user.companyId,
      agentId,
      days: days ? parseInt(days, 10) : 14,
      limit: limit ? parseInt(limit, 10) : 24,
      displayTz,
    });
    return res.json({ slots });
  } catch (error) {
    console.error("[Scheduling getSlots] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const staffReschedule = async (req, res) => {
  try {
    if (!req.user?.companyId)
      return res.status(403).json({ message: "No company associated" });
    const { appointmentId, startTime, durationMinutes } = req.body;
    if (!appointmentId || !startTime)
      return res
        .status(400)
        .json({ message: "appointmentId and startTime required" });

    const appt = await prisma.salesAppointment.findFirst({
      where: { id: appointmentId, lead: leadScope(req) },
    });
    if (!appt)
      return res.status(404).json({ message: "Appointment not found" });

    const result = await rescheduleAppointment({
      appointmentId,
      newStartTime: startTime,
      durationMinutes,
    });
    if (!result.success)
      return res.status(result.conflict ? 409 : 400).json(result);
    return res.json(result);
  } catch (error) {
    console.error("[Scheduling staffReschedule] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const staffCancel = async (req, res) => {
  try {
    if (!req.user?.companyId)
      return res.status(403).json({ message: "No company associated" });
    const { appointmentId, reason } = req.body;
    if (!appointmentId)
      return res.status(400).json({ message: "appointmentId required" });

    const appt = await prisma.salesAppointment.findFirst({
      where: { id: appointmentId, lead: leadScope(req) },
    });
    if (!appt)
      return res.status(404).json({ message: "Appointment not found" });

    const result = await cancelAppointment({
      appointmentId,
      reason:
        reason ||
        (isHomeowner(req) ? "Cancelled by lead owner" : "Cancelled by staff"),
    });
    return res.json(result);
  } catch (error) {
    console.error("[Scheduling staffCancel] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const googleConnect = async (req, res) => {
  try {
    if (!req.user?.companyId)
      return res.status(403).json({ message: "No company associated" });
    if (!GoogleCalendar.isGoogleConfigured()) {
      return res
        .status(400)
        .json({
          message:
            "Google Calendar is not configured on the server (missing GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI).",
        });
    }
    const url = GoogleCalendar.getAuthUrl(req.user.companyId);
    return res.json({ url });
  } catch (error) {
    console.error("[Scheduling googleConnect] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const googleCallback = async (req, res) => {
  const portal = process.env.NEXT_PUBLIC_URL || "http://localhost:3000";
  const back = (status) =>
    res.redirect(`${portal}/sales/scheduling?tab=settings&google=${status}`);
  try {
    const { code, state, error } = req.query;
    if (error) return back("denied");
    if (!code || !state) return back("error");
    await GoogleCalendar.exchangeCodeAndStore(state, code);
    return back("connected");
  } catch (e) {
    console.error("[Scheduling googleCallback] Error:", e);
    return back("error");
  }
};

export const googleDisconnect = async (req, res) => {
  try {
    if (!req.user?.companyId)
      return res.status(403).json({ message: "No company associated" });
    await GoogleCalendar.disconnect(req.user.companyId);
    return res.json({ success: true });
  } catch (error) {
    console.error("[Scheduling googleDisconnect] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const publicGetBooking = async (req, res) => {
  try {
    const { leadId } = req.params;
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: { company: { select: { name: true } } },
    });
    if (!lead) return res.status(404).json({ message: "Booking not found" });

    const setting = await getAvailabilitySetting(lead.companyId);
    const agentId = await resolveAgentId(lead);
    const displayTz = leadTimezone(lead, setting);
    const slots = await getAvailableSlots({
      companyId: lead.companyId,
      agentId,
      days: 14,
      limit: 30,
      displayTz,
    });

    return res.json({
      lead: { firstName: lead.firstName, lastName: lead.lastName },
      company: { name: lead.company?.name || "Our team" },
      timezone: displayTz,
      slotDuration: setting.slotDuration,
      slots,
    });
  } catch (error) {
    console.error("[Scheduling publicGetBooking] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const publicBook = async (req, res) => {
  try {
    const { leadId, startTime, locationType, title } = req.body;
    if (!leadId || !startTime)
      return res.status(400).json({ message: "leadId and startTime required" });

    const result = await bookSlot({
      leadId,
      startTime,
      title: title || "Model Home Visit",
      locationType: locationType || "VIRTUAL",
      bookedVia: "SELF",
    });
    if (!result.success)
      return res.status(result.conflict ? 409 : 400).json(result);
    return res.status(201).json({
      success: true,
      appointment: {
        id: result.appointment.id,
        time: result.appointment.time,
        title: result.appointment.title,
        meetingLink: result.appointment.meetingLink,
        manageToken: result.appointment.rescheduleToken,
      },
    });
  } catch (error) {
    console.error("[Scheduling publicBook] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const publicGetManage = async (req, res) => {
  try {
    const { token } = req.params;
    const appt = await prisma.salesAppointment.findUnique({
      where: { rescheduleToken: token },
      include: { lead: { include: { company: { select: { name: true } } } } },
    });
    if (!appt)
      return res.status(404).json({ message: "Appointment not found" });

    const setting = await getAvailabilitySetting(appt.lead.companyId);
    const displayTz = appt.leadTimezone || leadTimezone(appt.lead, setting);
    const slots = await getAvailableSlots({
      companyId: appt.lead.companyId,
      agentId: appt.agentId,
      days: 14,
      limit: 30,
      displayTz,
    });

    return res.json({
      appointment: {
        id: appt.id,
        title: appt.title,
        time: appt.time,
        meetingLink: appt.meetingLink,
        cancelToken: appt.cancelToken,
        status: appt.status,
      },
      company: { name: appt.lead.company?.name || "Our team" },
      timezone: displayTz,
      slots,
    });
  } catch (error) {
    console.error("[Scheduling publicGetManage] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const publicReschedule = async (req, res) => {
  try {
    const { token, startTime } = req.body;
    if (!token || !startTime)
      return res.status(400).json({ message: "token and startTime required" });
    const result = await rescheduleAppointment({
      rescheduleToken: token,
      newStartTime: startTime,
    });
    if (!result.success)
      return res.status(result.conflict ? 409 : 400).json(result);
    return res.json({
      success: true,
      time: result.appointment.time,
      meetingLink: result.appointment.meetingLink,
    });
  } catch (error) {
    console.error("[Scheduling publicReschedule] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const publicCancel = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: "token required" });
    const result = await cancelAppointment({
      cancelToken: token,
      reason: "Cancelled by lead",
    });
    if (!result.success) return res.status(404).json(result);
    return res.json({ success: true });
  } catch (error) {
    console.error("[Scheduling publicCancel] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
