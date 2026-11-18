import { NonRetriableError } from "inngest";
import prisma from "../lib/prisma.js";
import { inngest } from "../lib/inngest.js";
import { SMS_STATUS, forgetCompanySender, toE164 } from "./sms.service.js";

const API = "https://api.telnyx.com/v2";
export const SMS_REGISTRATION_EVENT = "sms.registration.submitted";

const POLL_EVERY = "6h";
const MAX_POLLS = 120; // ~30 days; carriers usually answer in days, sometimes 2–3 weeks.

const ENTITY_TYPES = ["PRIVATE_PROFIT", "PUBLIC_PROFIT", "NON_PROFIT"];
const APPROVED_CAMPAIGN = ["MNO_ACCEPTED", "MNO_PROVISIONED"];
const FAILED_CAMPAIGN = ["TCR_FAILED", "TCR_SUSPENDED", "TCR_EXPIRED", "TELNYX_FAILED", "MNO_REJECTED", "MNO_PROVISIONING_FAILED"];

const text = (v) => String(v ?? "").trim();
const reasonOf = (v) =>
  Array.isArray(v) ? v.map((r) => r?.description || r?.message || r).filter(Boolean).join("; ") : text(v);

async function telnyx(method, path, body) {
  const key = text(process.env.TELNYX_API_KEY);
  if (!key) throw new NonRetriableError("TELNYX_API_KEY is not set.");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json?.errors?.[0];
    const message = `Telnyx: ${err?.detail || err?.title || reasonOf(json?.failureReasons) || `${method} ${path} failed (HTTP ${res.status})`}`;
    // A 4xx is our data being wrong: retrying would only resubmit (and re-bill) it.
    if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new NonRetriableError(message);
    throw new Error(message);
  }
  // 10DLC endpoints answer bare, the number endpoints wrap in `data`.
  return json?.data ?? json;
}

