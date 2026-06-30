import { google } from "googleapis";
import prisma from "../lib/prisma.js";

/**
 * Google Calendar + Meet integration for two-way busy/free sync and conference link
 * creation. Tokens are stored per-company in CalendarConnection (provider GOOGLE).
 *
 * Required env:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
 *   (redirect URI must exactly match one registered in the Google Cloud console,
 *    e.g. https://app.example.com/api/sales/scheduling/google/callback)
 */

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "openid",
  "email",
];

export function isGoogleConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

function newOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Build the consent URL. `state` carries the companyId (and any return path) so the
 * callback can attribute the tokens. `prompt: "consent"` + `access_type: "offline"`
 * ensures we receive a refresh_token even on re-auth.
 */
export function getAuthUrl(state) {
  const client = newOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
    include_granted_scopes: true,
  });
}

/** Exchange an authorization code for tokens and the connected account email. */
export async function exchangeCodeAndStore(companyId, code) {
  const client = newOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  // Capture which Google account was connected (for display).
  let accountEmail = null;
  try {
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const me = await oauth2.userinfo.get();
    accountEmail = me.data.email || null;
  } catch {
    // userinfo is best-effort; the connection still works without it.
  }

  const data = {
    accessToken: tokens.access_token || "",
    refreshToken: tokens.refresh_token || undefined, // keep prior refresh token if Google omits it
    tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    scope: tokens.scope || SCOPES.join(" "),
    accountEmail,
    isActive: true,
  };

  return prisma.calendarConnection.upsert({
    where: { companyId_provider: { companyId, provider: "GOOGLE" } },
    create: { companyId, provider: "GOOGLE", calendarId: "primary", ...data },
    update: data,
  });
}

/**
 * Return an authenticated OAuth2 client for the company, or null if not connected.
 * Refreshed access tokens are persisted automatically.
 */
export async function getAuthedClient(companyId) {
  const conn = await prisma.calendarConnection.findUnique({
    where: { companyId_provider: { companyId, provider: "GOOGLE" } },
  });
  if (!conn || !conn.isActive) return null;

  const client = newOAuthClient();
  client.setCredentials({
    access_token: conn.accessToken,
    refresh_token: conn.refreshToken || undefined,
    expiry_date: conn.tokenExpiresAt ? conn.tokenExpiresAt.getTime() : undefined,
  });

  // Persist tokens whenever googleapis refreshes them.
  client.on("tokens", async (tokens) => {
    try {
      await prisma.calendarConnection.update({
        where: { companyId_provider: { companyId, provider: "GOOGLE" } },
        data: {
          accessToken: tokens.access_token || conn.accessToken,
          ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
          ...(tokens.expiry_date ? { tokenExpiresAt: new Date(tokens.expiry_date) } : {}),
        },
      });
    } catch (e) {
      console.error("[Google Calendar] Failed to persist refreshed tokens:", e.message);
    }
  });

  return { client, connection: conn };
}

export async function isConnected(companyId) {
  const conn = await prisma.calendarConnection.findUnique({
    where: { companyId_provider: { companyId, provider: "GOOGLE" } },
  });
  return !!(conn && conn.isActive);
}

export async function disconnect(companyId) {
  try {
    await prisma.calendarConnection.update({
      where: { companyId_provider: { companyId, provider: "GOOGLE" } },
      data: { isActive: false },
    });
  } catch {
    // no-op if nothing to disconnect
  }
}

/**
 * Query busy intervals on the connected calendar between two instants.
 * Returns [{ start: Date, end: Date }]. Falls back to [] when not connected.
 */
export async function getBusyIntervals(companyId, timeMin, timeMax) {
  const authed = await getAuthedClient(companyId);
  if (!authed) return [];
  const calendar = google.calendar({ version: "v3", auth: authed.client });
  try {
    const res = await calendar.freebusy.query({
      requestBody: {
        timeMin: new Date(timeMin).toISOString(),
        timeMax: new Date(timeMax).toISOString(),
        items: [{ id: authed.connection.calendarId || "primary" }],
      },
    });
    const cal = res.data.calendars?.[authed.connection.calendarId || "primary"];
    const busy = cal?.busy || [];
    return busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  } catch (e) {
    console.error("[Google Calendar] freebusy query failed:", e.message);
    return [];
  }
}

/**
 * Create a calendar event with a Google Meet conference link.
 * Returns { eventId, meetLink, htmlLink } or null when not connected / on error.
 */
export async function createEventWithMeet(companyId, { summary, description, start, end, attendees = [], timezone }) {
  const authed = await getAuthedClient(companyId);
  if (!authed) return null;
  const calendar = google.calendar({ version: "v3", auth: authed.client });

  try {
    const res = await calendar.events.insert({
      calendarId: authed.connection.calendarId || "primary",
      conferenceDataVersion: 1,
      sendUpdates: "all",
      requestBody: {
        summary,
        description,
        start: { dateTime: new Date(start).toISOString(), timeZone: timezone },
        end: { dateTime: new Date(end).toISOString(), timeZone: timezone },
        attendees: attendees.filter(Boolean).map((email) => ({ email })),
        conferenceData: {
          createRequest: {
            requestId: `meet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      },
    });
    const ev = res.data;
    const meetLink =
      ev.hangoutLink ||
      ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ||
      null;
    return { eventId: ev.id, meetLink, htmlLink: ev.htmlLink };
  } catch (e) {
    console.error("[Google Calendar] event insert failed:", e.message);
    return null;
  }
}

/** Move an existing event to a new time. Returns updated { eventId, meetLink } or null. */
export async function updateEventTime(companyId, eventId, { start, end, timezone }) {
  const authed = await getAuthedClient(companyId);
  if (!authed || !eventId) return null;
  const calendar = google.calendar({ version: "v3", auth: authed.client });
  try {
    const res = await calendar.events.patch({
      calendarId: authed.connection.calendarId || "primary",
      eventId,
      sendUpdates: "all",
      requestBody: {
        start: { dateTime: new Date(start).toISOString(), timeZone: timezone },
        end: { dateTime: new Date(end).toISOString(), timeZone: timezone },
      },
    });
    return { eventId: res.data.id, meetLink: res.data.hangoutLink || null };
  } catch (e) {
    console.error("[Google Calendar] event patch failed:", e.message);
    return null;
  }
}

export async function deleteEvent(companyId, eventId) {
  const authed = await getAuthedClient(companyId);
  if (!authed || !eventId) return;
  const calendar = google.calendar({ version: "v3", auth: authed.client });
  try {
    await calendar.events.delete({
      calendarId: authed.connection.calendarId || "primary",
      eventId,
      sendUpdates: "all",
    });
  } catch (e) {
    console.error("[Google Calendar] event delete failed:", e.message);
  }
}
