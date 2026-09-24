import prisma from "./prisma.js";
import { calculateWarrantyYear } from "./utils.js";
import { normalizePriority, RESOLVED_PRIORITY } from "./warranty-classify.js";
import { syncTicketToERP } from "../services/erp-service.js";
import { MessagingService } from "../services/messaging-service.js";
import { notifyTicketCreated } from "../services/notification-service.js";
import { attachConversationPhotos } from "../services/warranty-photos.service.js";

const MAX_SUMMARY_TURNS = 14;
const MAX_SUMMARY_CHARS = 4000;

export function ticketUrlFor(ticketId) {
  const base = (process.env.NEXT_PUBLIC_URL || "").replace(/\/+$/, "");
  if (!base) return null;
  return `${base}/warranty/tickets/${ticketId}`;
}

export function buildChatSummary(transcript, { maxTurns = MAX_SUMMARY_TURNS } = {}) {
  const turns = Array.isArray(transcript) ? transcript : [];
  if (turns.length === 0) return null;

  const recent = turns.slice(-maxTurns);
  const lines = recent.map((t) => {
    const who = t.role === "agent" ? "Assistant" : "Homeowner";
    const content = String(t.content || "").replace(/\s+/g, " ").trim();
    return `${who}: ${content}`;
  });

  const body = lines.join("\n");
  const elided = turns.length > recent.length
    ? `[earlier ${turns.length - recent.length} message(s) not shown]\n`
    : "";

  return `${elided}${body}`.slice(0, MAX_SUMMARY_CHARS);
}

export function buildExtractedInfo({ classification, coverage, property }) {
  const info = {
    location: classification?.location || null,
    symptom: classification?.symptom || null,
    areaOfHome: property?.areaOfHome || null,
    propertyAddress: property?.address || null,
    coverageStatus: coverage?.status || null,
    coverageEndDate: coverage?.endDate ? new Date(coverage.endDate).toISOString() : null,
    classifiedBy: classification?.source || null,
  };

  const hasAny = Object.values(info).some((v) => v !== null && v !== "");
  return hasAny ? JSON.stringify(info) : null;
}

export function buildKbReferences(kbRefs) {
  const refs = Array.isArray(kbRefs) ? kbRefs : [];
  if (refs.length === 0) return null;

  const seen = new Map();
  for (const ref of refs) {
    if (!ref?.documentId || seen.has(ref.documentId)) continue;
    seen.set(ref.documentId, {
      documentId: ref.documentId,
      name: ref.name || "",
      category: ref.category || null,
      scope: ref.scope || null,
    });
  }

  return seen.size > 0 ? JSON.stringify([...seen.values()]) : null;
}

