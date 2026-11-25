// Mirrors Super Admin meetings into the assigned person's Google/Outlook calendar.
// A meeting is due when it changed since its last sync; each run works through the due ones.
import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { appUrl, getB2BAvailability } from "../../lib/b2b.js";
import { deleteEvent, upsertEvent } from "../../services/admin-calendar.service.js";

const BATCH = 50;

function details(meeting, setting) {
  const start = meeting.startTime;
  const who = meeting.b2bLead?.companyName || meeting.name;
  const source = meeting.source === "WEBSITE_SALES" ? "Website chat" : meeting.campaignName ? `Campaign: ${meeting.campaignName}` : "Booking link";
  return {
    title: `Product Consultation: ${who}`,
    start,
    end: new Date(start.getTime() + setting.slotDuration * 60_000),
    location: meeting.meetingUrl || setting.meetingLink || "",
    description: [
      `Contact: ${meeting.name}`,
      meeting.b2bLead?.companyName ? `Company: ${meeting.b2bLead.companyName}` : "",
      `Email: ${meeting.email}`,
      meeting.phone ? `Phone: ${meeting.phone}` : "",
      `Booked via: ${source}`,
      `Status: ${meeting.status}`,
      "",
      `Manage it in AI4Home: ${appUrl()}/admin/sales-agent-appointments`,
    ].filter((line, i, all) => line || all[i - 1]).join("\n"),
  };
}

async function syncMeeting(id, setting, connections) {
  const meeting = await prisma.salesAgentAppointment.findUnique({ where: { id }, include: { b2bLead: { select: { companyName: true } } } });
  if (!meeting) return;
  const ownerId = meeting.assignedUserId && meeting.startTime && meeting.status !== "CANCELLED" ? meeting.assignedUserId : null;
  const target = ownerId ? connections.get(ownerId) : null;
  let eventId = meeting.calendarEventId;
  let eventOwner = meeting.calendarOwnerId;

  // Reassigned, cancelled, or its owner disconnected: take it off the old calendar.
  if (eventId && eventOwner !== (target ? ownerId : null)) {
    const old = connections.get(eventOwner);
    if (old) await deleteEvent(old, eventId);
    eventId = null;
    eventOwner = null;
  }
  if (target) {
    eventId = await upsertEvent(target, eventId, details(meeting, setting));
    eventOwner = ownerId;
  }
  // Raw, so updatedAt (which other syncs watch) is left alone; synced up to this read, so a change
  // made meanwhile is still due next time.
  await prisma.$executeRaw`UPDATE "SalesAgentAppointment" SET "calendarEventId" = ${eventId}, "calendarOwnerId" = ${eventOwner}, "calendarSyncedAt" = ${meeting.updatedAt} WHERE id = ${id}`;
}

export const adminCalendarSync = inngest.createFunction(
  // One run at a time, so a meeting is never written twice as two events.
  { id: "admin-calendar-sync", concurrency: 1, triggers: [{ event: "admin-calendar/sync" }, { cron: "*/5 * * * *" }] },
  async ({ step }) => {
    let synced = 0;
    const failed = [];
    for (let round = 0; round < 10; round++) {
      const result = await step.run(`sync-${round}`, async () => {
        const due = await prisma.$queryRaw`SELECT id FROM "SalesAgentAppointment" WHERE ("calendarSyncedAt" IS NULL OR "updatedAt" > "calendarSyncedAt") AND id <> ALL(${failed}::text[]) ORDER BY "updatedAt" ASC LIMIT ${BATCH}`;
        if (!due.length) return { done: 0, errors: [], more: false };
        const setting = await getB2BAvailability();
        const connections = new Map((await prisma.adminCalendarConnection.findMany()).map((c) => [c.userId, c]));
        const errors = [];
        for (const { id } of due) {
          try {
            await syncMeeting(id, setting, connections);
          } catch (e) {
            // Left due: the next run tries again.
            console.error(`[Admin calendar] sync of meeting ${id} failed:`, e.message);
            errors.push(id);
          }
        }
        return { done: due.length - errors.length, errors, more: due.length === BATCH };
      });
      synced += result.done;
      failed.push(...result.errors);
      if (!result.more) break;
    }
    return { synced, failed: failed.length };
  },
);
