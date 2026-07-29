import prisma from "../lib/prisma.js";
import { ComplianceService } from "../services/compliance-service.js";
import { triggerAutomation } from "../lib/automation-events.js";
import { writeBackLeadToSalesforce } from "../services/salesforce-writeback.js";
import { LEAD_STATUS } from "../lib/lead-statuses.js";

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


export const processTwilioSmsStatus = async (req, res) => {
  try {
    const companyId = req.query.companyId || req.body?.companyId;
    if (!companyId) {
      return res.status(400).json({ message: "companyId is required." });
    }

    const phone = req.body.To || req.body.to;
    const status = req.body.MessageStatus || req.body.SmsStatus || req.body.status || "";
    if (!phone || !status) {
      return res.status(200).json({ success: true, handled: 0 });
    }

    const result = await ComplianceService.handleMessageEvent({
      companyId,
      channel: "SMS",
      provider: "TWILIO_SMS",
      contact: phone,
      rawEventType: status,
      errorCode: req.body.ErrorCode || null,
      metadata: {
        messageId: req.body.MessageSid || req.body.SmsSid,
        reason: req.body.ErrorMessage,
        tag: req.query.tag || null,
      },
    });

    return res.status(200).json({ success: true, handled: result.handled ? 1 : 0 });
  } catch (error) {
    console.error("[Twilio SMS Status] Error:", error);
    return res.status(500).json({ message: error.message || "Internal server error" });
  }
};



export const processBrevoInboundEmail = async (req, res) => {
  try {
    const companyId = req.query.companyId || req.body.companyId;

    if (!companyId) {
      return res.status(400).json({ message: "companyId is required." });
    }

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
      const leads = await prisma.lead.findMany({
        where: {
          companyId,
          email: normalizedEmail,
        },
      });

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

export const processTwilioInboundSms = async (req, res) => {
  const sendTwiml = (message) => res.status(200).type("text/xml").send(twiml(message));

  try {
    const companyId = req.query.companyId || req.body?.companyId;
    if (!companyId) {
      return res.status(400).json({ message: "companyId is required." });
    }

    const sender = req.body.From || req.body.from || req.body.sender;
    const body = req.body.Body || req.body.body || req.body.text || "";
    const toNumber = req.body.To || req.body.to || "";

    console.log(`[SMS IN] ← inbound SMS | company=${companyId} from=${sender || "?"} to=${toNumber || "?"} | body="${(body || "").replace(/\s+/g, " ").slice(0, 160)}"`);

    if (!sender || !body) {
      console.warn("[SMS IN] Missing From/Body, skipping.");
      return sendTwiml();
    }

    const normalizedContact = sender.replace(/\D/g, "");

    const result = await ComplianceService.handleInboundKeyword(
      companyId,
      sender,
      body,
      "SMS"
    );

    if (result.isComplianceAction) {
      console.log(`[SMS IN] compliance keyword handled (${result.action || "opt-out/opt-in"}) — replying via TwiML, no agent trigger.`);
      return sendTwiml(result.replyText);
    }

    const leads = await prisma.lead.findMany({
      where: {
        companyId,
        phone: { contains: normalizedContact.slice(-10) },
      },
    });

    console.log(`[SMS IN] matched ${leads.length} lead(s) for ${sender} in company ${companyId}${leads.length === 0 ? " — no lead with this phone, nothing to trigger" : ""}.`);

    for (const lead of leads) {
      const { inngest } = await import("../lib/inngest.js");
      await inngest.send({ name: "campaign.exit", data: { leadId: lead.id, reason: "REPLY" } });
      await inngest.send({
        name: "lead.reply.received",
        data: { leadId: lead.id, companyId, channel: "SMS", body, sender },
      });
      await markLeadEngaged(lead.id);
      await triggerAutomation({ companyId, leadId: lead.id, event: "LEAD_REPLIED", context: { channel: "SMS" } });
      console.log(`[SMS IN] → triggered AI agent (lead.reply.received) for lead=${lead.id} (${lead.firstName || ""} ${lead.lastName || ""})`);
    }

    return sendTwiml();
  } catch (error) {
    console.error("[Twilio SMS Webhook] Error processing inbound SMS:", error);
    return res.status(200).type("text/xml").send(twiml());
  }
};
