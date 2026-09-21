import prisma from "../lib/prisma.js";
import { ComplianceService } from "../services/compliance-service.js";
import { triggerAutomation } from "../lib/automation-events.js";
import { writeBackLeadToSalesforce } from "../services/salesforce-writeback.js";
import { LEAD_STATUS } from "../lib/lead-statuses.js";
import { normalizePhone } from "../services/sms.service.js";

async function markLeadEngaged(leadId) {
  await prisma.lead.updateMany({
    where: {
      id: leadId,
      status: { in: [LEAD_STATUS.NEW, LEAD_STATUS.NURTURING] },
    },
    data: { status: LEAD_STATUS.ENGAGED },
  });
}

export const getSuppressions = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const companyId = req.user.companyId;
    const page = parseInt(req.query.page || "1", 10);
    const limit = Math.min(
      parseInt(req.query.limit || "10", 10),
      50
    );
    const search = req.query.search || "";

    const where = { companyId };
    if (search) {
      where.value = { contains: search, mode: "insensitive" };
    }

    const [suppressedItems, total] = await Promise.all([
      prisma.suppressionList.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.suppressionList.count({ where }),
    ]);

    return res.json({
      suppressedItems,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("[Suppression GET] Error:", error);
    return res
      .status(500)
      .json({ message: error.message || "Internal server error" });
  }
};

export const addSuppression = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const companyId = req.user.companyId;
    const { value, reason } = req.body;

    if (!value || typeof value !== "string") {
      return res.status(400).json({ message: "Invalid value parameter" });
    }

    const isEmail = value.includes("@");
    const normalizedValue = isEmail
      ? value.trim().toLowerCase()
      : value.replace(/\D/g, "");

    if (!normalizedValue) {
      return res
        .status(400)
        .json({ message: "Value cannot be empty after normalization" });
    }

    const item = await prisma.suppressionList.upsert({
      where: {
        companyId_value: {
          companyId,
          value: normalizedValue,
        },
      },
      create: {
        companyId,
        value: normalizedValue,
        reason: reason || "UNSUBSCRIBE",
      },
      update: {
        reason: reason || "UNSUBSCRIBE",
      },
    });

    if (isEmail) {
      await prisma.lead.updateMany({
        where: { companyId, email: normalizedValue },
        data: {
          emailOptIn: false,
          consentSource: "Manual Suppression",
          consentTimestamp: new Date(),
        },
      });
    } else {
      await prisma.lead.updateMany({
        where: {
          companyId,
          phone: { contains: normalizedValue.slice(-10) },
        },
        data: {
          smsOptIn: false,
          consentSource: "Manual Suppression",
          consentTimestamp: new Date(),
        },
      });
    }

    return res.json({ success: true, item });
  } catch (error) {
    console.error("[Suppression POST] Error:", error);
    return res
      .status(500)
      .json({ message: error.message || "Internal server error" });
  }
};

export const deleteSuppression = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const companyId = req.user.companyId;
    const { id, value } = req.body;

    if (!id && !value) {
      return res
        .status(400)
        .json({ message: "Must provide either id or value" });
    }

    if (id) {
      const existing = await prisma.suppressionList.findUnique({
        where: { id },
      });

      if (!existing || existing.companyId !== companyId) {
        return res
          .status(404)
          .json({ message: "Record not found or unauthorized" });
      }

      await prisma.suppressionList.delete({
        where: { id },
      });
    } else {
      const isEmail = value.includes("@");
      const normalizedValue = isEmail
        ? value.trim().toLowerCase()
        : value.replace(/\D/g, "");

      try {
        await prisma.suppressionList.delete({
          where: {
            companyId_value: {
              companyId,
              value: normalizedValue,
            },
          },
        });
      } catch (e) {
        return res.status(404).json({ message: "Record not found" });
      }
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("[Suppression DELETE] Error:", error);
    return res
      .status(500)
      .json({ message: error.message || "Internal server error" });
  }
};

