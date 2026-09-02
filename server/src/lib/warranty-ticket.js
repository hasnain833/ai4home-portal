import prisma from "./prisma.js";
import { calculateWarrantyYear } from "./utils.js";
import { generateTicketId } from "./ticket-utils.js";
import { normalizePriority } from "./warranty-classify.js";
import { syncTicketToERP } from "../services/erp-service.js";
import { MessagingService } from "../services/messaging-service.js";

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

  const warrantyYear = property?.coeDate ? calculateWarrantyYear(property.coeDate) : 1;
  const isEmergency = !!classification?.isEmergency;
  const priority = normalizePriority(classification?.priority, { isEmergency });
  const issueType = String(classification?.issueType || "General Warranty").slice(0, 80);

  const ticketId = await generateTicketId();

  const ticket = await prisma.ticket.create({
    data: {
      id: ticketId,
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
      priority,
      warrantyYear,
      status: isEmergency ? "ESCALATED" : "OPEN",
      erpSyncStatus: "PENDING",
    },
  });

  try {
    await syncTicketToERP(ticket.id, { reason: isEmergency ? "escalation" : "creation" });
  } catch (err) {
    console.error(`[Warranty Ticket] ERP sync failed for #${ticket.id}:`, err.message);
  }

  console.log(
    `[Warranty Ticket] #${ticket.id} filed for ${homeowner.email} ` +
    `(${issueType}, ${priority}${isEmergency ? ", EMERGENCY" : ""}).`,
  );

  return { ticket, ticketUrl: ticketUrlFor(ticket.id) };
}

export async function escalateWarrantyTicket(ticketId, { reason = "Emergency detected." } = {}) {
  if (!ticketId) return null;

  const existing = await prisma.ticket.findUnique({ where: { id: ticketId } }).catch(() => null);
  if (!existing) return null;
  if (existing.isEmergency && existing.status === "ESCALATED") return existing;

  const ticket = await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      isEmergency: true,
      priority: "URGENT",
      status: "ESCALATED",
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

  if (existing.status !== "ESCALATED") {
    try {
      await MessagingService.notifyTicketStatusChange(ticket.id, ticket.status);
    } catch (err) {
      console.error(`[Warranty Ticket] Escalation notice failed for #${ticket.id}:`, err.message);
    }
  }

  return ticket;
}
