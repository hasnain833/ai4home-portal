import { google } from "googleapis";
import prisma from "../lib/prisma.js";
import { encrypt, decryptSafe } from "../lib/crypto.js";

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

export async function exchangeCodeAndStore(companyId, code) {
  const client = newOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  let accountEmail = null;
  try {
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const me = await oauth2.userinfo.get();
    accountEmail = me.data.email || null;
  } catch {
    // userinfo is best-effort; the connection still works without it.
  }

  const data = {
    // OAuth tokens are encrypted at rest (AES-256-GCM). decryptSafe() on read
    // keeps any legacy plaintext rows working and they migrate on next write.
    accessToken: encrypt(tokens.access_token || ""),
    // keep prior refresh token if Google omits it (undefined = Prisma no-op)
    refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined,
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

export async function getAuthedClient(companyId) {
  const conn = await prisma.calendarConnection.findUnique({
    where: { companyId_provider: { companyId, provider: "GOOGLE" } },
  });
  if (!conn || !conn.isActive) return null;

  // Decrypt at-rest tokens (decryptSafe passes through legacy plaintext).
  const accessToken = decryptSafe(conn.accessToken);
  const refreshToken = conn.refreshToken ? decryptSafe(conn.refreshToken) : undefined;

  const client = newOAuthClient();
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken || undefined,
    expiry_date: conn.tokenExpiresAt ? conn.tokenExpiresAt.getTime() : undefined,
  });

  // Persist tokens whenever googleapis refreshes them (re-encrypted on write).
  client.on("tokens", async (tokens) => {
    try {
      await prisma.calendarConnection.update({
        where: { companyId_provider: { companyId, provider: "GOOGLE" } },
        data: {
          accessToken: encrypt(tokens.access_token || accessToken),
          ...(tokens.refresh_token ? { refreshToken: encrypt(tokens.refresh_token) } : {}),
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
