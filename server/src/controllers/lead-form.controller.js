import prisma from "../lib/prisma.js";
import { findDuplicateLead } from "../lib/lead-dedup.js";
import { triggerAutomation } from "../lib/automation-events.js";
import { normalizePhone } from "../services/sms.service.js";

// A builder's website form, hosted here (iframe or link) or posted to directly
// from their own form. The URL carries the company id, which is already public
// in reply addresses; abuse is held back by the rate limit and a honeypot.
// ponytail: no per-company form key, add a rotatable one if a form gets spammed.

const EMAIL_RE = /^[^\s@]+@([^\s@.,]+\.)+[^\s@.,]{2,}$/;

// Shown next to the checkboxes and stored with the lead, so the record says
// exactly what the person agreed to.
const consentText = (company) => ({
  email: `I'd like to receive emails from ${company} about homes, communities and offers. I can unsubscribe at any time.`,
  sms: `I agree to receive text messages from ${company} about homes and appointments at the number provided. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help. Consent is not a condition of purchase.`,
});

const clip = (v, n) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, n);
const checked = (v) => v === true || ["true", "on", "1", "yes"].includes(String(v).toLowerCase());

async function findCompany(companyId) {
  return prisma.company
    .findUnique({ where: { id: String(companyId || "") }, select: { id: true, name: true, logo: true, botColor: true } })
    .catch(() => null);
}

export const getLeadForm = async (req, res) => {
  const company = await findCompany(req.params.companyId);
  if (!company) return res.status(404).json({ message: "This form is not available." });
  return res.json({
    companyName: company.name,
    logo: company.logo || null,
    color: company.botColor || "#0F3B3D",
    consent: consentText(company.name),
  });
};

export const submitLeadForm = async (req, res) => {
  const b = req.body || {};
  // Plain HTML forms from the builder's own site can send people back to a
  // thank-you page of theirs.
  const redirect = /^https?:\/\//i.test(String(b.redirect || "")) ? String(b.redirect) : null;
  const done = () => (redirect ? res.redirect(303, redirect) : res.status(201).json({ success: true }));

  try {
    // Bots fill every field; people never see this one.
    if (clip(b.website, 200)) return done();

    const company = await findCompany(req.params.companyId);
    if (!company) return res.status(404).json({ message: "This form is not available." });

    let firstName = clip(b.firstName, 80);
    let lastName = clip(b.lastName, 80);
    if (!firstName && b.name) [firstName, lastName = ""] = clip(b.name, 160).split(/ (.*)/);
    const email = clip(b.email, 200).toLowerCase();
    const phone = normalizePhone(b.phone);

    if (!firstName) return res.status(400).json({ message: "Please enter your name." });
    if (email && !EMAIL_RE.test(email)) return res.status(400).json({ message: "Please enter a valid email address." });
    if (b.phone && (phone.length < 10 || phone.length > 15)) {
      return res.status(400).json({ message: "Please enter a valid phone number." });
    }
    if (!email && !phone) return res.status(400).json({ message: "Please enter an email address or phone number." });

    const emailOptIn = !!email && checked(b.emailOptIn);
    const smsOptIn = !!phone && checked(b.smsOptIn);
    const consent = consentText(company.name);
    const submission = {
      interest: clip(b.interest, 200) || null,
      message: String(b.message ?? "").trim().slice(0, 2000) || null,
      page: clip(b.page, 500) || null,
      submittedAt: new Date().toISOString(),
      consentGiven: [emailOptIn && consent.email, smsOptIn && consent.sms].filter(Boolean),
    };
    const consentData =
      emailOptIn || smsOptIn ? { consentSource: "Website form", consentTimestamp: new Date() } : {};

    const existing = await findDuplicateLead(company.id, email, phone);
    let lead;
    if (existing) {
      // Fill gaps only, and only ever add consent: an unticked box on a second
      // visit is not an opt-out.
      lead = await prisma.lead.update({
        where: { id: existing.id },
        data: {
          ...(!existing.email && email ? { email } : {}),
          ...(!existing.phone && phone ? { phone } : {}),
          ...(emailOptIn ? { emailOptIn: true } : {}),
          ...(smsOptIn ? { smsOptIn: true } : {}),
          ...consentData,
          archived: false,
          tags: existing.tags.includes("web-form") ? existing.tags : [...existing.tags, "web-form"],
          customFields: { ...(existing.customFields || {}), webForm: submission },
        },
      });
    } else {
      lead = await prisma.lead.create({
        data: {
          companyId: company.id,
          source: "MANUAL",
          firstName,
          lastName: lastName || "-",
          email: email || null,
          phone: phone || null,
          zipCode: clip(b.zipCode, 20) || null,
          tags: ["web-form"],
          emailOptIn,
          smsOptIn,
          ...consentData,
          customFields: { webForm: submission },
        },
      });
    }

    await triggerAutomation({
      companyId: company.id,
      leadId: lead.id,
      event: "WEB_FORM",
      context: { returning: !!existing },
    });

    return done();
  } catch (error) {
    console.error("[Lead Form] Submission failed:", error);
    return res.status(500).json({ message: "Something went wrong. Please try again." });
  }
};
