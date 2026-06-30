import prisma from "../lib/prisma.js";
import { ComplianceService } from "../services/compliance-service.js";

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

    // 2. Log reply to lead timeline
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
        await prisma.leadTimeline.create({
          data: {
            leadId: lead.id,
            type: "REPLY_RECEIVED",
            description: `Received inbound ${channel.toLowerCase()} reply: "${body.slice(
              0,
              150
            )}${body.length > 150 ? "..." : ""}"`,
            metadata: { body, channel, sender },
          },
        });

        const { inngest } = await import("../lib/inngest.js");
        await inngest.send({ name: "campaign.exit", data: { leadId: lead.id, reason: "REPLY" } });
        // Kick off the appointment-scheduling agent for this reply (email or SMS).
        await inngest.send({
          name: "lead.reply.received",
          data: { leadId: lead.id, companyId, channel, body, sender },
        });
      }

      return res.json({
        success: true,
        isComplianceAction: false,
        processed: true,
        leadsMatched: leads.length,
        message: "Logged inbound reply on lead timeline",
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

export const processTwilioInboundSms = async (req, res) => {
  try {
    const { From, Body } = req.body;
    // companyId might be passed via query param (e.g. ?companyId=123) by the Twilio webhook URL
    const companyId = req.query.companyId;

    if (!From || !Body || !companyId) {
      console.warn("[Twilio Webhook] Missing From, Body, or companyId");
      return res.status(400).send("Missing required parameters");
    }

    const sender = From;
    const body = Body;
    const channel = "SMS";

    const normalizedContact = sender.replace(/\D/g, "");

    // Find the lead to ensure it exists
    const leads = await prisma.lead.findMany({
      where: {
        companyId,
        phone: { contains: normalizedContact.slice(-10) },
      },
    });

    // Handle Compliance Keywords
    const result = await ComplianceService.handleInboundKeyword(
      companyId,
      sender,
      body,
      channel
    );

    // If it's a compliance action, Twilio expects TwiML response to send back the reply
    if (result.isComplianceAction) {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${result.replyText}</Message></Response>`;
      res.set("Content-Type", "text/xml");
      return res.send(twiml);
    }

    // It's a normal reply
    if (leads.length > 0) {
      for (const lead of leads) {
        // Log timeline event
        await prisma.leadTimeline.create({
          data: {
            leadId: lead.id,
            type: "REPLY_RECEIVED",
            description: `Received inbound SMS reply: "${body.slice(0, 150)}${body.length > 150 ? "..." : ""}"`,
            metadata: { body, channel, sender },
          },
        });

        // Exit active campaigns with reason REPLY via Inngest
        const { inngest } = await import("../lib/inngest.js");
        await inngest.send({ name: "campaign.exit", data: { leadId: lead.id, reason: "REPLY" } });
        // Kick off the appointment-scheduling agent for this SMS reply.
        await inngest.send({
          name: "lead.reply.received",
          data: { leadId: lead.id, companyId, channel: "SMS", body, sender },
        });
      }
    }

    // Always return empty TwiML if no automatic reply is needed
    res.set("Content-Type", "text/xml");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  } catch (error) {
    console.error("[Twilio Webhook] Error:", error);
    // Return empty TwiML on error to avoid Twilio failing aggressively
    res.set("Content-Type", "text/xml");
    return res.status(500).send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
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

    // 1. Add to suppression list
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

    // 2. Find matching leads and update opt-in flags + timeline
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

    // Create timeline events for matching leads
    for (const lead of leadsToUpdate) {
      await prisma.leadTimeline.create({
        data: {
          leadId: lead.id,
          type: "SYNC_UPDATE",
          description: `Lead opted out of ${isEmail ? "Email" : "SMS"} via unsubscribe webhook`,
          metadata: { email, phone, companyId },
        },
      });

      const { inngest } = await import("../lib/inngest.js");
      await inngest.send({ name: "campaign.exit", data: { leadId: lead.id, reason: "UNSUBSCRIBE" } });
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

/**
 * Brevo transactional email event webhook. Brevo POSTs delivery/engagement/failure events
 * either as a single object or batched under `items`/an array. Each event carries `event`,
 * `email`, and (for bounces) `reason`. companyId is supplied via the webhook URL `?companyId=`.
 */
export const processBrevoEmailEvents = async (req, res) => {
  try {
    const companyId = req.query.companyId || req.body?.companyId;
    if (!companyId) {
      return res.status(400).json({ message: "companyId is required." });
    }

    const raw = req.body;
    const events = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.items)
      ? raw.items
      : Array.isArray(raw?.events)
      ? raw.events
      : [raw];

    let handled = 0;
    for (const ev of events) {
      const email = ev.email || ev.recipient || ev["email_address"];
      const eventType = ev.event || ev.type || "";
      if (!email || !eventType) continue;

      const result = await ComplianceService.handleMessageEvent({
        companyId,
        channel: "EMAIL",
        provider: "BREVO",
        contact: email,
        rawEventType: eventType,
        metadata: {
          subject: ev.subject,
          messageId: ev["message-id"] || ev.messageId,
          reason: ev.reason,
          link: ev.link,
          tag: ev.tag,
          ts: ev.ts || ev.date,
        },
      });
      if (result.handled) handled++;
    }

    return res.json({ success: true, handled, total: events.length });
  } catch (error) {
    console.error("[Brevo Email Events] Error:", error);
    return res.status(500).json({ message: error.message || "Internal server error" });
  }
};

/**
 * Brevo transactional SMS event webhook (delivered / hard_bounce / blocked / unsubscribed …).
 */
export const processBrevoSmsEvents = async (req, res) => {
  try {
    const companyId = req.query.companyId || req.body?.companyId;
    if (!companyId) {
      return res.status(400).json({ message: "companyId is required." });
    }

    const raw = req.body;
    const events = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.items)
      ? raw.items
      : [raw];

    let handled = 0;
    for (const ev of events) {
      const phone = ev.to || ev.recipient || ev.msisdn || ev.mobile;
      const eventType = ev.event || ev.type || ev.status || "";
      if (!phone || !eventType) continue;

      const result = await ComplianceService.handleMessageEvent({
        companyId,
        channel: "SMS",
        provider: "BREVO_SMS",
        contact: phone,
        rawEventType: eventType,
        errorCode: ev.errorCode || ev.error_code || null,
        metadata: { messageId: ev.messageId || ev["message-id"], reason: ev.reason, ts: ev.ts || ev.date },
      });
      if (result.handled) handled++;
    }

    return res.json({ success: true, handled, total: events.length });
  } catch (error) {
    console.error("[Brevo SMS Events] Error:", error);
    return res.status(500).json({ message: error.message || "Internal server error" });
  }
};

/**
 * Twilio message status callback (form-encoded): MessageStatus = queued|sent|delivered|
 * undelivered|failed, plus ErrorCode for failures (21610 = STOP/opt-out, 30007 = carrier spam).
 * companyId via `?companyId=`. Responds with empty TwiML so Twilio doesn't retry.
 */
export const processTwilioStatusCallback = async (req, res) => {
  try {
    const companyId = req.query.companyId;
    const { MessageStatus, To, MessageSid, ErrorCode } = req.body || {};

    if (companyId && To && MessageStatus) {
      await ComplianceService.handleMessageEvent({
        companyId,
        channel: "SMS",
        provider: "TWILIO",
        contact: To,
        rawEventType: MessageStatus,
        errorCode: ErrorCode || null,
        metadata: { messageSid: MessageSid },
      });
    } else {
      console.warn("[Twilio Status] Missing companyId, To, or MessageStatus");
    }

    res.set("Content-Type", "text/xml");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  } catch (error) {
    console.error("[Twilio Status] Error:", error);
    res.set("Content-Type", "text/xml");
    return res.status(500).send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
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
      const subject = item.Subject || "";
      // Brevo's inbound-parse payload uses RawTextBody / RawHtmlBody (and
      // ExtractedMarkdownMessage). Fall back across the known field names so the reply body
      // is captured regardless of which Brevo provides.
      const textBody = item.RawTextBody || item.TextBody || item.ExtractedMarkdownMessage || "";
      const htmlBody = item.RawHtmlBody || item.HtmlBody || "";

      if (!fromEmail) {
        console.warn("[Brevo Webhook] Item is missing From.Address, skipping.");
        continue;
      }

      const normalizedEmail = fromEmail.trim().toLowerCase();

      // Find matching leads
      const leads = await prisma.lead.findMany({
        where: {
          companyId,
          email: normalizedEmail,
        },
      });

      for (const lead of leads) {
        // Create timeline event REPLY_RECEIVED
        const replyContent = textBody || htmlBody || "No body content";
        await prisma.leadTimeline.create({
          data: {
            leadId: lead.id,
            type: "REPLY_RECEIVED",
            description: `Received inbound email reply: "${subject}"`,
            metadata: {
              subject,
              body: replyContent.slice(0, 1000),
            },
          },
        });

        // Exit active campaigns with reason REPLY via Inngest
        const { inngest } = await import("../lib/inngest.js");
        await inngest.send({ name: "campaign.exit", data: { leadId: lead.id, reason: "REPLY" } });
        // Kick off the appointment-scheduling agent for this email reply.
        await inngest.send({
          name: "lead.reply.received",
          data: { leadId: lead.id, companyId, channel: "EMAIL", body: replyContent, sender: normalizedEmail },
        });
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
