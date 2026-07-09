import prisma from "../lib/prisma.js";
import { Anthropic } from "@anthropic-ai/sdk";
import { getNextValidSendWindow } from "../lib/timezone.js";
import { inngest } from "../lib/inngest.js";

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

const APPROVAL_REQUIRED_TARGETS = new Set(["Approved"]);

const NON_EDITABLE_STATUSES = new Set(["Sent", "Published", "Dismissed"]);
const EDITABLE_FIELDS = ["title", "content", "subject", "reason", "outline", "channel"];

const DEFAULT_TIMEZONE = "America/New_York";
const SMS_WINDOW_START_HOUR = 8;
const SMS_WINDOW_END_HOUR = 21;

// SW-CAL-002: give the suggestion model an explicit seasonal signal instead of
// asking it to infer "seasonal events" from the raw date. Maps the current month
// to a season plus the notable US home-buying / marketing moments around it.
const SEASONAL_MOMENTS = {
  0: "New Year fresh-start home goals; MLK weekend",
  1: "Presidents' Day (major home-sales weekend); Valentine's Day",
  2: "Start of the spring buying season; tax-refund season",
  3: "Spring home-buying peak; Earth Day (energy-efficient homes)",
  4: "Memorial Day weekend; move-in before summer",
  5: "Summer relocation season; graduations; Father's Day",
  6: "Independence Day; mid-summer relocation",
  7: "Back-to-school move-in deadlines; end-of-summer incentives",
  8: "Fall buying season kickoff; Labor Day sales",
  9: "Fall promotions; start of year-end tax planning",
  10: "Veterans Day; holiday incentives; year-end close-outs",
  11: "Year-end tax-benefit purchases; holiday season; new-year planning",
};

function getSeasonalContext(now = new Date()) {
  const month = now.getMonth();
  const seasons = [
    "Winter", "Winter", "Spring", "Spring", "Spring", "Summer",
    "Summer", "Summer", "Fall", "Fall", "Fall", "Winter",
  ];
  return `Season: ${seasons[month]}. Notable seasonal / marketing moments around now: ${SEASONAL_MOMENTS[month]}.`;
}

function getHourInTz(date, tz) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
  });
  return parseInt(formatter.format(date), 10) % 24;
}