/** Checks the SRS 8.1 form. Returns { registration } or { error }. */
export function validateRegistration(body = {}) {
  const r = {
    legalName: text(body.legalName),
    ein: text(body.ein).replace(/\D/g, ""),
    entityType: text(body.entityType) || "PRIVATE_PROFIT",
    street: text(body.street),
    city: text(body.city),
    state: text(body.state).toUpperCase(),
    postalCode: text(body.postalCode),
    website: text(body.website),
    email: text(body.email).toLowerCase(),
    phone: toE164(body.phone),
    contactFirstName: text(body.contactFirstName),
    contactLastName: text(body.contactLastName),
    contactEmail: text(body.contactEmail).toLowerCase(),
    optInFlow: text(body.optInFlow),
    privacyPolicyUrl: text(body.privacyPolicyUrl),
    areaCode: text(body.areaCode).replace(/\D/g, ""),
  };
  const missing = [
    ["legalName", "legal business name"],
    ["street", "street"],
    ["city", "city"],
    ["postalCode", "ZIP code"],
    ["website", "website"],
    ["email", "support email"],
    ["contactFirstName", "contact first name"],
    ["contactLastName", "contact last name"],
    ["contactEmail", "contact email"],
  ].filter(([k]) => !r[k]).map(([, label]) => label);
  if (missing.length) return { error: `Missing: ${missing.join(", ")}.` };
  if (r.ein.length !== 9) return { error: "EIN must be 9 digits." };
  if (!ENTITY_TYPES.includes(r.entityType)) return { error: "Unknown business type." };
  if (!/^[A-Z]{2}$/.test(r.state)) return { error: "State must be a 2-letter code, e.g. TX." };
  if (!r.phone) return { error: "Support phone must be a US or Canadian number." };
  if (!/^https?:\/\/\S+\.\S+/i.test(r.website)) return { error: "Website must be a full URL, e.g. https://olsonhomes.com." };
  if (r.privacyPolicyUrl && !/^https?:\/\//i.test(r.privacyPolicyUrl)) return { error: "Privacy policy must be a full URL." };
  if (r.areaCode && r.areaCode.length !== 3) return { error: "Area code must be 3 digits." };
  // Carriers reject vague opt-in descriptions more than anything else.
  if (r.optInFlow.length < 40) return { error: "Describe how buyers agree to receive texts (at least a sentence)." };
  return { registration: r };
}

export async function submitRegistration(companyId, body) {
  const { registration, error } = validateRegistration(body);
  if (error) return { status: 400, message: error };

  const existing = await prisma.company.findUnique({ where: { id: companyId }, select: { smsStatus: true, smsRegistration: true } });
  if (!existing) return { status: 404, message: "Company not found" };
  if (existing.smsStatus === SMS_STATUS.APPROVED) return { status: 409, message: "This builder already has an approved number." };

  const company = await prisma.company.update({
    where: { id: companyId },
    data: { smsRegistration: registration, smsStatus: SMS_STATUS.PENDING, smsRejectReason: null },
    select: { id: true, name: true, smsNumber: true, smsStatus: true, smsRejectReason: true, smsRegistration: true },
  });
  await inngest.send({ name: SMS_REGISTRATION_EVENT, data: { companyId, resubmit: !!existing.smsRegistration } });
  return { company };
}

function brandBody(name, r) {
  return {
    entityType: r.entityType,
    displayName: name,
    companyName: r.legalName,
    ein: r.ein,
    phone: r.phone,
    street: r.street,
    city: r.city,
    state: r.state,
    postalCode: r.postalCode,
    country: "US",
    email: r.email,
    website: r.website,
    vertical: "REAL_ESTATE",
    firstName: r.contactFirstName,
    lastName: r.contactLastName,
    ...(r.entityType === "PUBLIC_PROFIT" && { businessContactEmail: r.contactEmail }),
  };
}

function campaignBody(name, r, brandId) {
  const stop = "Reply STOP to opt out.";
  return {
    brandId,
    usecase: "MIXED",
    subUsecases: ["MARKETING", "CUSTOMER_CARE", "ACCOUNT_NOTIFICATION"],
    description:
      `${name} is a home builder. It texts prospective homebuyers and homeowners who opted in: new-home ` +
      `and community updates, replies to their questions, appointment confirmations and reminders, and warranty service updates.`,
    messageFlow: r.optInFlow,
    sample1: `${name}: Hi Sarah, new homes just released in Oak Ridge from the $400s. Want to book a tour this week? ${stop}`,
    sample2: `${name}: Your appointment is confirmed for Tue at 10:00 AM at our Oak Ridge model home. ${stop}`,
    sample3: `${name}: Update on warranty request #1042: a technician is scheduled for Thu between 9 and 11 AM. ${stop}`,
    helpMessage: `${name}: For help, email ${r.email} or call ${r.phone}. Msg & data rates may apply. ${stop}`,
    optinMessage: `${name}: You're subscribed to texts about homes, appointments and warranty service. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.`,
    optoutMessage: `${name}: You're unsubscribed and won't receive more texts. Reply START to resubscribe.`,
    optinKeywords: "START,UNSTOP,RESUBSCRIBE",
    optoutKeywords: "STOP,UNSUBSCRIBE,QUIT,CANCEL,END",
    helpKeywords: "HELP,INFO",
    subscriberOptin: true,
    subscriberOptout: true,
    subscriberHelp: true,
    embeddedLink: true, // campaign texts carry short links
    embeddedPhone: false,
    numberPool: false,
    ageGated: false,
    directLending: false,
    termsAndConditions: true,
    ...(r.privacyPolicyUrl && { privacyPolicyLink: r.privacyPolicyUrl }),
  };
}

function inboundWebhookUrl() {
  const explicit = text(process.env.TELNYX_WEBHOOK_URL);
  if (explicit) return explicit;
  const base = text(process.env.BACKEND_URL).replace(/\/+$/, "");
  if (!base) throw new NonRetriableError("Set BACKEND_URL (or TELNYX_WEBHOOK_URL) so the builder's number can receive replies.");
  return `${base}/api/sales/compliance/inbound/sms/telnyx`;
}

const save = (companyId, data) => prisma.company.update({ where: { id: companyId }, data });

async function findLocalNumber(r) {
  const search = async (extra) => {
    const qs = new URLSearchParams({
      "filter[country_code]": "US",
      "filter[phone_number_type]": "local",
      "filter[features][]": "sms",
      "filter[limit]": "1",
      ...extra,
    });
    const found = await telnyx("GET", `/available_phone_numbers?${qs}`);
    return (Array.isArray(found) ? found : [])[0]?.phone_number || null;
  };
  return (
    (r.areaCode && (await search({ "filter[national_destination_code]": r.areaCode }))) ||
    (await search({ "filter[administrative_area]": r.state })) ||
    (await search({}))
  );
}

/** Wait on a Telnyx resource: `check` returns a value to finish, or undefined to keep waiting. */
async function pollUntil(step, name, read, check) {
  for (let i = 0; i < MAX_POLLS; i++) {
    const record = await step.run(`${name}-check-${i}`, read);
    const done = check(record);
    if (done !== undefined) return done;
    await step.sleep(`${name}-wait-${i}`, i < 4 ? "15m" : POLL_EVERY);
  }
  throw new NonRetriableError(`Still waiting on the ${name} after 30 days. Check it in the Telnyx portal.`);
}

export const registerBuilderSms = inngest.createFunction(
  {
    id: "register-builder-sms",
    concurrency: [{ key: "event.data.companyId", limit: 1 }],
    // Resubmitting the form replaces the run in flight.
    cancelOn: [{ event: SMS_REGISTRATION_EVENT, match: "data.companyId" }],
    onFailure: async ({ event, error }) => {
      const companyId = event.data?.event?.data?.companyId;
      if (!companyId) return;
      await save(companyId, { smsStatus: SMS_STATUS.REJECTED, smsRejectReason: String(error?.message || "Registration failed.").slice(0, 500) });
      forgetCompanySender(companyId);
    },
    triggers: [{ event: SMS_REGISTRATION_EVENT }],
  },
  async ({ event, step }) => {
    const { companyId, resubmit } = event.data;
    const company = await step.run("load", () =>
      prisma.company.findUnique({
        where: { id: companyId },
        select: { name: true, smsRegistration: true, smsMessagingProfileId: true, smsBrandId: true, smsCampaignId: true, smsNumber: true },
      }),
    );
    if (!company?.smsRegistration) throw new NonRetriableError("No registration details saved.");
    const r = company.smsRegistration;

    // Its own profile, so STOP to this builder never blocks another (SRS SMS-08).
    const profileId =
      company.smsMessagingProfileId ||
      (await step.run("profile", async () => {
        const profile = await telnyx("POST", "/messaging_profiles", {
          name: `${company.name} (AI4Home)`.slice(0, 100),
          whitelisted_destinations: ["US", "CA"],
          webhook_url: inboundWebhookUrl(),
        });
        await save(companyId, { smsMessagingProfileId: profile.id });
        return profile.id;
      }));

    const brandId = await step.run("brand", async () => {
      if (company.smsBrandId) {
        if (resubmit) await telnyx("PUT", `/10dlc/brand/${company.smsBrandId}`, brandBody(company.name, r));
        return company.smsBrandId;
      }
      const brand = await telnyx("POST", "/10dlc/brand", brandBody(company.name, r));
      await save(companyId, { smsBrandId: brand.brandId });
      return brand.brandId;
    });

    await pollUntil(step, "brand", () => telnyx("GET", `/10dlc/brand/${brandId}`), (brand) => {
      if (["VERIFIED", "VETTED_VERIFIED"].includes(brand.identityStatus)) return true;
      if (brand.status === "REGISTRATION_FAILED" || (brand.status === "OK" && brand.identityStatus === "UNVERIFIED")) {
        throw new NonRetriableError(
          `Business not verified: ${reasonOf(brand.failureReasons) || "the legal name, EIN and address must match the IRS records exactly."}`,
        );
      }
      return undefined;
    });

    const campaignId =
      company.smsCampaignId ||
      (await step.run("campaign", async () => {
        const campaign = await telnyx("POST", "/10dlc/campaignBuilder", campaignBody(company.name, r, brandId));
        await save(companyId, { smsCampaignId: campaign.campaignId });
        return campaign.campaignId;
      }));

    const campaign = await pollUntil(step, "campaign", () => telnyx("GET", `/10dlc/campaign/${campaignId}`), (c) =>
      APPROVED_CAMPAIGN.includes(c.campaignStatus) || FAILED_CAMPAIGN.includes(c.campaignStatus) ? c : undefined,
    );
    if (FAILED_CAMPAIGN.includes(campaign.campaignStatus)) {
      // A rejected campaign can't be reused: the corrected resubmission files a new one.
      await step.run("campaign-rejected", () => save(companyId, { smsCampaignId: null }));
      throw new NonRetriableError(
        `Carriers rejected the texting campaign (${campaign.campaignStatus})${campaign.failureReasons ? `: ${reasonOf(campaign.failureReasons)}` : "."}`,
      );
    }

    // Reuse a number bought on an earlier attempt; carriers vet the campaign, not the number.
    const number =
      company.smsNumber ||
      (await step.run("buy-number", async () => {
        const phone = await findLocalNumber(r);
        if (!phone) throw new Error("No local number with SMS available right now.");
        const order = await telnyx("POST", "/number_orders", { phone_numbers: [{ phone_number: phone }], messaging_profile_id: profileId });
        if (order.status === "failure") throw new Error(`Number order for ${phone} failed.`);
        await save(companyId, { smsNumber: phone });
        return { phone, orderId: order.id };
      }));
    const phone = typeof number === "string" ? number : number.phone;
    if (typeof number !== "string") {
      await pollUntil(step, "number order", () => telnyx("GET", `/number_orders/${number.orderId}`), (order) => {
        if (order.status === "success") return true;
        if (order.status === "failure") throw new NonRetriableError(`Telnyx couldn't complete the order for ${phone}.`);
        return undefined;
      });
    }

    await step.run("assign-number", () => telnyx("POST", "/10dlc/phoneNumberCampaign", { phoneNumber: phone, campaignId }));
    await pollUntil(
      step,
      "number assignment",
      () => telnyx("GET", `/10dlc/phoneNumberCampaign?${new URLSearchParams({ "filter[campaignId]": campaignId })}`),
      (list) => {
        const rows = list?.records || list?.data || (Array.isArray(list) ? list : []);
        const row = rows.find((x) => (x.phoneNumber || x.phone_number) === phone);
        const status = row?.assignmentStatus || row?.status;
        if (status === "ADDED" || status === "ASSIGNED") return true;
        if (status === "FAILED") throw new NonRetriableError(`Telnyx couldn't attach ${phone} to the campaign: ${reasonOf(row?.failureReasons) || "unknown reason"}.`);
        return undefined;
      },
    );

    await step.run("approve", async () => {
      await save(companyId, { smsStatus: SMS_STATUS.APPROVED, smsRejectReason: null });
      forgetCompanySender(companyId);
    });
    return { approved: phone };
  },
);
