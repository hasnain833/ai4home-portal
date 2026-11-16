import prisma from "../lib/prisma.js";
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
const EDITABLE_FIELDS = [
  "title",
  "content",
  "subject",
  "reason",
  "outline",
  "channel",
];

// The calendar plans; it doesn't send. Only a blog post linked to the item can go out from here.
const CANNOT_SEND = "The calendar can't send emails, texts or announcements. Send them from Campaigns or Announcements; this item stays on the calendar as your plan.";

const DEFAULT_TIMEZONE = "America/New_York";
const SMS_WINDOW_START_HOUR = 8;
const SMS_WINDOW_END_HOUR = 21;

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

export function getSeasonalContext(now = new Date()) {
  const month = now.getMonth();
  const seasons = [
    "Winter",
    "Winter",
    "Spring",
    "Spring",
    "Spring",
    "Summer",
    "Summer",
    "Summer",
    "Fall",
    "Fall",
    "Fall",
    "Winter",
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
    "21:00",
  );
  return {
    message: `Scheduled time is outside the SMS sending window (8:00 AM–9:00 PM ${DEFAULT_TIMEZONE}). Pick a time within that window.`,
    suggestedTime,
  };
}
function isHomeowner(req) {
  return String(req.user?.role || "").toUpperCase() === "HOMEOWNER";
}

// Scope fragment for ContentCalendar reads. Spread into a `where`.
function ownerScope(req) {
  return isHomeowner(req) ? { ownerId: req.user.id } : {};
}

export const getCalendarEvents = async (req, res) => {
  const homeowner = isHomeowner(req);

  const manualEvents = await prisma.contentCalendar.findMany({
    // A dismissed idea is only kept so it isn't offered again; it isn't part of the plan.
    where: { companyId: req.user.companyId, status: { not: "Dismissed" }, ...ownerScope(req) },
    orderBy: { scheduledAt: "asc" },
  });

  const activeEnrollments = await prisma.campaignEnrollment.findMany({
    where: {
      campaign: { companyId: req.user.companyId },
      ...(homeowner ? { lead: { ownerId: req.user.id } } : {}),
      status: "ACTIVE",
      nextRunAt: { not: null },
    },
    include: {
      campaign: {
        include: {
          steps: {
            orderBy: { position: "asc" },
          },
        },
      },
    },
  });

  const groupedCampaigns = {};

  for (const enrollment of activeEnrollments) {
    if (!enrollment.createdAt) continue;
    let currentSimTime = new Date(enrollment.createdAt);

    for (const step of enrollment.campaign.steps) {
      if (step.type === "DELAY") {
        if (step.delayUnit === "DAYS") {
          currentSimTime.setDate(
            currentSimTime.getDate() + (step.delayValue || 0),
          );
        } else if (step.delayUnit === "HOURS") {
          currentSimTime.setHours(
            currentSimTime.getHours() + (step.delayValue || 0),
          );
        } else if (step.delayUnit === "MINUTES") {
          currentSimTime.setMinutes(
            currentSimTime.getMinutes() + (step.delayValue || 0),
          );
        }
      } else {
        const dateString = currentSimTime.toISOString().split("T")[0];
        // currentStepPosition is the next step to run, so anything before it is done.
        const isCompleted = step.position < enrollment.currentStepPosition;
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
            isCompleted: isCompleted,
          };
        } else {
          groupedCampaigns[key].count += 1;
          groupedCampaigns[key].title =
            `${enrollment.campaign.name} - Step ${step.position} (${groupedCampaigns[key].count} Sends)`;
        }
      }
    }
  }

  const campaignEvents = Object.values(groupedCampaigns);

  const announcements = homeowner
    ? []
    : await prisma.announcement.findMany({
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

  const allEvents = [
    ...manualEvents,
    ...campaignEvents,
    ...announcementEvents,
  ];

  allEvents.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));

  return res.json(allEvents);
};

export const createCalendarEvent = async (req, res) => {
  const {
    title,
    channel,
    scheduledAt,
    content,
    subject,
    reason,
    outline,
    isAiSuggested,
    status,
  } = req.body;

  if (!title || !channel || !scheduledAt || !content) {
    return res
      .status(400)
      .json({
        message:
          "Missing required fields: title, channel, scheduledAt, content",
      });
  }

  const scheduledDate = new Date(scheduledAt);
  if (isNaN(scheduledDate.getTime())) {
    return res.status(400).json({ message: "Invalid scheduledAt date" });
  }

  const initialStatus = status || (isAiSuggested ? "Suggested" : "Draft");
  if (!VALID_STATUSES.includes(initialStatus)) {
    return res
      .status(400)
      .json({
        message: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
      });
  }

  if (initialStatus === "Scheduled" && channel !== "Blog") {
    return res.status(422).json({ message: CANNOT_SEND });
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
        // NFR-SC-002: carried so the scheduler can fair-share per tenant.
        companyId: event.companyId,
        scheduledAt: event.scheduledAt.toISOString(),
      },
    });
  }

  return res.status(201).json(event);
};

