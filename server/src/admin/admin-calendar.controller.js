// Super Admin → Appointments: each Super Admin / Super Staff member connects their own Google or Outlook calendar.
import prisma from "../lib/prisma.js";
import { adminHandler } from "../middlewares/auth.js";
import { writeAuditLog } from "../lib/audit.js";
import {
  authorizeUrl,
  calendarProviders,
  connectCalendar,
  disconnectCalendar,
  listCalendarConnections,
  verifyState,
} from "../services/admin-calendar.service.js";

const wrap = adminHandler("Admin calendar");
const PAGE = "/admin/sales-agent-appointments";
const person = (c) => ({ userId: c.userId, name: c.userName, provider: c.provider, email: c.email, error: c.lastError });

export const getCalendars = wrap("Loading calendars", async (req, res) => {
  const team = await listCalendarConnections();
  const me = team.find((c) => c.userId === req.user.id);
  res.json({ providers: calendarProviders(), me: me ? person(me) : null, team: team.map(person) });
});

export const startCalendarConnect = wrap("Connecting the calendar", async (req, res) => {
  const provider = String(req.body?.provider || "").toUpperCase();
  if (!["GOOGLE", "OUTLOOK"].includes(provider)) return res.status(400).json({ message: "Choose Google or Outlook." });
  try {
    res.json({ url: authorizeUrl(provider, req.user.id) });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    throw error;
  }
});

export const removeCalendar = wrap("Disconnecting the calendar", async (req, res) => {
  await disconnectCalendar(req.user.id);
  await writeAuditLog({ req, action: "admin_calendar.disconnected", targetType: "AdminCalendarConnection", targetId: req.user.id });
  res.json({ ok: true });
});

/** Public OAuth callback: the signed state says who is connecting. */
export async function adminCalendarCallback(req, res) {
  const back = (result) => res.redirect(`${process.env.NEXT_PUBLIC_URL || ""}${PAGE}?calendar=${result}`);
  const state = verifyState(req.query.state);
  if (!state || state.provider !== String(req.params.provider || "").toUpperCase() || !req.query.code) {
    return back(req.query.error ? "cancelled" : "failed");
  }
  try {
    // The env Super Admin login has no User row.
    const user = await prisma.user.findUnique({ where: { id: state.userId }, select: { name: true, email: true, role: true } });
    if (user && !["SUPER_ADMIN", "SUPER_STAFF"].includes(user.role)) return back("failed");
    await connectCalendar({ ...state, userName: user?.name || user?.email || "Super Admin", code: String(req.query.code) });
    return back("connected");
  } catch (error) {
    console.error("[Admin calendar] connect failed:", error.message);
    return back("failed");
  }
}
