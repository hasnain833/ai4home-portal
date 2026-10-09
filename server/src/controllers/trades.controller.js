import prisma from "../lib/prisma.js";
import { toE164 } from "../services/sms.service.js";
import { createHomeownerAccount, sendAccountInvite } from "../lib/homeowner-account.js";
import { listTicketPhotos } from "../services/warranty-photos.service.js";
import { companyAdmins, writeNotifications } from "../services/notification-service.js";
import { ticketRef } from "../lib/ticket-number.js";
import {
  authorizeUrl,
  calendlyConfigured,
  calendlyStatus,
  connectCalendly,
  disconnectCalendly,
  verifyState,
  listEventTypes,
  setEventType,
  CalendlyBookingError,
} from "../services/calendly.service.js";

const TRADE_SELECT = {
  id: true,
  tradeType: true,
  businessName: true,
  isActive: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true, phone: true } },
};

const isAdmin = (req) => req.user?.role === "ADMIN";

/** Staff need the list too, to dispatch. */
export const listTrades = async (req, res) => {
  try {
    const trades = await prisma.companyTrade.findMany({
      where: { companyId: req.user.companyId },
      select: TRADE_SELECT,
      orderBy: [{ isActive: "desc" }, { tradeType: "asc" }, { createdAt: "asc" }],
    });
    return res.json(trades);
  } catch (error) {
    console.error("[Trades] list failed:", error);
    return res.status(500).json({ message: "Failed to load trades" });
  }
};

export const createTrade = async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ message: "Only admins can add trades" });
    const companyId = req.user.companyId;

    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const tradeType = String(req.body.tradeType || "").trim();
    const businessName = String(req.body.businessName || "").trim() || null;
    if (!name || !email || !tradeType) {
      return res.status(400).json({ message: "Name, email and trade type are required" });
    }
    const phone = toE164(req.body.phone);
    if (phone === undefined) {
      return res.status(400).json({ message: "Enter a valid phone number, e.g. (555) 123-4567 or +15551234567" });
    }

    // Same email already a trade for another builder: reuse that login.
    let user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true, name: true } });
    const existingAccount = !!user;
    if (user && user.role !== "TRADE") {
      return res.status(400).json({ message: "This email belongs to a staff, admin or homeowner account" });
    }
    if (user) {
      const linked = await prisma.companyTrade.findUnique({
        where: { companyId_userId: { companyId, userId: user.id } },
        select: { id: true },
      });
      if (linked) return res.status(400).json({ message: "This trade is already on your list" });
    } else {
      try {
        user = await createHomeownerAccount({ name, email, phone, companyId: null, role: "TRADE" });
      } catch (err) {
        if (err.status === 400) return res.status(400).json({ message: err.message });
        throw err;
      }
    }

    const trade = await prisma.companyTrade.create({
      data: { companyId, userId: user.id, tradeType, businessName },
      select: TRADE_SELECT,
    });

    const invited = await sendAccountInvite({
      email,
      name: user.name || name,
      companyId,
      roleLabel: `a ${tradeType} trade`,
      existingAccount,
    }).catch((err) => {
      console.error("[Trades] invite failed:", err.message);
      return false;
    });

    return res.status(201).json({
      ...trade,
      ...(invited ? {} : { notice: "Trade added, but the invite email did not send. Use Resend invite." }),
    });
  } catch (error) {
    console.error("[Trades] create failed:", error);
    return res.status(500).json({ message: "Failed to add trade" });
  }
};

async function openJobCount(companyId, userId) {
  return prisma.ticket.count({
    where: { companyId, assignedStaffId: userId, status: "DISPATCHED" },
  });
}

async function findOwnTrade(req) {
  return prisma.companyTrade.findFirst({
    where: { id: req.params.id, companyId: req.user.companyId },
    select: { id: true, userId: true, tradeType: true, user: { select: { email: true, name: true } } },
  });
}

