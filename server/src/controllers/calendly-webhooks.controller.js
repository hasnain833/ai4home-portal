import { randomUUID } from "node:crypto";
import prisma from "../lib/prisma.js";
import { verifyCalendlySignature } from "../services/calendly.service.js";
import {
  notifyAppointmentScheduled,
  notifyAppointmentCancelled,
} from "../services/ticket-appointment-service.js";

const eventOfInvitee = (inviteeUri) => String(inviteeUri || "").split("/invitees/")[0] || null;

export async function handleCalendlyEvent({ event, payload } = {}) {
  const eventUri = payload?.scheduled_event?.uri || payload?.event || eventOfInvitee(payload?.uri);
  if (!eventUri) return "ignored";

  if (event === "invitee.canceled") {
    if (payload.rescheduled) return "ignored";

    const visit = await prisma.ticketAppointment.findFirst({
      where: { calendlyEventUri: eventUri, status: "SCHEDULED" },
      include: { ticket: { select: { id: true, status: true, bookingToken: true } } },
    });
    if (!visit) return "ignored";

    const reason = payload.cancellation?.reason?.trim();
    const by = payload.cancellation?.canceler_type === "host" ? "the trade" : "the homeowner";
    await prisma.ticketAppointment.update({
      where: { id: visit.id },
      data: {
        status: "CANCELLED",
        notes: `${visit.notes ? `${visit.notes}\n\n` : ""}[Cancelled in Calendly by ${by}]${reason ? ` ${reason.slice(0, 500)}` : ""}`,
      },
    });
    if (visit.ticket?.status !== "RESOLVED") {
      await prisma.ticket.update({
        where: { id: visit.ticketId },
        data: { bookingToken: visit.ticket?.bookingToken || randomUUID() },
      });
    }
    await notifyAppointmentCancelled(visit.id);
    return "cancelled";
  }

  if (event === "invitee.created") {
    const oldEventUri = eventOfInvitee(payload.old_invitee);
    if (!oldEventUri) return "ignored";

    const visit = await prisma.ticketAppointment.findFirst({
      where: { calendlyEventUri: oldEventUri, status: "SCHEDULED" },
    });
    if (!visit) return "ignored";

    const start = new Date(payload.scheduled_event?.start_time);
    const end = new Date(payload.scheduled_event?.end_time);
    if (Number.isNaN(start.getTime())) return "ignored";
    await prisma.ticketAppointment.update({
      where: { id: visit.id },
      data: {
        scheduledAt: start,
        durationMinutes: Number.isNaN(end.getTime())
          ? visit.durationMinutes
          : Math.round((end.getTime() - start.getTime()) / 60000),
        calendlyEventUri: eventUri,
        remindersSent: [],
        rescheduleCount: { increment: 1 },
      },
    });
    await notifyAppointmentScheduled(visit.id, { rescheduled: true });
    return "rescheduled";
  }

  return "ignored";
}

export const calendlyWebhook = async (req, res) => {
  const signature = req.get("Calendly-Webhook-Signature");
  if (!verifyCalendlySignature(signature, req.rawBody?.toString("utf8"))) {
    return res.status(401).json({ message: "Invalid signature" });
  }
  try {
    const result = await handleCalendlyEvent(req.body);
    if (result !== "ignored") console.log(`[Calendly webhook] ${req.body?.event}: ${result}`);
    return res.json({ ok: true, result });
  } catch (error) {
    // Non-2xx so Calendly delivers it again.
    console.error("[Calendly webhook] failed:", error);
    return res.status(500).json({ message: "Could not process the event" });
  }
};
