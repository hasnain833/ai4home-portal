// Two-way sync between Business Leads and AI4Home's own Salesforce org.
//   Salesforce Lead  <-> B2BLead (details, status, opt-outs, links, next meeting; deletes both ways)
//   Salesforce Event <-> demo meetings (deleting the Event in Salesforce cancels the meeting)
//   Salesforce Task  <-  every message in the conversation
// A record is due when its updatedAt is newer than salesforceSyncedAt. Every write path in the
// portal bumps updatedAt, so nothing has to remember to call the sync.
import { createHash } from "crypto";
import prisma from "../lib/prisma.js";
import { appUrl, bookingLinkFor, completeFinishedCampaigns, getB2BAvailability, B2B_LEAD_STATUSES } from "../lib/b2b.js";
import { platformCalendlyPointer } from "../lib/platform-calendly.js";
import { findCalendlyConnection } from "../lib/calendly-connection.js";
import { calendlyEventLocation } from "./calendly.service.js";
import { updatePlatformAppointment } from "./website-sales.js";
import { journeyOnMeetingStatus } from "../lib/b2b-journey.js";
import { toE164 } from "./sms.service.js";
import {
  platformSalesforceClient,
  platformSalesforceSettings,
  platformSalesforceSyncState,
  savePlatformSalesforceSyncState,
} from "../lib/platform-salesforce.js";

const API = "/services/data/v59.0";
export const BATCH = 50;
const TASK_BATCH = 200; // the most one sObject Collections call takes
const PULL_BATCH = 200;
// Set on a meeting whose Event someone deleted in Salesforce, so it isn't made again.
const DELETED_IN_SALESFORCE = "DELETED";

/** Optional fields AI4Home can add to the Lead object; each one found is kept up to date. */
export const CUSTOM_LEAD_FIELDS = [
  { name: "AI4HB_Portal_Link__c", type: "URL", label: "AI4HB Portal Link", note: "Opens the lead in the AI4Home portal" },
  { name: "AI4HB_Booking_Link__c", type: "URL", label: "AI4HB Booking Link", note: "The lead's personal link to book or move a demo" },
  { name: "AI4HB_Next_Meeting__c", type: "Date/Time", label: "AI4HB Next Meeting", note: "Date and time of the next confirmed demo" },
  { name: "AI4HB_Meeting_Link__c", type: "URL", label: "AI4HB Meeting Link", note: "Where to join the next demo (video link, or address/phone)" },
  { name: "AI4HB_Journey_Stage__c", type: "Text(40)", label: "AI4HB Journey Stage", note: "Where the lead is in the nurture journey" },
  { name: "AI4HB_SMS_Opt_Out__c", type: "Checkbox", label: "AI4HB SMS Opt Out", note: "Opted out of texts (synced both ways)" },
  { name: "AI4HB_Source__c", type: "Text(40)", label: "AI4HB Source", note: "Where the lead came from" },
];