export const processInbound = async (req, res) => {
  try {
    const { sender, body, channel, companyId } = req.body;

    if (!sender || !body || !channel || !companyId) {
      return res
        .status(400)
        .json({
          message:
            "Missing required parameters: sender, body, channel, companyId",
        });
    }

    if (channel !== "SMS" && channel !== "EMAIL") {
      return res
        .status(400)
        .json({ message: "Channel must be either 'SMS' or 'EMAIL'" });
    }

    // 1. Process via keywords
    const result = await ComplianceService.handleInboundKeyword(
      companyId,
      sender,
      body,
      channel
    );

    if (result.isComplianceAction) {
      return res.json({
        success: true,
        isComplianceAction: true,
        replyText: result.replyText,
        message: "Inbound message processed as a compliance keywords transaction",
      });
    }

    const isSms = channel === "SMS";
    const normalizedContact = isSms
      ? sender.replace(/\D/g, "")
      : sender.trim().toLowerCase();

    const leads = await prisma.lead.findMany({
      where: {
        companyId,
        OR: [
          { email: normalizedContact },
          { phone: { contains: normalizedContact.slice(-10) } },
        ],
      },
    });

    if (leads.length > 0) {
      for (const lead of leads) {
        const { inngest } = await import("../lib/inngest.js");
        await inngest.send({ name: "campaign.exit", data: { leadId: lead.id, reason: "REPLY" } });
        await inngest.send({
          name: "lead.reply.received",
          data: { leadId: lead.id, companyId, channel, body, sender },
        });
        await markLeadEngaged(lead.id);
        await triggerAutomation({ companyId, leadId: lead.id, event: "LEAD_REPLIED", context: { channel } });
      }

      return res.json({
        success: true,
        isComplianceAction: false,
        processed: true,
        leadsMatched: leads.length,
        message: "Processed inbound reply",
      });
    }

    return res.json({
      success: true,
      isComplianceAction: false,
      processed: false,
      message: "No matching lead found to attach this reply to",
    });
  } catch (error) {
    console.error("[Inbound Webhook] Error:", error);
    return res
      .status(500)
      .json({ message: error.message || "Internal server error" });
  }
};