export async function createWarrantyTicket({
  companyId,
  homeownerId = null,
  email = null,
  propertyId = null,
  classification = null,
  description = "",
  transcript = null,
  kbRefs = null,
  coverage = null,
  ticketType = "AI Chat",
  conversationId = null,
  // "RESOLVED" records an issue the homeowner fixed during the chat: it is on
  // file and counted, but nobody needs to act on it.
  status = "OPEN",
}) {
  let homeowner = null;
  if (homeownerId) {
    homeowner = await prisma.user.findUnique({
      where: { id: homeownerId },
      include: { properties: true },
    });
  } else if (email) {
    homeowner = await prisma.user.findUnique({
      where: { email: String(email).toLowerCase().trim() },
      include: { properties: true },
    });
  }

  if (!homeowner) {
    console.warn("[Warranty Ticket] No homeowner resolved — refusing to file an unattributed ticket.");
    return null;
  }

  let selectedPropertyId = propertyId || null;
  if (!selectedPropertyId && homeowner.properties?.length === 1) {
    selectedPropertyId = homeowner.properties[0].id;
  }
  if (!selectedPropertyId && (homeowner.properties?.length || 0) > 1) {
    console.warn(
      `[Warranty Ticket] Homeowner ${homeowner.id} has ${homeowner.properties.length} properties and none was selected — filing without one.`,
    );
  }

  let property = null;
  if (selectedPropertyId) {
    property =
      homeowner.properties?.find((p) => p.id === selectedPropertyId) ||
      (await prisma.property.findUnique({ where: { id: selectedPropertyId } }).catch(() => null));
  }

  const resolvedInChat = status === "RESOLVED";
  const warrantyYear = property?.coeDate ? calculateWarrantyYear(property.coeDate) : 1;
  const isEmergency = !!classification?.isEmergency;
  const priority = normalizePriority(classification?.priority, {
    isEmergency,
    text: String(description || classification?.summary || ""),
  });
  const issueType = String(classification?.issueType || "General Warranty").slice(0, 80);

  const ticket = await prisma.ticket.create({
    data: {
      // id is omitted — Supabase/Prisma auto-assigns a cuid
      issueType,
      ticketType,
      description: String(description || classification?.summary || "").slice(0, 5000) || null,
      chatSummary: buildChatSummary(transcript),
      extractedInfo: buildExtractedInfo({ classification, coverage, property }),
      kbReferences: buildKbReferences(kbRefs),
      propertyId: selectedPropertyId || null,
      homeownerId: homeowner.id,
      companyId: homeowner.companyId ?? companyId ?? null,
      isEmergency,
      // Same as a ticket staff mark resolved: HAPPY, not the urgency it had.
      priority: resolvedInChat ? RESOLVED_PRIORITY : priority,
      warrantyYear,
      status: resolvedInChat ? "RESOLVED" : "OPEN",
      // A fixed issue must not open a work order in the builder's ERP.
      erpSyncStatus: resolvedInChat ? "SKIPPED" : "PENDING",
    },
  });

  if (!resolvedInChat) {
    try {
      await syncTicketToERP(ticket.id, { reason: isEmergency ? "escalation" : "creation" });
    } catch (err) {
      console.error(`[Warranty Ticket] ERP sync failed for #${ticket.id}:`, err.message);
    }
  }

  // Photos taken in the chat move onto the ticket before anyone is told about
  // it, so the notification and the ticket page both have them.
  const photos = await attachConversationPhotos(conversationId, ticket.id).catch((err) => {
    console.error(`[Warranty Ticket] Could not attach photos to #${ticket.id}:`, err.message);
    return 0;
  });

  // Agent-filed tickets notify exactly like portal-filed ones — except one the
  // homeowner already fixed, which would only be a "new ticket" alert with
  // nothing to do.
  if (!resolvedInChat) await notifyTicketCreated(ticket.id);

  console.log(
    `[Warranty Ticket] #${ticket.id} filed for ${homeowner.email} ` +
    `(${issueType}, ${priority}${isEmergency ? ", EMERGENCY" : ""}${photos ? `, ${photos} photo(s)` : ""}).`,
  );

  return { ticket, ticketUrl: ticketUrlFor(ticket.id) };
}

export async function escalateWarrantyTicket(ticketId, { reason = "Emergency detected." } = {}) {
  if (!ticketId) return null;

  const existing = await prisma.ticket.findUnique({ where: { id: ticketId } }).catch(() => null);
  if (!existing) return null;
  if (existing.isEmergency) return existing;

  const ticket = await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      isEmergency: true,
      priority: "URGENT",
      description: existing.description
        ? `${existing.description}\n\n[Escalated] ${reason}`.slice(0, 5000)
        : String(reason).slice(0, 5000),
    },
  });

  try {
    await syncTicketToERP(ticket.id, { reason: "escalation" });
  } catch (err) {
    console.error(`[Warranty Ticket] ERP escalation sync failed for #${ticket.id}:`, err.message);
  }

  if (!existing.isEmergency) {
    try {
      await MessagingService.notifyTicketStatusChange(ticket.id, ticket.status);
    } catch (err) {
      console.error(`[Warranty Ticket] Escalation notice failed for #${ticket.id}:`, err.message);
    }
  }

  return ticket;
}
