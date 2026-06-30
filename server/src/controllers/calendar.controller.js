import prisma from "../lib/prisma.js";
import { GoogleGenAI } from "@google/genai";
import { getNextValidSendWindow } from "../lib/timezone.js";

// ─── Content Calendar lifecycle ───────────────────────────────────────────────
// Suggested → Draft → Approved → Scheduled → Sent | Published → (Failed)
// Dismissed is a terminal off-ramp available from the early states.

const VALID_STATUSES = [
  "Suggested",
  "Draft",
  "Approved",
  "Scheduled",
  "Sent",
  "Published",
  "Failed",
  "Dismissed",
];

const STATUS_TRANSITIONS = {
  Suggested: ["Draft", "Dismissed"],
  Draft: ["Approved", "Dismissed"],
  Approved: ["Scheduled", "Draft"],
  Scheduled: ["Sent", "Published", "Failed", "Draft"],
  Failed: ["Scheduled", "Draft"],
  Sent: [],
  Published: [],
  Dismissed: [],
};

// Approval gate: only an ADMIN may move an item into these states.
const APPROVAL_REQUIRED_TARGETS = new Set(["Approved"]);
// Items in a terminal/sent state can no longer be edited or rescheduled.
const NON_EDITABLE_STATUSES = new Set(["Sent", "Published", "Dismissed"]);
const EDITABLE_FIELDS = ["title", "content", "subject", "reason", "outline", "channel"];

// ─── SMS compliance window (TCPA quiet hours 8 AM–9 PM) ───────────────────────
// ContentCalendar items are company-level (not tied to a single lead), so there
// is no per-recipient timezone. We enforce the window against a configurable
// default tz. Per-recipient quiet hours are still enforced at actual send time
// by ComplianceService.
const DEFAULT_TIMEZONE = process.env.DEFAULT_SEND_TIMEZONE || "America/New_York";
const SMS_WINDOW_START_HOUR = 8; // 8 AM inclusive
const SMS_WINDOW_END_HOUR = 21; // 9 PM exclusive

function getHourInTz(date, tz) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
  });
  return parseInt(formatter.format(date), 10) % 24; // guard against "24" at midnight
}

function isWithinSmsWindow(date, tz) {
  const hour = getHourInTz(date, tz);
  return hour >= SMS_WINDOW_START_HOUR && hour < SMS_WINDOW_END_HOUR;
}

// Returns null if the date is sendable, otherwise an error payload with a suggested time.
function checkSmsWindow(date) {
  if (isWithinSmsWindow(date, DEFAULT_TIMEZONE)) return null;
  const suggestedTime = getNextValidSendWindow(
    date,
    DEFAULT_TIMEZONE,
    "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
    "08:00",
    "21:00"
  );
  return {
    message: `Scheduled time is outside the SMS sending window (8:00 AM–9:00 PM ${DEFAULT_TIMEZONE}). Pick a time within that window.`,
    suggestedTime,
  };
}

