import prisma from "../lib/prisma.js";
import { computeAvailableSlots, formatSlotLabel } from "../lib/scheduling.js";
import { getLeadTimezone } from "../lib/timezone.js";
import * as GoogleCalendar from "./google-calendar.service.js";
import { MailService } from "./mail-service.js";
import { sendSms } from "./sms.service.js";
import { ComplianceService } from "./compliance-service.js";
import { getMessagingConfig } from "../lib/messaging-config.js";
import { triggerAutomation } from "../lib/automation-events.js";
import { writeBackLeadToSalesforce } from "./salesforce-writeback.js";

const DEFAULTS = {
  dayStart: "09:00",
  dayEnd: "17:00",
  bufferMinutes: 15,
  slotDuration: 30,
  workingDays: "Mon,Tue,Wed,Thu,Fri",
  timezone: "America/New_York",
  reminderHours: [24, 1],
};

const MIN_LEAD_MINUTES = 60;

export async function getAvailabilitySetting(companyId) {
  const existing = await prisma.availabilitySetting.findUnique({ where: { companyId } });
  return existing || { companyId, ...DEFAULTS, appointmentTypes: null };
}

export async function resolveAgentId(lead) {
  if (lead.ownerId) return lead.ownerId;
  const company = await prisma.company.findUnique({
    where: { id: lead.companyId },
    include: { users: true },
  });
  return company?.defaultLeadOwner || company?.users.find((u) => u.role === "ADMIN")?.id || null;
}

export function leadTimezone(lead, setting) {
  if (lead?.state) return getLeadTimezone(lead.state);
  return setting?.timezone || DEFAULTS.timezone;
}


export async function getAvailableSlots({ companyId, agentId, from, days = 14, limit = 12, displayTz }) {
  const setting = await getAvailabilitySetting(companyId);
  const start = from ? new Date(from) : new Date(Date.now() + MIN_LEAD_MINUTES * 60000);
  const horizonEnd = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);

  const busy = [];

  if (agentId) {
    const appts = await prisma.salesAppointment.findMany({
      where: {
        agentId,
        status: { not: "CANCELLED" },
        time: { gte: start, lte: horizonEnd },
      },
      select: { time: true, endTime: true, durationMinutes: true },
    });
    for (const a of appts) {
      const s = a.time;
      const e = a.endTime || new Date(s.getTime() + (a.durationMinutes || setting.slotDuration) * 60000);
      busy.push({ start: s, end: e });
    }
  }

  try {
    const gbusy = await GoogleCalendar.getBusyIntervals(companyId, start, horizonEnd);
    busy.push(...gbusy);
  } catch {
    /* ignore */
  }

  const slots = computeAvailableSlots({ setting, from: start, days, busy, limit });
  const tz = displayTz || setting.timezone;
  return slots.map((s) => ({ start: s, iso: s.toISOString(), label: formatSlotLabel(s, tz) }));
}