export const updateTrade = async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ message: "Only admins can edit trades" });
    const existing = await findOwnTrade(req);
    if (!existing) return res.status(404).json({ message: "Trade not found" });

    const data = {};
    if (req.body.tradeType !== undefined) {
      const tradeType = String(req.body.tradeType || "").trim();
      if (!tradeType) return res.status(400).json({ message: "Trade type is required" });
      data.tradeType = tradeType;
    }
    if (req.body.businessName !== undefined) {
      data.businessName = String(req.body.businessName || "").trim() || null;
    }
    if (req.body.isActive !== undefined) {
      data.isActive = !!req.body.isActive;
      if (!data.isActive) {
        const open = await openJobCount(req.user.companyId, existing.userId);
        if (open) {
          return res.status(400).json({ message: `Reassign this trade's ${open} open job(s) first` });
        }
      }
    }

    const trade = await prisma.companyTrade.update({ where: { id: existing.id }, data, select: TRADE_SELECT });
    return res.json(trade);
  } catch (error) {
    console.error("[Trades] update failed:", error);
    return res.status(500).json({ message: "Failed to update trade" });
  }
};

/** Takes the trade off this company's list. Their login and other builders stay. */
export const removeTrade = async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ message: "Only admins can remove trades" });
    const existing = await findOwnTrade(req);
    if (!existing) return res.status(404).json({ message: "Trade not found" });

    const open = await openJobCount(req.user.companyId, existing.userId);
    if (open) {
      return res.status(400).json({ message: `Reassign this trade's ${open} open job(s) first` });
    }
    await prisma.companyTrade.delete({ where: { id: existing.id } });
    return res.json({ message: "Trade removed" });
  } catch (error) {
    console.error("[Trades] remove failed:", error);
    return res.status(500).json({ message: "Failed to remove trade" });
  }
};

export const resendTradeInvite = async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ message: "Only admins can invite trades" });
    const existing = await findOwnTrade(req);
    if (!existing) return res.status(404).json({ message: "Trade not found" });

    const sent = await sendAccountInvite({
      email: existing.user.email,
      name: existing.user.name,
      companyId: req.user.companyId,
      roleLabel: `a ${existing.tradeType} trade`,
    });
    if (!sent) return res.status(502).json({ message: "The invite email could not be sent" });
    return res.json({ message: "Invite sent" });
  } catch (error) {
    console.error("[Trades] resend invite failed:", error);
    return res.status(500).json({ message: "Failed to send invite" });
  }
};
const requireTrade = (req, res) => {
  if (req.user?.role !== "TRADE") {
    res.status(403).json({ message: "Forbidden" });
    return false;
  }
  return true;
};

const myJobsWhere = (userId) => ({
  assignedStaffId: userId,
  status: { in: ["DISPATCHED", "RESOLVED"] },
  company: { trades: { some: { userId, isActive: true } } },
});

const JOB_INCLUDE = {
  company: { select: { name: true, phone: true } },
  property: { select: { address: true } },
  homeowner: { select: { name: true, phone: true, email: true } },
  appointments: {
    where: { status: "SCHEDULED" },
    orderBy: { scheduledAt: "asc" },
    take: 1,
    select: { scheduledAt: true, durationMinutes: true },
  },
};

const jobView = (t) => ({
  id: t.id,
  ref: ticketRef(t),
  issueType: t.issueType,
  ticketType: t.ticketType,
  description: t.description,
  priority: t.priority,
  isEmergency: t.isEmergency,
  status: t.status,
  dispatchNotes: t.dispatchNotes,
  workDoneAt: t.workDoneAt,
  workDoneNotes: t.workDoneNotes,
  createdAt: t.createdAt,
  companyName: t.company?.name || null,
  companyPhone: t.company?.phone || null,
  address: t.property?.address || null,
  homeowner: t.homeowner,
  nextVisit: t.appointments?.[0] || null,
});

