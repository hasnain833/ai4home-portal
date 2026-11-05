import { createHash } from "node:crypto";
import { PHONE_ERROR, toE164 } from "../services/sms.service.js";

export const WEBSITE_CONSENT_TEXT = "Send me occasional AI for Homebuilders updates and resources. Optional; unsubscribe anytime.";
export const WEBSITE_TYPES = ["CONTACT", "EBOOK", "DEMO"];
const LIMITS = { name: 160, email: 200, company: 200, phone: 40, message: 5000, notes: 5000, homesPerYear: 40, annualClosings: 40, role: 120, painPoint: 2000, inquiryType: 50, page: 500 };

export function parseWebsiteInquiry(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid request.");
  if (["companyId", "tenantId", "ownerId", "leadId", "status", "source"].some((key) => key in body)) throw new Error("Tenant routing and lead state are not accepted.");
  if (!WEBSITE_TYPES.includes(body.type)) throw new Error("Unknown inquiry type.");
  if (typeof body.marketingConsent !== "boolean") throw new Error("Choose a valid marketing preference.");
  const data = { type: body.type, marketingConsent: body.marketingConsent };
  for (const [key, limit] of Object.entries(LIMITS)) {
    const value = body[key] ?? "";
    if (typeof value !== "string" || value.length > limit) throw new Error(`Invalid ${key}.`);
    data[key] = value.trim();
  }
  // Use the same phone representation as platform B2B leads and Telnyx.
  const phone = toE164(data.phone);
  if (phone === undefined) throw new Error(PHONE_ERROR);
  data.phone = phone || "";
  data.email = data.email.toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(data.email)) throw new Error("A valid email is required.");
  if (data.type !== "EBOOK" && (!data.name || !data.company)) throw new Error("Name and company are required.");
  if (data.type === "CONTACT" && !data.message) throw new Error("Please enter a message.");
  if (data.page && !/^\/(?!\/)[^\r\n]*$/.test(data.page)) throw new Error("Invalid source page.");
  return data;
}

export function inquiryHash(data) {
  return createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b))))).digest("hex");
}

// Deliberately accepts only a platform B2B transaction. No tenant lead or automation calls.
export async function storeWebsiteInquiry(db, id, payload) {
  const payloadHash = inquiryHash(payload);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const prior = await tx.b2BInquiry.findUnique({ where: { id } });
        if (prior) {
          if (prior.payloadHash !== payloadHash) throw Object.assign(new Error("Request ID already used for different details."), { status: 409 });
          return prior;
        }
        const existing = await tx.b2BLead.findUnique({ where: { email: payload.email } });
        const consentAt = payload.marketingConsent ? new Date() : null;
        const lead = await tx.b2BLead.upsert({
          where: { email: payload.email },
          create: {
            companyName: payload.company, contactName: payload.name, email: payload.email,
            phone: payload.phone || null, source: `WEBSITE_${payload.type}`,
            marketingOptIn: payload.marketingConsent, marketingConsentAt: consentAt,
            emailOptOut: !payload.marketingConsent, smsOptOut: true,
          },
          update: {
            ...(!existing?.companyName && payload.company ? { companyName: payload.company } : {}),
            ...(!existing?.contactName && payload.name ? { contactName: payload.name } : {}),
            ...(!existing?.phone && payload.phone ? { phone: payload.phone } : {}),
            // A later unchecked box is not an unsubscribe. Existing opt-outs are never cleared here.
            ...(payload.marketingConsent ? { marketingOptIn: true, marketingConsentAt: consentAt } : {}),
          },
        });
        return tx.b2BInquiry.create({ data: {
          id, leadId: lead.id, type: payload.type, payload, payloadHash,
          marketingConsent: payload.marketingConsent, consentText: WEBSITE_CONSENT_TEXT,
        } });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (attempt < 2 && ["P2002", "P2034"].includes(error.code)) continue;
      throw error;
    }
  }
}