export async function bookSlot({
  leadId,
  startTime,
  durationMinutes,
  title,
  locationType = "VIRTUAL",
  agentId,
  bookedVia = "STAFF",
  notes = null,
}) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { company: true } });
  if (!lead) return { success: false, reason: "Lead not found" };

  const setting = await getAvailabilitySetting(lead.companyId);
  const start = new Date(startTime);
  if (isNaN(start.getTime())) return { success: false, reason: "Invalid start time" };
  if (start.getTime() < Date.now()) return { success: false, reason: "Slot is in the past" };

  const duration = durationMinutes || setting.slotDuration || 30;
  const end = new Date(start.getTime() + duration * 60000);

  const resolvedAgentId = agentId || (await resolveAgentId(lead));
  if (!resolvedAgentId) return { success: false, reason: "No agent available to assign" };

  const tz = leadTimezone(lead, setting);
  const apptTitle = title || "Sales Appointment";


  let appointment;
  try {
    appointment = await prisma.salesAppointment.create({
      data: {
        leadId,
        title: apptTitle,
        time: start,
        endTime: end,
        durationMinutes: duration,
        status: "CONFIRMED",
        locationType,
        agentId: resolvedAgentId,
        bookedVia,
        notes,
        leadTimezone: tz,
      },
    });
  } catch (e) {
    if (e?.code === "P2002") {
      return { success: false, conflict: true, reason: "That time was just taken." };
    }
    console.error("[Scheduling] book reservation failed:", e);
    return { success: false, reason: "Could not reserve the slot" };
  }

  let meetingLink = null;
  let googleEventId = null;
  if (locationType === "VIRTUAL") {
    const agent = await prisma.user.findUnique({ where: { id: resolvedAgentId }, select: { email: true, name: true } });
    const ev = await GoogleCalendar.createEventWithMeet(lead.companyId, {
      summary: `${apptTitle} — ${lead.firstName} ${lead.lastName}`,
      description: `Sales appointment with ${lead.firstName} ${lead.lastName}.${notes ? `\n\nNotes: ${notes}` : ""}`,
      start,
      end,
      timezone: tz,
      attendees: [lead.email, agent?.email],
    });
    if (ev) {
      meetingLink = ev.meetLink;
      googleEventId = ev.eventId;
      appointment = await prisma.salesAppointment.update({
        where: { id: appointment.id },
        data: { meetingLink, googleEventId },
      });
    }
  }

  await prisma.lead.update({ where: { id: leadId }, data: { status: "Appointment Set" } });
  await prisma.leadTimeline.create({
    data: {
      leadId,
      type: "APPOINTMENT_SET",
      description: `Booked "${apptTitle}" for ${formatSlotLabel(start, tz)}${bookedVia === "AI_AGENT" ? " (AI agent)" : ""}`,
      metadata: { appointmentId: appointment.id, time: start.toISOString(), meetingLink, bookedVia },
    },
  });

  try {
    const { inngest } = await import("../lib/inngest.js");
    await inngest.send({ name: "campaign.exit", data: { leadId, reason: "APPOINTMENT" } });
  } catch (e) {
    console.error("[Scheduling] failed to emit campaign.exit:", e.message);
  }

  await sendConfirmations(lead, appointment, tz).catch((e) =>
    console.error("[Scheduling] confirmation send failed:", e.message)
  );

  // SW-AMK: fire the APPOINTMENT_BOOKED automation trigger (best-effort).
  await triggerAutomation({
    companyId: lead.companyId,
    leadId,
    event: "APPOINTMENT_BOOKED",
    context: { appointmentId: appointment.id, bookedVia },
  });

  // SW-CRM-008: reflect the new status on the Salesforce record (gated per tenant).
  writeBackLeadToSalesforce(lead.companyId, leadId, { status: "Appointment Set" }).catch((e) =>
    console.error("[Scheduling] Salesforce write-back failed:", e?.message || e),
  );

  return { success: true, appointment };
}

async function sendConfirmations(lead, appointment, tz) {
  const when = formatSlotLabel(appointment.time, tz);
  const meet = appointment.meetingLink;
  const portal = process.env.NEXT_PUBLIC_URL || "http://localhost:3000";
  const rescheduleUrl = `${portal}/book/manage/${appointment.rescheduleToken}`;
  const { smtpConfig, smsConfig } = await getMessagingConfig(lead.companyId);

  if (lead.email) {
    const html = `
      <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #eaeaea;border-radius:12px;overflow:hidden;">
        <div style="background:#0F3B3D;padding:28px 40px;text-align:center;border-bottom:3px solid #b48c3c;">
          <h1 style="color:#fff;margin:0;font-size:22px;">Appointment Confirmed</h1>
        </div>
        <div style="padding:36px 40px;color:#334155;line-height:1.7;font-size:16px;">
          <p>Hi ${lead.firstName},</p>
          <p>Your <strong>${appointment.title}</strong> is confirmed for:</p>
          <p style="font-size:18px;font-weight:600;color:#0F3B3D;">${when}</p>
          ${meet ? `<p>Join the video meeting here:<br/><a href="${meet}" style="color:#b48c3c;font-weight:600;">${meet}</a></p>` : ""}
          <p style="margin-top:24px;font-size:14px;color:#64748b;">Need to change it? <a href="${rescheduleUrl}" style="color:#b48c3c;">Reschedule or cancel</a>.</p>
        </div>
      </div>`;
    await MailService.sendEmail({
      to: lead.email,
      subject: `Confirmed: ${appointment.title} — ${when}`,
      html,
      fromName: lead.company?.name || undefined,
      smtpConfig,
    });
  }

  if (lead.phone) {
    const body = ComplianceService.addSmsOptOutSuffix(
      `Your ${appointment.title} is confirmed for ${when}.${meet ? ` Join: ${meet}` : ""} Manage: ${rescheduleUrl}`
    );
    await sendSms({ to: lead.phone, body, smsConfig }).catch(() => { });
  }
}

