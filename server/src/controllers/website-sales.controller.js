import { waitUntil } from "@vercel/functions";
import prisma from "../lib/prisma.js";
import { toolCall } from "../lib/llm.js";
import { websiteVisitorKey } from "../middlewares/website-intake-auth.js";
import { writeAuditLog } from "../lib/audit.js";
import { inngest } from "../lib/inngest.js";
import { deliverWebsiteInquiry } from "../services/website-inquiry-mail.js";
import { saveConsultation, CONSULTATION_FIELDS, isApproval, consultationSummary, preferenceError, nextConsultationField, resolveConsultationTimezone, consultationTimezoneLabel, normalizeConsultationDate, normalizeConsultationTime } from "../services/website-sales.js";
import { getB2BAvailability } from "../lib/b2b.js";
import { parseWebsiteInquiry } from "../lib/website-inquiry.js";
import { WEBSITE_PROMPT_KEY, WEBSITE_DEFAULT_PROMPT, WEBSITE_RULES } from "../prompts/content.js";
import { WEBSITE_PRODUCT_GUIDE } from "../prompts/help-agent.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const savedMessage = "Your Product Consultation request has been saved. Your preferred time is pending confirmation by our team. Email and SMS acknowledgments have been queued; this does not confirm the meeting time. Is there anything else you would like to know about our products?";