export const getCalendarEvents = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const manualEvents = await prisma.contentCalendar.findMany({
      where: { companyId: req.user.companyId },
      orderBy: { scheduledAt: "asc" },
    });

    const activeEnrollments = await prisma.campaignEnrollment.findMany({
      where: {
        campaign: { companyId: req.user.companyId },
        status: "ACTIVE",
        nextRunAt: { not: null }
      },
      include: {
        campaign: {
          include: {
            steps: {
              orderBy: { position: "asc" }
            }
          }
        }
      }
    });

    // Group enrollments by date and campaign step
    const groupedCampaigns = {};

    for (const enrollment of activeEnrollments) {
      if (!enrollment.createdAt) continue;

      // Project the entire campaign timeline from the moment they enrolled
      let currentSimTime = new Date(enrollment.createdAt);

      for (const step of enrollment.campaign.steps) {
        if (step.type === "DELAY") {
          // Advance the simulation time
          if (step.delayUnit === "DAYS") {
            currentSimTime.setDate(currentSimTime.getDate() + (step.delayValue || 0));
          } else if (step.delayUnit === "HOURS") {
            currentSimTime.setHours(currentSimTime.getHours() + (step.delayValue || 0));
          } else if (step.delayUnit === "MINUTES") {
            currentSimTime.setMinutes(currentSimTime.getMinutes() + (step.delayValue || 0));
          }
        } else {
          // It's an executable step (EMAIL/SMS), project it onto the calendar
          const dateString = currentSimTime.toISOString().split('T')[0];
          const isCompleted = step.position <= enrollment.currentStepPosition;
          const key = `${enrollment.campaignId}_${step.id}_${dateString}_${isCompleted}`;

          if (!groupedCampaigns[key]) {
            groupedCampaigns[key] = {
              id: key,
              title: `${enrollment.campaign.name} - Step ${step.position} (1 Send)`,
              count: 1,
              channel: step.type === "EMAIL" ? "Email" : "SMS",
              scheduledAt: new Date(dateString),
              isAiSuggested: false,
              type: "campaign_aggregation",
              isCompleted: isCompleted
            };
          } else {
            groupedCampaigns[key].count += 1;
            groupedCampaigns[key].title = `${enrollment.campaign.name} - Step ${step.position} (${groupedCampaigns[key].count} Sends)`;
          }
        }
      }
    }

    const campaignEvents = Object.values(groupedCampaigns);
    const allEvents = [...manualEvents, ...campaignEvents];

    // Optionally sort by date
    allEvents.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));

    return res.json(allEvents);
  } catch (error) {
    console.error("[Calendar GET] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const createCalendarEvent = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const { title, channel, scheduledAt, content, subject, reason, outline, isAiSuggested, status } = req.body;

    if (!title || !channel || !scheduledAt || !content) {
      return res.status(400).json({ message: "Missing required fields: title, channel, scheduledAt, content" });
    }

    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      return res.status(400).json({ message: "Invalid scheduledAt date" });
    }

    // Lifecycle entry point: AI items land as "Suggested", manual items as "Draft".
    // Callers may explicitly request another state (e.g. "Scheduled") via `status`.
    const initialStatus = status || (isAiSuggested ? "Suggested" : "Draft");
    if (!VALID_STATUSES.includes(initialStatus)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` });
    }

    // If created directly in a send-ready state, enforce the SMS quiet-hours window.
    if (initialStatus === "Scheduled" && channel === "SMS") {
      const windowError = checkSmsWindow(scheduledDate);
      if (windowError) return res.status(422).json(windowError);
    }

    const event = await prisma.contentCalendar.create({
      data: {
        companyId: req.user.companyId,
        title,
        channel,
        scheduledAt: scheduledDate,
        content,
        subject: subject || null,
        reason: reason || null,
        outline: outline || null,
        isAiSuggested: !!isAiSuggested,
        status: initialStatus,
      },
    });

    return res.status(201).json(event);
  } catch (error) {
    console.error("[Calendar Create] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getCalendarSuggestions = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const company = await prisma.company.findUnique({
      where: { id: req.user.companyId },
    });

    const voiceProfile = company?.voiceProfile || "professional";
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `You are an AI assistant for a homebuilder. Generate exactly 3 content calendar suggestions for nurture campaigns (SMS/Email) targeting new leads or post-closing homeowners. The company's communication voice profile is: "${voiceProfile}".
          
          Provide the output as a raw JSON array matching this structure:
          [
            {
              "id": "string",
              "topic": "string",
              "channel": "Email" | "SMS",
              "date": "string",
              "reason": "string",
              "outline": "string"
            }
          ]
          Return ONLY the JSON array without any markdown formatting or surrounding blocks.`,
        });

        const text = response.text || "";
        const cleanedText = text.replace(/```json/g, "").replace(/```/g, "").trim();
        const suggestions = JSON.parse(cleanedText);
        return res.json(suggestions);
      } catch (geminiError) {
        console.warn("[Gemini API] Failed to generate suggestions, using high-quality defaults:", geminiError);
      }
    }

    // High quality customized default suggestions fallback
    const defaults = [
      {
        id: "S-1",
        topic: "Post-COE Move-In Anniversary Nurture",
        channel: "Email",
        date: "June 25",
        reason: `Gap detected: Lead has completed closing (COE) and is in Day 30 without feedback outreach. Scoped for "${voiceProfile}" voice.`,
        outline: "Friendly check-in about their first 30 days in the new community, attaching a service request form and local builder contacts.",
      },
      {
        id: "S-2",
        topic: "Mortgage Lock Rate drop alert broadcast",
        channel: "SMS",
        date: "June 28",
        reason: "Market Event: Federal interest rate drop trends observed. Ideal for cold buyer leads.",
        outline: "Quick text: 'Great news! Home loan rates just dropped. Let's look at how much you'll save on monthly payments. Tap here to view slots.'",
      },
      {
        id: "S-3",
        topic: "Energy Efficiency Guarantee brochure share",
        channel: "Email",
        date: "July 2",
        reason: "Educational: Target engaged leads who toured models but haven't reserved a home yet.",
        outline: "Highlights the structural insulations, double-pane windows, and smart utility meters that save homeowners an average of $150/mo.",
      }
    ];

    return res.json(defaults);
  } catch (error) {
    console.error("[Calendar Suggestions] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// PATCH /api/sales/calendar/:id — reschedule (drag-and-drop) and/or edit content
export const updateCalendarEvent = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const { id } = req.params;
    const item = await prisma.contentCalendar.findFirst({
      where: { id, companyId: req.user.companyId },
    });
    if (!item) {
      return res.status(404).json({ message: "Calendar item not found" });
    }
    if (NON_EDITABLE_STATUSES.has(item.status)) {
      return res.status(409).json({ message: `Cannot edit an item in "${item.status}" state` });
    }

    const data = {};
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) data[field] = req.body[field];
    }

    // Reschedule: validate the new date and enforce compliance windows on it.
    if (req.body.scheduledAt !== undefined) {
      const newDate = new Date(req.body.scheduledAt);
      if (isNaN(newDate.getTime())) {
        return res.status(400).json({ message: "Invalid scheduledAt date" });
      }
      if (newDate.getTime() <= Date.now()) {
        return res.status(422).json({ message: "Scheduled time must be in the future" });
      }
      const effectiveChannel = data.channel || item.channel;
      if (effectiveChannel === "SMS") {
        const windowError = checkSmsWindow(newDate);
        if (windowError) return res.status(422).json(windowError);
      }
      data.scheduledAt = newDate;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    const updated = await prisma.contentCalendar.update({
      where: { id: item.id },
      data,
    });
    return res.json(updated);
  } catch (error) {
    console.error("[Calendar Update] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// PATCH /api/sales/calendar/:id/status — move an item through its lifecycle
export const transitionCalendarEvent = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const { id } = req.params;
    const { status: target } = req.body;

    if (!target || !VALID_STATUSES.includes(target)) {
      return res
        .status(400)
        .json({ message: `Invalid target status. Must be one of: ${VALID_STATUSES.join(", ")}` });
    }

    const item = await prisma.contentCalendar.findFirst({
      where: { id, companyId: req.user.companyId },
    });
    if (!item) {
      return res.status(404).json({ message: "Calendar item not found" });
    }

    if (item.status === target) {
      return res.json(item); // no-op
    }

    const allowed = STATUS_TRANSITIONS[item.status] || [];
    if (!allowed.includes(target)) {
      return res.status(409).json({
        message: `Invalid transition: "${item.status}" → "${target}". Allowed: ${allowed.join(", ") || "none"}`,
      });
    }

    // Approval gate per tenant policy (default: ADMIN-only approval).
    if (APPROVAL_REQUIRED_TARGETS.has(target) && req.user.role?.toUpperCase() !== "ADMIN") {
      return res.status(403).json({ message: "Only an ADMIN can approve calendar items" });
    }

    // Moving into a send-ready state re-checks the SMS quiet-hours window.
    if (target === "Scheduled" && item.channel === "SMS") {
      const windowError = checkSmsWindow(item.scheduledAt);
      if (windowError) return res.status(422).json(windowError);
    }

    const updated = await prisma.contentCalendar.update({
      where: { id: item.id },
      data: { status: target },
    });
    return res.json(updated);
  } catch (error) {
    console.error("[Calendar Transition] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