export async function rescheduleAppointment({ appointmentId, rescheduleToken, newStartTime, durationMinutes }) {
  const where = appointmentId ? { id: appointmentId } : { rescheduleToken };
  const appt = await prisma.salesAppointment.findUnique({ where, include: { lead: { include: { company: true } } } });
  if (!appt) return { success: false, reason: "Appointment not found" };

  const start = new Date(newStartTime);
  if (isNaN(start.getTime()) || start.getTime() < Date.now()) {
    return { success: false, reason: "Invalid or past start time" };
  }
  const duration = durationMinutes || appt.durationMinutes || 30;
  const end = new Date(start.getTime() + duration * 60000);

  let updated;
  try {
    updated = await prisma.salesAppointment.update({
      where: { id: appt.id },
      data: {
        time: start,
        endTime: end,
        durationMinutes: duration,
        status: "CONFIRMED",
        reminder24Sent: false,
        reminder1Sent: false,
      },
    });
  } catch (e) {
    if (e?.code === "P2002") return { success: false, conflict: true, reason: "That time is taken." };
    console.error("[Scheduling] reschedule failed:", e);
    return { success: false, reason: "Could not reschedule" };
  }

  const tz = appt.leadTimezone || (await getAvailabilitySetting(appt.lead.companyId)).timezone;
  if (appt.googleEventId) {
    await GoogleCalendar.updateEventTime(appt.lead.companyId, appt.googleEventId, { start, end, timezone: tz });
  }

  await prisma.leadTimeline.create({
    data: {
      leadId: appt.leadId,
      type: "APPOINTMENT_SET",
      description: `Rescheduled "${appt.title}" to ${formatSlotLabel(start, tz)}`,
      metadata: { appointmentId: appt.id, time: start.toISOString() },
    },
  });

  await sendConfirmations(appt.lead, updated, tz).catch(() => { });
  return { success: true, appointment: updated };
}

export async function cancelAppointment({ appointmentId, cancelToken, reason = "Cancelled" }) {
  const where = appointmentId ? { id: appointmentId } : { cancelToken };
  const appt = await prisma.salesAppointment.findUnique({ where, include: { lead: { include: { company: true } } } });
  if (!appt) return { success: false, reason: "Appointment not found" };

  const tz = appt.leadTimezone || (await getAvailabilitySetting(appt.lead.companyId)).timezone;
  if (appt.googleEventId) {
    await GoogleCalendar.deleteEvent(appt.lead.companyId, appt.googleEventId);
  }

  await prisma.salesAppointment.delete({ where: { id: appt.id } });

  await prisma.leadTimeline.create({
    data: {
      leadId: appt.leadId,
      type: "SYNC_UPDATE",
      description: `Cancelled "${appt.title}" (${formatSlotLabel(appt.time, tz)}). Reason: ${reason}`,
      metadata: { time: appt.time.toISOString(), reason },
    },
  });

  try {
    const { smtpConfig, smsConfig } = await getMessagingConfig(appt.lead.companyId);
    const when = formatSlotLabel(appt.time, tz);
    if (appt.lead.email) {
      await MailService.sendEmail({
        to: appt.lead.email,
        subject: `Cancelled: ${appt.title} — ${when}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <p>Hi ${appt.lead.firstName},</p>
          <p>Your <strong>${appt.title}</strong> scheduled for <strong>${when}</strong> has been cancelled.</p>
          <p>Reply to this email if you'd like to rebook — we're happy to find another time.</p>
        </div>`,
        fromName: appt.lead.company?.name || undefined,
        smtpConfig,
      });
    }
    if (appt.lead.phone) {
      await sendSms({
        to: appt.lead.phone,
        body: ComplianceService.addSmsOptOutSuffix(`Your ${appt.title} for ${when} has been cancelled. Reply to rebook.`),
        smsConfig,
      }).catch(() => { });
    }
  } catch (e) {
    console.error("[Scheduling] cancel notification failed:", e.message);
  }

  return { success: true };
}

export { DEFAULTS as AVAILABILITY_DEFAULTS, MIN_LEAD_MINUTES };