const hash = (value) => createHash("sha1").update(JSON.stringify(value)).digest("hex");
const soqlString = (v) => `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const soqlDate = (d) => new Date(d).toISOString().replace("Z", "+00:00");
const short = (e) => String(e?.message || e).replace(/^Salesforce API error \(\d+\): /, "").slice(0, 300);
const gone = (e) => /ENTITY_IS_DELETED|NOT_FOUND|INVALID_CROSS_REFERENCE_KEY/.test(String(e?.message));
// Session, permission, limit or outage: stop the run rather than mark records done.
const fatal = (e) => {
  if (String(e?.code || "").startsWith("P")) return false; // a database error about this one record
  const status = Number(String(e?.message).match(/\((\d{3})\)/)?.[1]);
  return !status || status === 401 || status === 403 || status === 429 || status >= 500;
};
export const portalLink = (leadId) => `${appUrl()}/admin/leads?lead=${encodeURIComponent(leadId)}`;

/** Lead fields this Salesforce user can see, with what they may do to each. Keys are lowercase. */
export async function leadFields(client) {
  const describe = await client.apiRequest(`${API}/sobjects/Lead/describe`);
  return new Map((describe.fields || []).map((f) => [f.name.toLowerCase(), { name: f.name, createable: f.createable, updateable: f.updateable }]));
}

/** The Lead Status picklist, without the "converted" values a Lead can't be set to directly. */
export async function leadStatuses(client) {
  const run = (soql) => client.query(soql).then((r) => r.records || []);
  const rows = await run("SELECT ApiName, MasterLabel, IsConverted, IsDefault FROM LeadStatus ORDER BY SortOrder")
    .catch(() => run("SELECT MasterLabel, IsConverted, IsDefault FROM LeadStatus ORDER BY SortOrder"));
  return rows.filter((s) => !s.IsConverted).map((s) => ({ value: s.ApiName || s.MasterLabel, label: s.MasterLabel, isDefault: !!s.IsDefault }));
}

/** A first guess at the status mapping, from the org's own labels. Staff confirm it before sync starts. */
export function suggestStatusMap(statuses) {
  const find = (re) => statuses.find((s) => re.test(s.label))?.value || null;
  return {
    NEW: statuses.find((s) => s.isDefault)?.value || find(/new|open/i),
    // "Open - Not Contacted" must not count as contacted.
    CONTACTED: find(/working/i) || find(/^(?!.*not contacted).*contacted/i),
    INTERESTED: find(/qualified|interest|nurtur/i) || find(/working/i),
    SIGNED: find(/won|signed/i),
    LOST: find(/lost|unqualified|disqualified|not converted/i),
  };
}

const pick = (payload, fields, flag) =>
  Object.fromEntries(Object.entries(payload).filter(([k, v]) => v !== undefined && fields.get(k.toLowerCase())?.[flag]));

/** What the Salesforce Lead should look like. Standard fields left blank are omitted, so a blank portal field never wipes Salesforce. */
export function leadPayload(lead, { statusMap = {}, meeting = null } = {}) {
  const words = String(lead.contactName || "").trim().split(/\s+/).filter(Boolean);
  return {
    Company: lead.companyName || "-",
    FirstName: words.length > 1 ? words[0] : undefined,
    LastName: words.length > 1 ? words.slice(1).join(" ") : words[0] || "-",
    Email: lead.email,
    MobilePhone: lead.phone || undefined,
    Website: lead.website || undefined,
    City: lead.city || undefined,
    Description: lead.notes || undefined,
    HasOptedOutOfEmail: !!lead.emailOptOut,
    Status: statusMap[lead.status] || undefined,
    // Ours alone, so they may be cleared.
    AI4HB_Portal_Link__c: portalLink(lead.id),
    AI4HB_Booking_Link__c: bookingLinkFor(lead),
    AI4HB_Next_Meeting__c: meeting?.startTime ? new Date(meeting.startTime).toISOString() : null,
    AI4HB_Meeting_Link__c: meeting?.meetingUrl || null,
    AI4HB_Journey_Stage__c: lead.journeyStage || null,
    AI4HB_SMS_Opt_Out__c: !!lead.smsOptOut,
    AI4HB_Source__c: lead.source || null,
  };
}

const sfName = (sf) => [sf.FirstName, sf.LastName].filter((p) => p && p !== "-").join(" ");
const sfPhone = (sf) => toE164(sf.MobilePhone) || toE164(sf.Phone) || null;

/**
 * The portal changes a Salesforce Lead asks for. A blank in Salesforce never blanks the portal,
 * and an opt-out is only ever added here, never lifted.
 */
export function leadChangesFromSalesforce(lead, sf, statusMap = {}) {
  const data = {};
  const set = (key, value) => {
    if (value && value !== lead[key]) data[key] = value;
  };
  if (sf.Company && sf.Company !== "-") set("companyName", sf.Company);
  set("contactName", sfName(sf));
  const email = String(sf.Email || "").trim().toLowerCase();
  if (email && email !== String(lead.email).toLowerCase()) data.email = email;
  set("phone", sfPhone(sf));
  set("website", sf.Website);
  set("city", sf.City);
  set("notes", sf.Description);
  // Several portal statuses may share one Salesforce status; only move when they really differ.
  if (sf.Status && statusMap[lead.status] !== sf.Status) {
    const status = B2B_LEAD_STATUSES.find((s) => statusMap[s] === sf.Status);
    if (status) data.status = status;
  }
  if (sf.HasOptedOutOfEmail && !lead.emailOptOut) data.emailOptOut = true;
  if (sf.AI4HB_SMS_Opt_Out__c && !lead.smsOptOut) data.smsOptOut = true;
  return data;
}

// Prisma keeps DateTime as UTC wall-clock in timestamp(3); casting the ISO text avoids any session-timezone shift.
const stamp = (date) => (date ? new Date(date).toISOString() : null);
const markLead = (id, sfId, sfHash, syncedAt) =>
  prisma.$executeRaw`UPDATE "B2BLead" SET "salesforceId" = ${sfId}, "salesforceHash" = ${sfHash}, "salesforceSyncedAt" = ${stamp(syncedAt)}::timestamp(3) WHERE id = ${id}`;
const resyncLead = (id) => prisma.$executeRaw`UPDATE "B2BLead" SET "salesforceSyncedAt" = NULL WHERE id = ${id}`;
const markMeeting = (id, eventId, sfHash, syncedAt) =>
  prisma.$executeRaw`UPDATE "SalesAgentAppointment" SET "salesforceEventId" = ${eventId}, "salesforceHash" = ${sfHash}, "salesforceSyncedAt" = ${stamp(syncedAt)}::timestamp(3) WHERE id = ${id}`;

const isPending = (row) => !row.salesforceSyncedAt || row.updatedAt > row.salesforceSyncedAt;

// ---------- Salesforce -> portal ----------

async function applySalesforceLead(sf, statusMap) {
  const email = String(sf.Email || "").trim().toLowerCase();
  let lead = await prisma.b2BLead.findUnique({ where: { salesforceId: sf.Id } });
  if (!lead && email) {
    lead = await prisma.b2BLead.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
    // Two Salesforce Leads with one email: the first one linked keeps it.
    if (lead?.salesforceId) return "skipped";
  }
  if (!lead) {
    if (!email) return "skipped";
    const name = sfName(sf);
    const created = await prisma.b2BLead.create({
      data: {
        companyName: sf.Company && sf.Company !== "-" ? sf.Company : name || email,
        contactName: name,
        email,
        phone: sfPhone(sf),
        website: sf.Website || null,
        city: sf.City || null,
        notes: sf.Description || null,
        status: B2B_LEAD_STATUSES.find((s) => statusMap[s] === sf.Status) || "NEW",
        source: "SALESFORCE",
        emailOptOut: !!sf.HasOptedOutOfEmail,
        smsOptOut: !!sf.AI4HB_SMS_Opt_Out__c,
      },
    });
    await markLead(created.id, sf.Id, null, created.updatedAt);
    return "created";
  }
  const data = leadChangesFromSalesforce(lead, sf, statusMap);
  const changed = Object.keys(data).length > 0;
  if (!changed && lead.salesforceId === sf.Id) return "same";
  // A portal edit still waiting to go up stays due, so it isn't lost; the push sends the merged lead.
  const pending = isPending(lead);
  const updated = changed ? await prisma.b2BLead.update({ where: { id: lead.id }, data }) : lead;
  if (pending) await prisma.$executeRaw`UPDATE "B2BLead" SET "salesforceId" = ${sf.Id} WHERE id = ${lead.id}`;
  else await markLead(lead.id, sf.Id, null, updated.updatedAt);
  return changed ? "updated" : "same";
}

/**
 * New and changed Salesforce Leads, oldest change first, from where the last run stopped.
 * ponytail: a ">" cursor can skip a Lead sharing the exact SystemModstamp of the last one in a full
 * batch. Rare; "Resync everything" re-reads all. Switch to an Id tiebreak if it ever matters.
 */
export async function pullLeads(client, { fields, statusMap }) {
  const state = await platformSalesforceSyncState();
  const wanted = ["Id", "FirstName", "LastName", "Company", "Email", "Phone", "MobilePhone", "Website", "City", "Description", "Status", "HasOptedOutOfEmail", "SystemModstamp", "AI4HB_SMS_Opt_Out__c"]
    .filter((f) => fields.has(f.toLowerCase()));
  const where = state.pullCursor ? ` WHERE SystemModstamp > ${soqlDate(state.pullCursor)}` : "";
  const { records = [] } = await client.query(`SELECT ${wanted.join(", ")} FROM Lead${where} ORDER BY SystemModstamp ASC LIMIT ${PULL_BATCH}`);
  const out = { more: records.length === PULL_BATCH, created: 0, updated: 0, errors: [] };
  for (const sf of records) {
    try {
      const result = await applySalesforceLead(sf, statusMap);
      if (result === "created") out.created++;
      if (result === "updated") out.updated++;
    } catch (e) {
      out.errors.push(`Salesforce Lead ${sf.Id} (${sf.Company || sf.Email || "no name"}): ${short(e)}`);
    }
  }
  if (records.length) await savePlatformSalesforceSyncState({ ...state, pullCursor: records[records.length - 1].SystemModstamp });
  return out;
}

// ---------- portal -> Salesforce ----------

export async function pushLeads(client, { fields, statusMap }) {
  const due = await prisma.$queryRaw`SELECT id FROM "B2BLead" WHERE "salesforceSyncedAt" IS NULL OR "updatedAt" > "salesforceSyncedAt" ORDER BY "updatedAt" ASC LIMIT ${BATCH}`;
  const out = { more: due.length === BATCH, pushed: 0, errors: [] };
  for (const { id } of due) {
    const lead = await prisma.b2BLead.findUnique({ where: { id } });
    if (!lead) continue;
    const meeting = await prisma.salesAgentAppointment.findFirst({
      where: { b2bLeadId: id, status: "CONFIRMED", startTime: { gte: new Date() } },
      orderBy: { startTime: "asc" },
      select: { startTime: true, meetingUrl: true },
    });
    const payload = leadPayload(lead, { statusMap, meeting });
    const payloadHash = hash(payload);
    if (lead.salesforceId && payloadHash === lead.salesforceHash) {
      await markLead(id, lead.salesforceId, payloadHash, lead.updatedAt);
      continue;
    }
    try {
      let sfId = lead.salesforceId;
      if (!sfId) {
        // Salesforce may already have this person; link instead of making a duplicate.
        const found = await client.query(`SELECT Id FROM Lead WHERE Email = ${soqlString(lead.email)} AND IsConverted = false ORDER BY CreatedDate ASC LIMIT 1`);
        sfId = found.records?.[0]?.Id || null;
      }
      if (sfId) await client.updateRecord("Lead", sfId, pick(payload, fields, "updateable"));
      else sfId = await client.createRecord("Lead", pick(payload, fields, "createable"));
      await markLead(id, sfId, payloadHash, lead.updatedAt);
      out.pushed++;
    } catch (e) {
      if (fatal(e)) throw e;
      if (lead.salesforceId && gone(e)) {
        // Deleted or merged in Salesforce: unlink, and the next run links or creates again.
        await markLead(id, null, null, null);
      } else {
        // Rejected data (validation rule, converted Lead...): reported once, tried again when the lead next changes.
        await markLead(id, lead.salesforceId, null, lead.updatedAt).catch(() => {});
        if (!/CANNOT_UPDATE_CONVERTED_LEAD/.test(e.message)) out.errors.push(`${lead.companyName}: ${short(e)}`);
      }
    }
  }
  return out;
}

const MEETING_LABEL = { PENDING: " (requested)", COMPLETED: " (completed)", NO_SHOW: " (no-show)" };

export function eventPayload(meeting, lead, minutes = 30) {
  const start = new Date(meeting.startTime);
  return {
    Subject: `AI4Home demo${MEETING_LABEL[meeting.status] || ""}: ${lead.companyName}`.slice(0, 255),
    StartDateTime: start.toISOString(),
    EndDateTime: new Date(start.getTime() + minutes * 60 * 1000).toISOString(),
    Location: meeting.meetingUrl ? meeting.meetingUrl.slice(0, 255) : undefined,
    WhoId: lead.salesforceId,
    Description: [
      meeting.meetingUrl ? `Join: ${meeting.meetingUrl}` : "",
      `Status: ${meeting.status}`,
      `Booked by: ${[meeting.name, meeting.email, meeting.phone].filter(Boolean).join(", ")}`,
      meeting.preferredTime ? `Requested time: ${meeting.preferredTime}` : "",
      meeting.campaignName ? `Campaign: ${meeting.campaignName}` : "",
      `Booking link (book or move): ${bookingLinkFor(lead)}`,
      `AI4Home portal: ${portalLink(lead.id)}`,
    ].filter(Boolean).join("\n"),
  };
}

/** Where to join: the link Calendly made for this booking, else the fixed link in the booking settings. */
async function meetingLink(meeting, availability) {
  if (meeting.calendlyEventUri) {
    const pointer = await platformCalendlyPointer();
    const conn = pointer?.userId ? await findCalendlyConnection(pointer.userId) : null;
    const found = conn ? await calendlyEventLocation(conn, meeting.calendlyEventUri).catch(() => null) : null;
    if (found) return found;
  }
  return { link: availability.meetingLink || null, processing: false };
}

export async function pushMeetings(client) {
  const due = await prisma.$queryRaw`SELECT id FROM "SalesAgentAppointment" WHERE "b2bLeadId" IS NOT NULL AND ("salesforceSyncedAt" IS NULL OR "updatedAt" > "salesforceSyncedAt") ORDER BY "updatedAt" ASC LIMIT ${BATCH}`;
  const out = { more: due.length === BATCH, pushed: 0, errors: [] };
  const availability = due.length ? await getB2BAvailability() : null;
  for (const { id } of due) {
    const meeting = await prisma.salesAgentAppointment.findUnique({ where: { id }, include: { b2bLead: true } });
    const lead = meeting?.b2bLead;
    // Waits until its lead is in Salesforce; the lead push runs first.
    if (!lead?.salesforceId) continue;
    try {
      const live = meeting.startTime && meeting.status !== "CANCELLED";
      if (meeting.salesforceEventId === DELETED_IN_SALESFORCE) {
        await markMeeting(id, DELETED_IN_SALESFORCE, null, meeting.updatedAt);
      } else if (!live) {
        // Cancelled here: gone from Salesforce too.
        if (meeting.salesforceEventId) await client.deleteRecord("Event", meeting.salesforceEventId).catch((e) => { if (!gone(e)) throw e; });
        await markMeeting(id, null, null, meeting.updatedAt);
      } else {
        const { link, processing } = await meetingLink(meeting, availability);
        if (link !== meeting.meetingUrl) await prisma.$executeRaw`UPDATE "SalesAgentAppointment" SET "meetingUrl" = ${link} WHERE id = ${id}`;
        // undefined fields (no link) are dropped by JSON, so Salesforce never gets them.
        const payload = JSON.parse(JSON.stringify(eventPayload({ ...meeting, meetingUrl: link }, lead, availability.slotDuration)));
        const payloadHash = hash(payload);
        let eventId = meeting.salesforceEventId;
        if (!eventId || payloadHash !== meeting.salesforceHash) {
          if (eventId) {
            // Deleted in Salesforce: respect that rather than making it again.
            await client.updateRecord("Event", eventId, payload).catch((e) => { if (gone(e)) eventId = DELETED_IN_SALESFORCE; else throw e; });
          } else {
            eventId = await client.createRecord("Event", payload);
          }
        }
        // Calendly may still be making the video link; stay due so the link follows next run.
        await markMeeting(id, eventId, payloadHash, processing ? null : meeting.updatedAt);
      }
      // The lead carries "next meeting", so let it re-check.
      await resyncLead(lead.id);
      out.pushed++;
    } catch (e) {
      if (fatal(e)) throw e;
      await markMeeting(id, meeting.salesforceEventId, null, meeting.updatedAt);
      out.errors.push(`Meeting with ${lead.companyName}: ${short(e)}`);
    }
  }
  return out;
}

async function closedTaskStatus(client) {
  try {
    const r = await client.query("SELECT ApiName FROM TaskStatus WHERE IsClosed = true ORDER BY SortOrder LIMIT 1");
    return r.records?.[0]?.ApiName || "Completed";
  } catch {
    return "Completed";
  }
}

export function taskSubject(m) {
  const kind = m.channel === "SMS" ? "Text" : "Email";
  const who = m.direction === "IN" ? "from lead" : `sent by ${{ CAMPAIGN: "nurture", AGENT: "AI agent" }[m.actor] || "AI4Home team"}`;
  const failed = m.direction === "OUT" && m.outcome && m.outcome !== "sent" ? ` (${m.outcome})` : "";
  return `${kind} ${who}${failed}${m.subject ? `: ${m.subject}` : ""}`.slice(0, 255);
}

/** Logs each conversation message as a completed Task on the lead, 200 at a time. */
export async function pushMessages(client) {
  const messages = await prisma.b2BMessage.findMany({
    where: { salesforceTaskId: null, lead: { salesforceId: { not: null } } },
    orderBy: { createdAt: "asc" },
    take: TASK_BATCH,
    include: { lead: { select: { salesforceId: true, companyName: true } } },
  });
  const out = { more: messages.length === TASK_BATCH, pushed: 0, errors: [] };
  if (!messages.length) return out;
  const Status = await closedTaskStatus(client);
  const results = await client.apiRequest(`${API}/composite/sobjects`, {
    method: "POST",
    body: JSON.stringify({
      allOrNone: false,
      records: messages.map((m) => ({
        attributes: { type: "Task" },
        WhoId: m.lead.salesforceId,
        Subject: taskSubject(m),
        Description: String(m.body || "").slice(0, 32000),
        Status,
        ActivityDate: m.createdAt.toISOString().slice(0, 10),
      })),
    }),
  });
  for (const [i, r] of (Array.isArray(results) ? results : []).entries()) {
    const m = messages[i];
    // A rejected record won't pass on retry either (bad data, converted lead), so it's marked and reported once.
    await prisma.b2BMessage.update({ where: { id: m.id }, data: { salesforceTaskId: r.success ? r.id : "FAILED" } });
    if (r.success) out.pushed++;
    else out.errors.push(`Message to ${m.lead.companyName}: ${(r.errors || []).map((x) => x.message).join("; ") || "rejected"}`);
  }
  return out;
}

// ---------- Deletes ----------

/** Called where the portal deletes a lead; the next run deletes it in Salesforce. */
export async function queueSalesforceDeletion(sobject, recordId, label) {
  await prisma.salesforceDeletion.upsert({ where: { recordId }, create: { sobject, recordId, label: label ? String(label).slice(0, 200) : null }, update: {} });
}

export async function pushDeletions(client) {
  const rows = await prisma.salesforceDeletion.findMany({ orderBy: { createdAt: "asc" }, take: BATCH });
  const out = { more: rows.length === BATCH, pushed: 0, errors: [] };
  for (const row of rows) {
    try {
      await client.deleteRecord(row.sobject, row.recordId).catch((e) => { if (!gone(e)) throw e; });
      out.pushed++;
    } catch (e) {
      if (fatal(e)) throw e;
      // e.g. a converted Lead, or no delete right: reported once with the reason.
      out.errors.push(`Deleting ${row.label || row.recordId} in Salesforce: ${short(e)}`);
    }
    await prisma.salesforceDeletion.delete({ where: { id: row.id } });
  }
  return out;
}

/** Leads deleted in Salesforce (its recycle bin) are deleted here. A merge moves the link to the surviving Lead instead. */
export async function pullDeletions(client) {
  const state = await platformSalesforceSyncState();
  const since = state.deleteCursor ? ` AND SystemModstamp > ${soqlDate(state.deleteCursor)}` : "";
  const { records = [] } = await client.queryAll(`SELECT Id, MasterRecordId, SystemModstamp FROM Lead WHERE IsDeleted = true${since} ORDER BY SystemModstamp ASC LIMIT ${PULL_BATCH}`);
  const out = { more: records.length === PULL_BATCH, deleted: 0, errors: [] };
  for (const sf of records) {
    try {
      const lead = await prisma.b2BLead.findUnique({ where: { salesforceId: sf.Id }, select: { id: true } });
      if (!lead) continue;
      if (sf.MasterRecordId) {
        const taken = await prisma.b2BLead.findUnique({ where: { salesforceId: sf.MasterRecordId }, select: { id: true } });
        await markLead(lead.id, taken ? null : sf.MasterRecordId, null, null);
        continue;
      }
      await prisma.b2BLead.delete({ where: { id: lead.id } });
      out.deleted++;
    } catch (e) {
      out.errors.push(`Deleting the lead for Salesforce ${sf.Id}: ${short(e)}`);
    }
  }
  if (records.length) await savePlatformSalesforceSyncState({ ...(await platformSalesforceSyncState()), deleteCursor: records[records.length - 1].SystemModstamp });
  if (out.deleted) await completeFinishedCampaigns();
  return out;
}

/**
 * A demo's Event deleted in Salesforce cancels the meeting here, exactly like Cancel in the portal:
 * Calendly cancels it too (and tells the lead) and the journey moves on. Only open meetings are touched.
 * Events Salesforce removed along with a deleted Lead are skipped: that lead is already gone here
 * (pullDeletions runs first) and a lead delete never cancels its meeting.
 */
export async function pullEventDeletions(client) {
  const state = await platformSalesforceSyncState();
  const since = state.eventDeleteCursor ? ` AND SystemModstamp > ${soqlDate(state.eventDeleteCursor)}` : "";
  const { records = [] } = await client.queryAll(`SELECT Id, SystemModstamp FROM Event WHERE IsDeleted = true${since} ORDER BY SystemModstamp ASC LIMIT ${PULL_BATCH}`);
  const out = { more: records.length === PULL_BATCH, cancelled: 0, errors: [] };
  const availability = records.length ? await getB2BAvailability() : null;
  for (const sf of records) {
    // Our own deletes cleared the link first, so they find nothing here.
    const meeting = await prisma.salesAgentAppointment.findFirst({ where: { salesforceEventId: sf.Id }, include: { b2bLead: { select: { companyName: true } } } });
    if (!meeting) continue;
    try {
      // The Event is gone either way; never try to update or delete it again.
      await prisma.$executeRaw`UPDATE "SalesAgentAppointment" SET "salesforceEventId" = NULL WHERE id = ${meeting.id}`;
      if (!meeting.b2bLeadId || !["CONFIRMED", "PENDING"].includes(meeting.status)) continue;
      await updatePlatformAppointment(meeting.id, "CANCELLED", undefined, availability);
      await journeyOnMeetingStatus(meeting.b2bLeadId, "CANCELLED");
      out.cancelled++;
    } catch (e) {
      out.errors.push(`Cancelling the meeting with ${meeting.b2bLead?.companyName || meeting.name}: ${short(e)}`);
    }
  }
  if (records.length) await savePlatformSalesforceSyncState({ ...(await platformSalesforceSyncState()), eventDeleteCursor: records[records.length - 1].SystemModstamp });
  return out;
}

/** Makes every lead and meeting due again and re-reads all Salesforce Leads. Links are kept. */
export async function resyncEverything() {
  await prisma.$executeRaw`UPDATE "B2BLead" SET "salesforceSyncedAt" = NULL, "salesforceHash" = NULL`;
  await prisma.$executeRaw`UPDATE "SalesAgentAppointment" SET "salesforceSyncedAt" = NULL, "salesforceHash" = NULL WHERE "b2bLeadId" IS NOT NULL`;
  await prisma.b2BMessage.updateMany({ where: { salesforceTaskId: "FAILED" }, data: { salesforceTaskId: null } });
  const state = await platformSalesforceSyncState();
  await savePlatformSalesforceSyncState({ ...state, pullCursor: null });
}

/** What is still waiting to go up. */
export async function pendingCounts() {
  const [[leads], [meetings], messages] = await Promise.all([
    prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM "B2BLead" WHERE "salesforceSyncedAt" IS NULL OR "updatedAt" > "salesforceSyncedAt"`,
    prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM "SalesAgentAppointment" WHERE "b2bLeadId" IS NOT NULL AND ("salesforceSyncedAt" IS NULL OR "updatedAt" > "salesforceSyncedAt")`,
    prisma.b2BMessage.count({ where: { salesforceTaskId: null } }),
  ]);
  return { leads: leads.n, meetings: meetings.n, messages, deletions: await prisma.salesforceDeletion.count() };
}

// Salesforce first, then the portal; deletes before updates so nothing is sent for a deleted lead.
const PHASES = { pullDeleted: pullDeletions, pullDeletedEvents: pullEventDeletions, pull: pullLeads, deletes: pushDeletions, leads: pushLeads, meetings: pushMeetings, messages: pushMessages };
export const SYNC_PHASES = Object.keys(PHASES);

/** One batch of one phase, with a fresh client and the current settings. */
export async function runSyncPhase(name) {
  const settings = await platformSalesforceSettings();
  const client = await platformSalesforceClient();
  const fields = name === "pull" || name === "leads" ? await leadFields(client) : null;
  return PHASES[name](client, { fields, statusMap: settings.statusMap || {} });
}

export const shortError = short;