// ─── AI4Home library ideas (Super Admin → Content) ───────────────────────────
// Builders no longer generate their own suggestions; they add or dismiss ideas the
// AI4Home team published. Each idea is offered once per builder.

const withCompanyName = (text, name) => String(text || "").replace(/\{\{\s*companyName\s*\}\}/g, name);

export const getLibraryIdeas = async (req, res) => {
  const companyId = req.user.companyId;
  const [ideas, taken, company] = await Promise.all([
    prisma.platformContent.findMany({ where: { kind: "IDEA", status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, take: 50 }),
    prisma.contentCalendar.findMany({ where: { companyId, platformContentId: { not: null } }, select: { platformContentId: true } }),
    prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }),
  ]);
  const seen = new Set(taken.map((t) => t.platformContentId));
  const name = company?.name || "our team";
  res.json(
    ideas
      .filter((i) => !seen.has(i.id))
      .map((i) => ({
        id: i.id,
        title: withCompanyName(i.title, name),
        channel: i.channel,
        scheduledAt: i.suggestedFor,
        reason: withCompanyName(i.reason, name),
        content: withCompanyName(i.content, name),
      })),
  );
};

/** Adds an idea to the calendar as a draft, word for word with the builder's name filled in. */
export const useLibraryIdea = async (req, res) => {
  const companyId = req.user.companyId;
  const idea = await prisma.platformContent.findFirst({ where: { id: req.params.id, kind: "IDEA", status: "PUBLISHED" } });
  if (!idea) return res.status(404).json({ message: "That idea is no longer available." });
  const existing = await prisma.contentCalendar.findFirst({ where: { companyId, platformContentId: idea.id } });
  if (existing) return res.status(409).json({ message: "You already added or dismissed this idea." });
  const name = (await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }))?.name || "our team";
  // A suggested date already behind us lands tomorrow, so the item is still ahead on the calendar.
  const when = idea.suggestedFor && idea.suggestedFor.getTime() > Date.now() ? idea.suggestedFor : new Date(Date.now() + 24 * 60 * 60 * 1000);
  const item = await prisma.contentCalendar.create({
    data: {
      companyId,
      title: withCompanyName(idea.title, name),
      channel: idea.channel || "Email",
      scheduledAt: when,
      status: req.path.endsWith("/dismiss") ? "Dismissed" : "Draft",
      content: withCompanyName(idea.content, name),
      reason: withCompanyName(idea.reason, name),
      isAiSuggested: true,
      platformContentId: idea.id,
      ownerId: req.user.id,
    },
  });
  return res.status(201).json(item);
};

export const updateCalendarEvent = async (req, res) => {
  const { id } = req.params;
  const item = await prisma.contentCalendar.findFirst({
    where: { id, companyId: req.user.companyId, ...ownerScope(req) },
  });
  if (!item) {
    return res.status(404).json({ message: "Calendar item not found" });
  }
  if (NON_EDITABLE_STATUSES.has(item.status)) {
    return res
      .status(409)
      .json({ message: `Cannot edit an item in "${item.status}" state` });
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
      return res
        .status(422)
        .json({ message: "Scheduled time must be in the future" });
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
};

export const transitionCalendarEvent = async (req, res) => {
  const { id } = req.params;
  const { status: target } = req.body;

  if (!target || !VALID_STATUSES.includes(target)) {
    return res
      .status(400)
      .json({
        message: `Invalid target status. Must be one of: ${VALID_STATUSES.join(", ")}`,
      });
  }

  const item = await prisma.contentCalendar.findFirst({
    where: { id, companyId: req.user.companyId, ...ownerScope(req) },
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

  if (
    APPROVAL_REQUIRED_TARGETS.has(target) &&
    req.user.role?.toUpperCase() !== "ADMIN"
  ) {
    return res
      .status(403)
      .json({ message: "Only an ADMIN can approve calendar items" });
  }
  if (target === "Scheduled" && item.channel !== "Blog") {
    return res.status(422).json({ message: CANNOT_SEND });
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
        companyId: updated.companyId,
        scheduledAt: updated.scheduledAt.toISOString(),
      },
    });
  }

  return res.json(updated);
};
