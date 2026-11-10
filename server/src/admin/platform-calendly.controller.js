// Super Admin → Appointments: connect the Calendly account AI4Home's own meetings are booked on.
import { findCalendlyConnection, PLATFORM_CALENDLY_OWNER } from "../lib/calendly-connection.js";
import { denyUnlessAdminAccess } from "../middlewares/auth.js";
import { writeAuditLog } from "../lib/audit.js";
import {
  authorizeUrl,
  calendlyConfigured,
  calendlyStatus,
  defaultSchedule,
  disconnectCalendly,
  listEventTypes,
  setEventType,
  CalendlyBookingError,
} from "../services/calendly.service.js";
import { platformCalendlyPointer, setPlatformCalendlyPointer } from "../lib/platform-calendly.js";

const wrap = (label, fn) => async (req, res) => {
  try {
    if (denyUnlessAdminAccess(req, res)) return;
    await fn(req, res);
  } catch (error) {
    if (error instanceof CalendlyBookingError) return res.status(400).json({ message: error.message });
    console.error(`[Platform Calendly] ${label} failed:`, error.status, error.message);
    const reconnect = error.status === 401 || error.status === 403;
    res.status(500).json({ message: reconnect ? "Calendly refused the request. Disconnect and connect again." : `${label} failed.` });
  }
};

/** Saves the platform's connection owner and the timezone of its hours. */
export async function adoptPlatformCalendly(userId) {
  const conn = await findCalendlyConnection(userId);
  if (!conn) return;
  const schedule = await defaultSchedule(conn).catch(() => null);
  await setPlatformCalendlyPointer({ userId, timezone: schedule?.timezone || null });
}

export const getPlatformCalendly = wrap("Loading Calendly", async (_req, res) => {
  const pointer = await platformCalendlyPointer();
  const conn = pointer?.userId ? await findCalendlyConnection(pointer.userId) : null;
  if (!conn) return res.json({ available: calendlyConfigured(), connected: false });

  const [status, eventTypes, schedule] = await Promise.all([
    calendlyStatus(pointer.userId),
    listEventTypes(pointer.userId).catch(() => []),
    defaultSchedule(conn).catch(() => null),
  ]);
  // Hours are edited in Calendly; keep our labels in its timezone.
  if (schedule?.timezone && schedule.timezone !== pointer.timezone) {
    await setPlatformCalendlyPointer({ ...pointer, timezone: schedule.timezone });
  }
  res.json({ ...status, eventTypes, schedule, webhook: !!conn.webhookUri });
});

export const connectPlatformCalendly = wrap("Connecting Calendly", async (_req, res) => {
  if (!calendlyConfigured()) return res.status(503).json({ message: "Calendly isn't set up on this portal yet (CALENDLY_CLIENT_ID)." });
  res.json({ url: authorizeUrl(PLATFORM_CALENDLY_OWNER) });
});

export const setPlatformEventType = wrap("Choosing the event type", async (req, res) => {
  const pointer = await platformCalendlyPointer();
  if (!pointer?.userId) return res.status(400).json({ message: "Connect Calendly first." });
  const chosen = await setEventType(pointer.userId, req.body?.uri || null);
  await setPlatformCalendlyPointer(pointer); // clears cached times for the old event type
  await writeAuditLog({ req, action: "platform_calendly.event_type_set", targetType: "PlatformSetting", targetId: "platform.calendly", metadata: { eventType: chosen?.name || null } });
  res.json({ eventType: chosen });
});

export const disconnectPlatformCalendly = wrap("Disconnecting Calendly", async (req, res) => {
  const pointer = await platformCalendlyPointer();
  if (pointer?.userId) await disconnectCalendly(pointer.userId);
  await setPlatformCalendlyPointer(null);
  await writeAuditLog({ req, action: "platform_calendly.disconnected", targetType: "PlatformSetting", targetId: "platform.calendly" });
  res.json({ ok: true });
});