export const myJobs = async (req, res) => {
  try {
    if (!requireTrade(req, res)) return;
    const jobs = await prisma.ticket.findMany({
      where: myJobsWhere(req.user.id),
      include: JOB_INCLUDE,
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    return res.json(jobs.map(jobView));
  } catch (error) {
    console.error("[Trade] jobs failed:", error);
    return res.status(500).json({ message: "Failed to load jobs" });
  }
};

export const myJob = async (req, res) => {
  try {
    if (!requireTrade(req, res)) return;
    const job = await prisma.ticket.findFirst({
      where: { id: req.params.id, ...myJobsWhere(req.user.id) },
      include: JOB_INCLUDE,
    });
    if (!job) return res.status(404).json({ message: "Job not found" });
    const photos = await listTicketPhotos(job.id).catch(() => []);
    return res.json({ ...jobView(job), photos });
  } catch (error) {
    console.error("[Trade] job failed:", error);
    return res.status(500).json({ message: "Failed to load job" });
  }
};

/** The trade says the work is finished. Staff check it and resolve the ticket. */
export const markWorkDone = async (req, res) => {
  try {
    if (!requireTrade(req, res)) return;
    const notes = String(req.body?.notes || "").trim().slice(0, 2000) || null;

    const updated = await prisma.ticket.updateMany({
      where: { id: req.params.id, ...myJobsWhere(req.user.id), status: "DISPATCHED", workDoneAt: null },
      data: { workDoneAt: new Date(), workDoneById: req.user.id, workDoneNotes: notes },
    });
    if (updated.count !== 1) {
      return res.status(400).json({ message: "This job is not open, or is already marked done" });
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
      select: { id: true, number: true, companyId: true, issueType: true },
    });
    const admins = await companyAdmins(ticket.companyId);
    await writeNotifications(
      admins.map((a) => ({
        companyId: ticket.companyId,
        userId: a.id,
        type: "TICKET_STATUS_CHANGED",
        title: `${req.user.name || "Trade"} marked ${ticketRef(ticket)} work done`,
        body: notes || `${ticket.issueType}: ready for you to check and resolve.`,
        link: `/warranty/tickets/${ticket.id}`,
        ticketId: ticket.id,
      })),
    ).catch((err) => console.error("[Trade] work-done notification failed:", err.message));

    return res.json({ message: "Marked as done" });
  } catch (error) {
    console.error("[Trade] work done failed:", error);
    return res.status(500).json({ message: "Failed to mark job done" });
  }
};

export const getCalendly = async (req, res) => {
  try {
    return res.json(await calendlyStatus(req.user.id));
  } catch (error) {
    console.error("[Calendly] status failed:", error);
    return res.status(500).json({ message: "Failed to load Calendly status" });
  }
};

export const startCalendlyConnect = (req, res) => {
  if (!calendlyConfigured()) {
    return res.status(503).json({ message: "Calendly isn't set up on this portal yet" });
  }
  return res.json({ url: authorizeUrl(req.user.id) });
};

export const calendlyCallback = async (req, res) => {
  const back = (result) => res.redirect(`${process.env.NEXT_PUBLIC_URL || ""}/trade/settings?calendly=${result}`);
  const userId = verifyState(req.query.state);
  if (!userId || !req.query.code) return back(req.query.error ? "cancelled" : "failed");
  try {
    await connectCalendly(userId, String(req.query.code));
    return back("connected");
  } catch (error) {
    console.error("[Calendly] connect failed:", error.message);
    return back("failed");
  }
};

export const removeCalendly = async (req, res) => {
  try {
    await disconnectCalendly(req.user.id);
    return res.json({ message: "Calendly disconnected" });
  } catch (error) {
    console.error("[Calendly] disconnect failed:", error);
    return res.status(500).json({ message: "Failed to disconnect Calendly" });
  }
};

/** The trade's Calendly event types, to choose which one homeowners book. */
export const getCalendlyEventTypes = async (req, res) => {
  try {
    return res.json(await listEventTypes(req.user.id));
  } catch (error) {
    console.error("[Calendly] event types failed:", error.message);
    // Connected before event types were requested: a reconnect grants the scope.
    const reconnect = error.status === 401 || error.status === 403;
    return res.status(reconnect ? 409 : 502).json({
      message: reconnect
        ? "Please disconnect and reconnect Calendly to allow booking."
        : "Could not load your Calendly event types.",
    });
  }
};

export const putCalendlyEventType = async (req, res) => {
  try {
    const chosen = await setEventType(req.user.id, req.body?.uri || null);
    return res.json({ eventType: chosen });
  } catch (error) {
    if (error instanceof CalendlyBookingError) return res.status(400).json({ message: error.message });
    console.error("[Calendly] set event type failed:", error.message);
    return res.status(500).json({ message: "Could not save the event type" });
  }
};