export async function websiteSales(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const { conversationId, message, page = "/", action } = req.body || {};
  const requestId = req.get("Idempotency-Key") || "";
  let locked = false;
  const leaseUntil = new Date(Date.now() + 120_000);
  try {
    if (action !== "chat" || !uuid.test(conversationId || "") || !uuid.test(requestId) || typeof message !== "string" || !message.trim() || message.length > 2000 || typeof page !== "string" || !/^\/(?!\/)[^\r\n]{0,499}$/.test(page)) return res.status(400).json({ message: "Please refresh the chat and try again." });
    const visitorKey = websiteVisitorKey(req);
    await prisma.websiteConversation.upsert({ where: { id: conversationId }, create: { id: conversationId, visitorKey, page, messages: [], draft: {} }, update: {} });
    let session = await prisma.websiteConversation.findUnique({ where: { id: conversationId } });
    if (session.visitorKey !== visitorKey) return res.status(403).json({ message: "Please start a new conversation." });
    if (session.lastRequestId === requestId) {
      if (session.lastRequestText !== message.trim()) return res.status(409).json({ message: "Request ID already used for another message." });
      return res.json(session.lastResponse);
    }
    const claim = await prisma.websiteConversation.updateMany({ where: { id: conversationId, OR: [{ processingUntil: null }, { processingUntil: { lt: new Date() } }] }, data: { processingUntil: leaseUntil } });
    if (!claim.count) return res.status(409).json({ message: "Your previous message is still being processed. Please retry shortly." });
    locked = true;
    session = await prisma.websiteConversation.findUnique({ where: { id: conversationId } });
    if (session.lastRequestId === requestId) {
      if (session.lastRequestText !== message.trim()) return res.status(409).json({ message: "Request ID already used for another message." });
      return res.json(session.lastResponse);
    }
    await writeAuditLog({ req, action: "website_agent.request_received", targetType: "WebsiteConversation", targetId: conversationId, metadata: { requestId, traceId: req.get("X-Request-ID") || null } });
    const draft = { ...session.draft };
    const availability = await getB2BAvailability();
    const teamTimezone = resolveConsultationTimezone(availability.timezone);
    // Preserve a previously reviewed US timezone; replace legacy non-US preferences.
    draft.timezone = session.waitingApproval && draft.timezone === resolveConsultationTimezone(draft.timezone) ? draft.timezone : teamTimezone;
    if (session.draft.timezone && session.draft.timezone !== draft.timezone) session.waitingApproval = false;
    let active = session.collecting;
    let waitingApproval = false;
    let reply;
    if (session.waitingApproval && isApproval(message) && !session.submittedAt) {
      const inquiry = await saveConsultation(conversationId, draft, session.page);
      session.submittedAt = inquiry.createdAt;
      active = false;
      // Immediate attempt; durable event/cron retries only recipients not yet sent.
      const delivery = (async () => {
        try { await deliverWebsiteInquiry(conversationId); }
        catch (error) { console.error("[Website Consultation] Immediate delivery failed", { conversationId, error: error.message }); }
        await inngest.send({ name: "b2b.website-inquiry.saved", data: { inquiryId: conversationId } }).catch(() => console.warn("[Website Consultation] Retry event deferred to cron", { conversationId }));
      })();
      waitUntil(delivery);
      reply = savedMessage;
    } else {
      const prompt = (await prisma.platformSetting.findUnique({ where: { key: WEBSITE_PROMPT_KEY } }))?.value?.prompt || WEBSITE_DEFAULT_PROMPT;
      const history = [...session.messages.slice(-30), { role: "user", content: message.trim() }];
      while (history[0]?.role !== "user") history.shift();
      const result = await toolCall({ companyId: null, source: "website-b2b-sales", system: `${prompt}\n\nPublic product guide (capabilities only; no customer records):\n${WEBSITE_PRODUCT_GUIDE}\n\n${WEBSITE_RULES}\nCurrent date in ${consultationTimezoneLabel(draft.timezone)}: ${new Intl.DateTimeFormat("en-US", { timeZone: draft.timezone, dateStyle: "full" }).format(new Date())}. All preferred times use ${draft.timezone}; never ask the visitor for a timezone.\nConsultation state: ${JSON.stringify({ active, submitted: !!session.submittedAt, draft, nextField: nextConsultationField(draft)?.[0] })}`, messages: history, maxTokens: 1500, tool: { name: "reply", description: "Respond naturally and extract only visitor-provided consultation details.", input_schema: { type: "object", properties: { message: { type: "string" }, wantsConsultation: { type: "boolean" }, cancelRequest: { type: "boolean" }, details: { type: "object", properties: Object.fromEntries(CONSULTATION_FIELDS.map(([key]) => [key, { type: ["string", "null"], maxLength: 200 }])), additionalProperties: false } }, required: ["message", "wantsConsultation", "cancelRequest", "details"], additionalProperties: false } } });
      if (!result || typeof result.message !== "string" || !result.details || typeof result.details !== "object") throw new Error("AI did not return a usable response. Check platform AI configuration and provider logs.");
      if (!session.submittedAt) {
        if (result.wantsConsultation) active = true;
        if (result.cancelRequest) { active = false; for (const key of Object.keys(draft)) delete draft[key]; }
        if (!result.cancelRequest) for (const [key] of CONSULTATION_FIELDS) if (typeof result.details[key] === "string" && result.details[key].trim()) draft[key] = result.details[key].trim().slice(0, 200);
      }
      const expected = nextConsultationField(session.draft);
      if (active && !session.submittedAt) {
        if (expected?.[0] === "preferredDate" && !result.details.preferredDate) {
          const date = normalizeConsultationDate(message, draft.timezone);
          if (date) draft.preferredDate = date;
        }
        if (expected?.[0] === "preferredTime" && !result.details.preferredTime) {
          const time = normalizeConsultationTime(message);
          if (time) draft.preferredTime = time;
        }
        if (draft.preferredDate) draft.preferredDate = normalizeConsultationDate(draft.preferredDate, draft.timezone) || draft.preferredDate;
        if (draft.preferredTime) draft.preferredTime = normalizeConsultationTime(draft.preferredTime) || draft.preferredTime;
      }
      reply = result.message.trim().slice(0, 2000);
      if (active && !session.submittedAt) {
        let invalid;
        const limits = { name: 160, email: 200, company: 200, phone: 40, role: 120, annualClosings: 40, preferredDate: 160, preferredTime: 160, timezone: 160 };
        for (const [key, limit] of Object.entries(limits)) if (draft[key]?.length > limit) { delete draft[key]; invalid ||= `Please keep your ${key} to ${limit} characters or fewer.`; }
        if (draft.email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(draft.email)) { delete draft.email; invalid = "Please provide a valid email address."; }
        if (draft.phone) {
          try { parseWebsiteInquiry({ type: "EBOOK", email: "check@example.com", phone: draft.phone, marketingConsent: false }); }
          catch { delete draft.phone; invalid = invalid || "Please provide a valid phone number, including your country code."; }
        }
        const preference = preferenceError(draft);
        if (preference) { delete draft[preference.field]; invalid = invalid || preference.message; }
        const next = nextConsultationField(draft);
        if (next) {
          // The application owns intake questions. AI text is used only for a
          // substantive visitor question, with any generated questions removed.
          const asksQuestion = /\?|\b(?:how|what|why|explain|tell me|can you|does|do you)\b/i.test(message);
          const answer = asksQuestion ? reply.split(/(?<=[.!?])\s+|\n+/).filter((part) => !part.includes("?")).join(" ") : "";
          const question = invalid || next[1];
          const timezoneNote = ["preferredDate", "preferredTime"].includes(next[0]) ? " We use " + consultationTimezoneLabel(draft.timezone) + "." : "";
          reply = [answer, question + timezoneNote].filter(Boolean).join("\n\n");
        }
        else { reply = consultationSummary(draft); waitingApproval = true; }
      }
      if (result.cancelRequest && !session.submittedAt) reply = "I haven't submitted your consultation request. What else would you like to know?";
      if (!reply) reply = "What would you like to know about AI for your building business?";
    }
    const response = { message: reply, requestId, consultationStatus: session.submittedAt ? "pending_team_confirmation" : "not_submitted" };
    const saved = await prisma.websiteConversation.updateMany({ where: { id: conversationId, processingUntil: leaseUntil }, data: { messages: [...session.messages, { role: "user", content: message.trim() }, { role: "assistant", content: reply }].slice(-100), draft, collecting: active, waitingApproval, submittedAt: session.submittedAt, lastRequestId: requestId, lastRequestText: message.trim(), lastResponse: response, lastError: null } });
    if (!saved.count) throw Object.assign(new Error("Conversation lease changed. Please retry your message."), { status: 409 });
    await writeAuditLog({ req, action: session.submittedAt ? "website_agent.consultation_saved_or_followup" : "website_agent.reply_saved", targetType: "WebsiteConversation", targetId: conversationId, metadata: { requestId, traceId: req.get("X-Request-ID") || null } });
    return res.json(response);
  } catch (error) {
    console.error("[Website Agent] Request failed", { conversationId, requestId, error: error.message });
    if (locked) await prisma.websiteConversation.updateMany({ where: { id: conversationId, processingUntil: leaseUntil }, data: { lastError: String(error.message).slice(0, 1000) } }).catch(() => {});
    await writeAuditLog({ req, action: "website_agent.request_failed", targetType: "WebsiteConversation", targetId: uuid.test(conversationId || "") ? conversationId : null, metadata: { requestId: uuid.test(requestId) ? requestId : null, error: String(error.message).slice(0, 500) } });
    return res.status(error.status || 503).json({ message: "We couldn't complete your request. Please retry or contact our team.", requestId });
  } finally {
    if (locked) await prisma.websiteConversation.updateMany({ where: { id: conversationId, processingUntil: leaseUntil }, data: { processingUntil: null } }).catch(() => {});
  }
}