function isWithinSmsWindow(date, tz) {
  const hour = getHourInTz(date, tz);
  return hour >= SMS_WINDOW_START_HOUR && hour < SMS_WINDOW_END_HOUR;
}

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

    const groupedCampaigns = {};

    for (const enrollment of activeEnrollments) {
      if (!enrollment.createdAt) continue;
      let currentSimTime = new Date(enrollment.createdAt);

      for (const step of enrollment.campaign.steps) {
        if (step.type === "DELAY") {
          if (step.delayUnit === "DAYS") {
            currentSimTime.setDate(currentSimTime.getDate() + (step.delayValue || 0));
          } else if (step.delayUnit === "HOURS") {
            currentSimTime.setHours(currentSimTime.getHours() + (step.delayValue || 0));
          } else if (step.delayUnit === "MINUTES") {
            currentSimTime.setMinutes(currentSimTime.getMinutes() + (step.delayValue || 0));
          }
        } else {
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

    // SW-CAL-001: surface scheduled/sent announcements as first-class calendar
    // items alongside manual content and campaign sends.
    const announcements = await prisma.announcement.findMany({
      where: {
        companyId: req.user.companyId,
        OR: [{ scheduledAt: { not: null } }, { sentAt: { not: null } }],
      },
      select: {
        id: true,
        title: true,
        channel: true,
        status: true,
        scheduledAt: true,
        sentAt: true,
      },
    });

    const announcementEvents = announcements
      .map((a) => {
        const when = a.sentAt || a.scheduledAt;
        if (!when) return null;
        const channel =
          a.channel === "SMS"
            ? "SMS"
            : a.channel === "BOTH"
              ? "Email/SMS"
              : "Email";
        return {
          id: `announcement_${a.id}`,
          title: a.title,
          channel,
          scheduledAt: when,
          type: "announcement",
          status: a.status,
          isCompleted: !!a.sentAt || a.status === "Sent",
        };
      })
      .filter(Boolean);

    const allEvents = [...manualEvents, ...campaignEvents, ...announcementEvents];

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

    const initialStatus = status || (isAiSuggested ? "Suggested" : "Draft");
    if (!VALID_STATUSES.includes(initialStatus)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` });
    }

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
        ownerId: req.user.id,
      },
    });

    if (initialStatus === "Scheduled") {
      await inngest.send({
        name: "calendar.item.scheduled",
        data: {
          calendarId: event.id,
          scheduledAt: event.scheduledAt.toISOString()
        }
      });
    }

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

    const companyId = req.user.companyId;

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      include: { communities: { select: { name: true } } },
    });

    const voiceProfile = company?.voiceProfile || "professional";

    // SW-CAL-002: build an explicit tenant profile (markets / communities /
    // brand) so the model grounds topics in the builder's actual footprint
    // instead of just the company name + voice.
    const communityNames = (company?.communities || [])
      .map((c) => c.name)
      .filter(Boolean);
    let brandText = "";
    const brand = company?.salesBrandProfile;
    if (brand && typeof brand === "object") {
      brandText = Object.entries(brand)
        .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join("; ");
    }
    const tenantProfileText =
      [
        company?.address ? `Primary market / location: ${company.address}` : null,
        communityNames.length
          ? `Communities / markets served: ${communityNames.join(", ")}`
          : null,
        brandText ? `Brand profile: ${brandText}` : null,
      ]
        .filter(Boolean)
        .join("\n") || "No detailed tenant profile on file.";

    const seasonalContextText = getSeasonalContext();
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ message: "ANTHROPIC_API_KEY is missing. Please configure it in your environment variables." });
    }

    const existingEvents = await prisma.contentCalendar.findMany({
      where: {
        companyId,
        scheduledAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        status: { in: ["Draft", "Approved", "Scheduled", "Sent", "Published"] }
      },
      select: { scheduledAt: true, title: true, channel: true },
      orderBy: { scheduledAt: "asc" }
    });

    const existingEventsText = existingEvents
      .map(e => `${e.scheduledAt.toISOString().split('T')[0]}: ${e.channel} - ${e.title}`)
      .join("\n");

    const dismissedItems = await prisma.contentCalendar.findMany({
      where: { companyId, status: "Dismissed" },
      select: { title: true, reason: true },
      orderBy: { updatedAt: "desc" },
      take: 10
    });

    const dismissedText = dismissedItems.length > 0
      ? dismissedItems.map(d => `${d.title} (${d.reason || 'No reason'})`).join("\n")
      : "None";
    const recentNews = await prisma.scrapedNews.findMany({
      where: {
        companyId,
        publishedAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) }
      },
      select: { title: true, summary: true, source: true, publishedAt: true },
      orderBy: { publishedAt: "desc" },
      take: 8
    });

    const recentNewsText = recentNews.length > 0
      ? recentNews
        .map(n => `${n.publishedAt.toISOString().split('T')[0]} [${n.source}] ${n.title}: ${n.summary}`)
        .join("\n")
      : "No recent market news available.";

    const anthropic = new Anthropic({ apiKey });

    const systemPrompt = `You are a Content Assist Agent for a homebuilder company named "${company?.name || 'Homebuilder'}". 
Your voice profile is: "${voiceProfile}".
Your task is to generate exactly 3 content calendar suggestions for marketing (SMS, Email, Blog, or Announcement).
Current date: ${new Date().toISOString()}

Context:
Tenant profile (markets, communities, brand — tailor topics to this footprint):
${tenantProfileText}

Seasonal context (favor timely, season-appropriate angles):
${seasonalContextText}

Existing upcoming/recent scheduled events:
${existingEventsText || "No existing events."}

Recent housing-market news (ground your topics in these current events where relevant):
${recentNewsText}

Recently Dismissed Topics (DO NOT suggest these):
${dismissedText}

Requirements:
- Find schedule gaps and suggest dates (ISO 8601 strings) for the next 2-4 weeks.
- Suggest topics grounded in the tenant profile above, current real estate/mortgage market trends from the news, and the seasonal context.
- Return ONLY a raw JSON array matching this structure:
[
  {
    "topic": "string",
    "channel": "Email" | "SMS" | "Blog" | "Announcement",
    "scheduledAt": "ISO date string",
    "reason": "string (Why you suggested this, considering gaps/news)",
    "outline": "string (Draft copy or outline)"
  }
]`;

    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: "Generate the suggestions as raw JSON." }],
    });

    const text = response.content[0].text || "";
    // Clean up potential markdown blocks
    const cleanedText = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const suggestionsJson = JSON.parse(cleanedText);

    const createdSuggestions = [];
    for (const s of suggestionsJson) {
      let scheduledDate = new Date();
      if (s.scheduledAt && !isNaN(new Date(s.scheduledAt).getTime())) {
        scheduledDate = new Date(s.scheduledAt);
      }

      const item = await prisma.contentCalendar.create({
        data: {
          companyId,
          title: s.topic || "Suggested Topic",
          channel: s.channel || "Email",
          scheduledAt: scheduledDate,
          status: "Suggested",
          content: s.outline || "",
          reason: s.reason || "",
          isAiSuggested: true,
          ownerId: req.user.id
        }
      });
      createdSuggestions.push(item);
    }

    return res.json(createdSuggestions);
  } catch (error) {
    console.error("[Calendar Suggestions] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

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
      return res.json(item);
    }

    const allowed = STATUS_TRANSITIONS[item.status] || [];
    if (!allowed.includes(target)) {
      return res.status(409).json({
        message: `Invalid transition: "${item.status}" → "${target}". Allowed: ${allowed.join(", ") || "none"}`,
      });
    }

    if (APPROVAL_REQUIRED_TARGETS.has(target) && req.user.role?.toUpperCase() !== "ADMIN") {
      return res.status(403).json({ message: "Only an ADMIN can approve calendar items" });
    }
    if (target === "Scheduled" && item.channel === "SMS") {
      const windowError = checkSmsWindow(item.scheduledAt);
      if (windowError) return res.status(422).json(windowError);
    }

    const updated = await prisma.contentCalendar.update({
      where: { id: item.id },
      data: { status: target },
    });

    if (target === "Scheduled") {
      await inngest.send({
        name: "calendar.item.scheduled",
        data: {
          calendarId: updated.id,
          scheduledAt: updated.scheduledAt.toISOString()
        }
      });
    }

    return res.json(updated);
  } catch (error) {
    console.error("[Calendar Transition] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