export const unsubscribeByLead = async (req, res) => {
  try {
    const { leadId } = req.params;
    const channel = String(req.query.channel || req.body?.channel || "EMAIL").toUpperCase();
    const isEmail = channel !== "SMS";

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: { company: true },
    });
    if (!lead) {
      return res.status(404).json({ success: false, message: "This unsubscribe link is invalid or has expired." });
    }

    const value = isEmail ? lead.email : lead.phone;
    if (value) {
      const normalized = isEmail ? value.trim().toLowerCase() : value.replace(/\D/g, "");
      await prisma.suppressionList.upsert({
        where: { companyId_value: { companyId: lead.companyId, value: normalized } },
        create: { companyId: lead.companyId, value: normalized, reason: "UNSUBSCRIBE" },
        update: { reason: "UNSUBSCRIBE" },
      });
    }

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        ...(isEmail ? { emailOptIn: false } : { smsOptIn: false }),
        consentSource: isEmail ? "Email unsubscribe link" : "SMS unsubscribe link",
        consentTimestamp: new Date(),
      },
    });

    import("../lib/inngest.js")
      .then(({ inngest }) =>
        inngest.send({ name: "campaign.exit", data: { leadId: lead.id, reason: "UNSUBSCRIBE" } }),
      )
      .catch((e) =>
        console.error("[Unsubscribe] campaign.exit dispatch failed:", e?.message || e),
      );

    writeBackLeadToSalesforce(
      lead.companyId,
      lead.id,
      isEmail ? { emailOptIn: false } : { smsOptIn: false },
    ).catch((e) => console.error("[Unsubscribe] Salesforce write-back failed:", e?.message || e));

    return res.json({
      success: true,
      channel: isEmail ? "EMAIL" : "SMS",
      email: isEmail ? lead.email : null,
      companyName: lead.company?.name || null,
    });
  } catch (error) {
    console.error("[Unsubscribe Link] Error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};

export const unsubscribeWebhook = async (req, res) => {
  try {
    const { email, phone, companyId } = req.body;

    if (!companyId) {
      return res.status(400).json({ message: "companyId is required." });
    }

    if (!email && !phone) {
      return res.status(400).json({ message: "Either email or phone must be provided." });
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company) {
      return res.status(404).json({ message: "Company not found." });
    }

    const isEmail = !!email;
    const normalizedValue = isEmail
      ? email.trim().toLowerCase()
      : phone.replace(/\D/g, "");

    if (!normalizedValue) {
      return res.status(400).json({ message: "Normalized value is empty." });
    }

    const suppressionItem = await prisma.suppressionList.upsert({
      where: {
        companyId_value: {
          companyId,
          value: normalizedValue,
        },
      },
      create: {
        companyId,
        value: normalizedValue,
        reason: "UNSUBSCRIBE",
      },
      update: {
        reason: "UNSUBSCRIBE",
      },
    });

    let leadsToUpdate = [];
    if (isEmail) {
      leadsToUpdate = await prisma.lead.findMany({
        where: {
          companyId,
          email: normalizedValue,
        },
      });

      if (leadsToUpdate.length > 0) {
        await prisma.lead.updateMany({
          where: {
            companyId,
            email: normalizedValue,
          },
          data: {
            emailOptIn: false,
            consentSource: "Unsubscribe Webhook",
            consentTimestamp: new Date(),
          },
        });
      }
    } else {
      leadsToUpdate = await prisma.lead.findMany({
        where: {
          companyId,
          phone: { contains: normalizedValue.slice(-10) },
        },
      });

      if (leadsToUpdate.length > 0) {
        await prisma.lead.updateMany({
          where: {
            companyId,
            phone: { contains: normalizedValue.slice(-10) },
          },
          data: {
            smsOptIn: false,
            consentSource: "Unsubscribe Webhook",
            consentTimestamp: new Date(),
          },
        });
      }
    }

    for (const lead of leadsToUpdate) {
      import("../lib/inngest.js")
        .then(({ inngest }) =>
          inngest.send({ name: "campaign.exit", data: { leadId: lead.id, reason: "UNSUBSCRIBE" } }),
        )
        .catch((e) =>
          console.error("[Unsubscribe Webhook] campaign.exit dispatch failed:", e?.message || e),
        );
    }

    return res.json({
      success: true,
      message: `Successfully processed unsubscribe webhook for ${isEmail ? "email" : "phone"}.`,
      leadsUpdated: leadsToUpdate.length,
      suppressedItem: suppressionItem,
    });
  } catch (error) {
    console.error("[Unsubscribe Webhook] Error:", error);
    return res.status(500).json({ message: error.message || "Internal server error" });
  }
};



// Replies come back to reply+<companyId>@<inbound domain> when an inbound
// domain is configured, which makes attribution exact rather than inferred.
function companyIdFromReplyAddress(to) {
  const addresses = Array.isArray(to) ? to : to ? [to] : [];
  for (const entry of addresses) {
    const address = typeof entry === "string" ? entry : entry?.Address;
    const match = /(?:^|<)\s*reply\+([A-Za-z0-9_-]+)@/i.exec(String(address || ""));
    if (match) return match[1];
  }
  return null;
}

export const processBrevoInboundEmail = async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ message: "Invalid payload format. Expected 'items' array." });
    }

    let processedCount = 0;

    for (const item of items) {
      const fromEmail = item.From?.Address;
      const textBody = item.RawTextBody || item.TextBody || item.ExtractedMarkdownMessage || "";
      const htmlBody = item.RawHtmlBody || item.HtmlBody || "";

      if (!fromEmail) {
        console.warn("[Brevo Webhook] Item is missing From.Address, skipping.");
        continue;
      }

      const normalizedEmail = fromEmail.trim().toLowerCase();

      // Attribution, best source first: the tenant id encoded in the address
      // they replied to, then an explicit query parameter, then what we know we
      // last sent them. Ambiguity is left unrouted rather than guessed at.
      let companyId =
        companyIdFromReplyAddress(item.To) ||
        req.query.companyId ||
        req.body.companyId ||
        null;

      if (!companyId) {
        const resolution = await resolveInboundCompany(normalizedEmail, "EMAIL");
        companyId = resolution.companyId;
        if (!companyId) {
          console.warn(
            `[Brevo Webhook] \u26a0 Could not attribute reply from ${normalizedEmail} ` +
              `(${resolution.reason}). Not routing it.`,
          );
          continue;
        }
        console.log(`[Brevo Webhook] attributed ${normalizedEmail} to ${companyId} (${resolution.reason}).`);
      }

      const leads = await prisma.lead.findMany({
        where: {
          companyId,
          email: normalizedEmail,
        },
      });

      if (leads.length === 0) {
        console.warn(`[Brevo Webhook] \u26a0 No lead with email ${normalizedEmail} in company ${companyId}.`);
      }

      for (const lead of leads) {
        const replyContent = textBody || htmlBody || "No body content";
        const { inngest } = await import("../lib/inngest.js");
        await inngest.send({ name: "campaign.exit", data: { leadId: lead.id, reason: "REPLY" } });
        await inngest.send({
          name: "lead.reply.received",
          data: { leadId: lead.id, companyId, channel: "EMAIL", body: replyContent, sender: normalizedEmail },
        });
        await markLeadEngaged(lead.id);
        await triggerAutomation({ companyId, leadId: lead.id, event: "LEAD_REPLIED", context: { channel: "EMAIL" } });
      }

      processedCount++;
    }

    return res.json({
      success: true,
      processedItems: processedCount,
    });
  } catch (error) {
    console.error("[Brevo Webhook] Error processing inbound email:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

function escapeXml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twiml(message) {
  const inner = message ? `<Message>${escapeXml(message)}</Message>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

// Provider-agnostic handling of one inbound SMS: opt-out/opt-in keywords first,
// then reply-detection (exit sequences + wake the AI agent) for matching leads.
// Returns { complianceReply } when a keyword was handled, else {}.
// How far back an outbound message still counts as "the conversation they are
// replying to", and the window inside which two tenants messaging the same
// number makes the reply genuinely ambiguous.
const CONVERSATION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const CONTENTION_WINDOW_MS = 24 * 60 * 60 * 1000;

// A shared sending number carries no tenant identity, so an inbound reply has
// to be attributed from what we know we sent. Ambiguity fails closed: routing a
// lead's reply to the wrong builder exposes one customer's message to another,
// which is worse than not routing it at all.
function normalizeContactFor(channel, value) {
  return channel === "SMS"
    ? normalizePhone(value)
    : String(value || "").trim().toLowerCase();
}

async function resolveInboundCompany(sender, channel = "SMS") {
  const recipient = normalizeContactFor(channel, sender);
  if (!recipient) return { companyId: null, reason: "no-contact" };

  const since = new Date(Date.now() - CONVERSATION_WINDOW_MS);
  const outbound = await prisma.messageUsage
    .findMany({
      where: {
        channel,
        recipient,
        companyId: { not: null },
        // A rejected send never reached them, so it is not a conversation they
        // could be replying to — and counting it would invent contention.
        outcome: "sent",
        createdAt: { gte: since },
      },
      select: { companyId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    })
    .catch(() => []);

  if (outbound.length) {
    const distinct = [...new Set(outbound.map((r) => r.companyId))];
    if (distinct.length === 1) {
      return { companyId: distinct[0], reason: "last-conversation" };
    }

    // Several tenants have messaged this number. Only the most recent one is a
    // safe guess, and only if nobody else was also talking to them just now.
    const contentionSince = Date.now() - CONTENTION_WINDOW_MS;
    const recent = outbound.filter((r) => r.createdAt.getTime() >= contentionSince);
    const recentDistinct = [...new Set(recent.map((r) => r.companyId))];
    if (recentDistinct.length === 1) {
      return { companyId: recentDistinct[0], reason: "most-recent-conversation" };
    }
    return { companyId: null, reason: "ambiguous-conversation", candidates: distinct };
  }

  // Nothing sent from here — fall back to the number being a lead for exactly
  // one tenant.
  const leads = await prisma.lead
    .findMany({
      where:
        channel === "SMS"
          ? { phone: { contains: recipient.slice(-10) } }
          : { email: recipient },
      select: { companyId: true },
    })
    .catch(() => []);

  const leadCompanies = [...new Set(leads.map((l) => l.companyId))];
  if (leadCompanies.length === 1) return { companyId: leadCompanies[0], reason: "unique-lead" };
  if (leadCompanies.length > 1) {
    return { companyId: null, reason: "ambiguous-lead", candidates: leadCompanies };
  }

  return { companyId: null, reason: "unknown" };
}

async function routeInboundSms({ companyId, sender, body, toNumber, provider }) {
  console.log(`[SMS IN] ← inbound SMS (${provider}) | company=${companyId} from=${sender || "?"} to=${toNumber || "?"} | body="${(body || "").replace(/\s+/g, " ").slice(0, 160)}"`);

  if (!sender || !body) {
    console.warn("[SMS IN] Missing From/Body, skipping.");
    return {};
  }

  const normalizedContact = sender.replace(/\D/g, "");

  const result = await ComplianceService.handleInboundKeyword(companyId, sender, body, "SMS");

  if (result.isComplianceAction) {
    console.log(`[SMS IN] compliance keyword handled (${result.action || "opt-out/opt-in"}) — no agent trigger.`);
    return { complianceReply: result.replyText };
  }

  // The keyword handler above deliberately ran with the companyId as it
  // arrived: on a shared number a STOP is carrier-scoped to the number, so it
  // has to suppress platform-wide rather than for one tenant. Agent routing is
  // the opposite — it needs to know exactly whose lead this is.
  let resolvedCompanyId = companyId;
  if (!resolvedCompanyId) {
    const resolution = await resolveInboundCompany(sender, "SMS");
    resolvedCompanyId = resolution.companyId;

    if (!resolvedCompanyId) {
      console.warn(
        `[SMS IN] ⚠ Could not attribute reply from ${sender} to a tenant (${resolution.reason}` +
          `${resolution.candidates ? `, candidates: ${resolution.candidates.join(", ")}` : ""}). ` +
          `Not routing it — a reply sent to the wrong builder is worse than one left unrouted.`,
      );
      return { unattributed: true, reason: resolution.reason };
    }

    console.log(`[SMS IN] attributed reply from ${sender} to company ${resolvedCompanyId} (${resolution.reason}).`);
  }

  const leads = await prisma.lead.findMany({
    where: {
      companyId: resolvedCompanyId,
      phone: { contains: normalizedContact.slice(-10) },
    },
  });

  if (leads.length === 0) {
    console.warn(`[SMS IN] ⚠ No lead with phone ${sender} in company ${resolvedCompanyId} — nothing to trigger.`);
    return { unmatched: true };
  }

  console.log(`[SMS IN] matched ${leads.length} lead(s) for ${sender} in company ${resolvedCompanyId}.`);

  for (const lead of leads) {
    const { inngest } = await import("../lib/inngest.js");
    await inngest.send({ name: "campaign.exit", data: { leadId: lead.id, reason: "REPLY" } });
    await inngest.send({
      name: "lead.reply.received",
      data: { leadId: lead.id, companyId: resolvedCompanyId, channel: "SMS", body, sender },
    });
    await markLeadEngaged(lead.id);
    await triggerAutomation({ companyId: resolvedCompanyId, leadId: lead.id, event: "LEAD_REPLIED", context: { channel: "SMS" } });
    console.log(`[SMS IN] → triggered AI agent (lead.reply.received) for lead=${lead.id} (${lead.firstName || ""} ${lead.lastName || ""})`);
  }

  return {};
}

export const processTwilioInboundSms = async (req, res) => {
  const sendTwiml = (message) => res.status(200).type("text/xml").send(twiml(message));

  try {
    // No companyId means this arrived on the shared number's static webhook
    // rather than in reply to a send of ours. It is still handled — a dropped
    // STOP is a compliance failure, not a routing inconvenience.
    const companyId = req.query.companyId || req.body?.companyId || null;

    const { complianceReply } = await routeInboundSms({
      companyId,
      sender: req.body.From || req.body.from || req.body.sender,
      body: req.body.Body || req.body.body || req.body.text || "",
      toNumber: req.body.To || req.body.to || "",
      provider: "TWILIO_SMS",
    });

    return sendTwiml(complianceReply);
  } catch (error) {
    console.error("[Twilio SMS Webhook] Error processing inbound SMS:", error);
    return res.status(200).type("text/xml").send(twiml());
  }
};

export const processTelnyxInboundSms = async (req, res) => {
  try {
    const companyId = req.query.companyId || req.body?.companyId || null;

    const event = req.body?.data;
    const eventType = event?.event_type;

    // The messaging profile posts delivery events (message.sent/message.finalized)
    // to the same URL — acknowledge and ignore anything that isn't an inbound message.
    if (eventType !== "message.received") {
      console.log(`[SMS IN] Telnyx event "${eventType || "unknown"}" ignored.`);
      return res.status(200).json({ received: true });
    }

    const payload = event.payload || {};

    // Telnyx has no TwiML equivalent, and it auto-responds to STOP/HELP at the
    // carrier level, so a compliance reply is recorded but not sent from here.
    const { complianceReply } = await routeInboundSms({
      companyId,
      sender: payload.from?.phone_number,
      body: payload.text || "",
      toNumber: payload.to?.[0]?.phone_number || "",
      provider: "TELNYX_SMS",
    });

    if (complianceReply) {
      console.log(`[SMS IN] Telnyx handles the keyword auto-reply — suppressed our own: "${complianceReply}"`);
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("[Telnyx SMS Webhook] Error processing inbound SMS:", error);
    return res.status(200).json({ received: true });
  }
};
