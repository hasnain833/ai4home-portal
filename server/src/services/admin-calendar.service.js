// Super Admin / Super Staff personal calendars (Google or Outlook), over plain REST.
// Two-way: each person's busy times block open slots, and the meetings assigned to them
// are written into their calendar (no attendees, so the calendar sends no invites of its own).
import crypto from "node:crypto";
import prisma from "../lib/prisma.js";
import { encrypt, decrypt } from "../lib/crypto.js";

const TIMEOUT_MS = 4000;
const BUSY_CACHE_MS = 60_000;

const portal = () => (process.env.NEXT_PUBLIC_URL || "").replace(/\/$/, "");
const redirectUri = (provider) => `${portal()}/api/integrations/admin-calendar/callback/${provider.toLowerCase()}`;
const msBase = () => `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT || "common"}/oauth2/v2.0`;
const GRAPH = "https://graph.microsoft.com/v1.0";
const GCAL = "https://www.googleapis.com/calendar/v3/calendars/primary";

const PROVIDERS = {
  GOOGLE: {
    clientId: () => process.env.GOOGLE_CALENDAR_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy",
    extra: { access_type: "offline", prompt: "consent" },
  },
  OUTLOOK: {
    clientId: () => process.env.MICROSOFT_CLIENT_ID,
    clientSecret: () => process.env.MICROSOFT_CLIENT_SECRET,
    authorize: () => `${msBase()}/authorize`,
    token: () => `${msBase()}/token`,
    scope: "offline_access openid email User.Read Calendars.ReadWrite",
    extra: { response_mode: "query", prompt: "select_account" },
  },
};
const url = (v) => (typeof v === "function" ? v() : v);

export const calendarProviders = () =>
  Object.fromEntries(Object.entries(PROVIDERS).map(([k, p]) => [k, !!(p.clientId() && p.clientSecret())]));

// ---------- OAuth ----------

// `state` = provider.user.issuedAt.mac, signed so a callback can't be replayed onto someone else.
const sign = (provider, value) => crypto.createHmac("sha256", PROVIDERS[provider].clientSecret() || "").update(value).digest("base64url");

export function authorizeUrl(provider, userId) {
  const p = PROVIDERS[provider];
  if (!p || !p.clientId() || !p.clientSecret()) throw Object.assign(new Error(`${provider === "GOOGLE" ? "Google" : "Outlook"} calendar isn't set up on this portal yet.`), { status: 503 });
  const payload = `${provider}.${Buffer.from(userId).toString("base64url")}.${Date.now()}`;
  const params = new URLSearchParams({
    client_id: p.clientId(),
    response_type: "code",
    redirect_uri: redirectUri(provider),
    scope: p.scope,
    state: `${payload}.${sign(provider, payload)}`,
    ...p.extra,
  });
  return `${url(p.authorize)}?${params}`;
}

/** { provider, userId } the state was issued for, or null if tampered with or over 15 minutes old. */
export function verifyState(state) {
  const [provider, user, issuedAt, mac] = String(state || "").split(".");
  if (!PROVIDERS[provider] || !user || !issuedAt || !mac) return null;
  if (!PROVIDERS[provider].clientSecret()) return null;
  const expected = sign(provider, `${provider}.${user}.${issuedAt}`);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  if (Date.now() - Number(issuedAt) > 15 * 60_000) return null;
  return { provider, userId: Buffer.from(user, "base64url").toString() };
}

async function tokenRequest(provider, body) {
  const p = PROVIDERS[provider];
  const res = await fetch(url(p.token), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: p.clientId(), client_secret: p.clientSecret(), ...body }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error_description || data.error || `token error ${res.status}`), { reconnect: data.error === "invalid_grant" });
  return data;
}

// The id_token comes straight from the provider's token endpoint over TLS, so its claims are read, not verified.
const idTokenEmail = (idToken) => {
  try { return JSON.parse(Buffer.from(String(idToken).split(".")[1], "base64url").toString()).email || null; } catch { return null; }
};

export async function connectCalendar({ provider, userId, userName, code }) {
  const t = await tokenRequest(provider, { grant_type: "authorization_code", code, redirect_uri: redirectUri(provider) });
  if (!t.refresh_token) throw new Error("The calendar didn't grant offline access. Please connect again.");
  const data = {
    userName,
    provider,
    email: idTokenEmail(t.id_token),
    accessToken: encrypt(t.access_token),
    refreshToken: encrypt(t.refresh_token),
    expiresAt: new Date(Date.now() + (t.expires_in || 3600) * 1000),
    lastError: null,
  };
  // Switching provider: events in the old calendar are removed first, or they'd be orphaned there.
  const previous = await prisma.adminCalendarConnection.findUnique({ where: { userId } });
  if (previous && previous.provider !== provider) await removeEventsOf(previous);
  busyCache.delete(userId);
  return prisma.adminCalendarConnection.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

async function accessTokenFor(conn) {
  if (conn.expiresAt.getTime() - Date.now() > 60_000) return decrypt(conn.accessToken);
  try {
    const t = await tokenRequest(conn.provider, { grant_type: "refresh_token", refresh_token: decrypt(conn.refreshToken) });
    await prisma.adminCalendarConnection.update({
      where: { id: conn.id },
      data: {
        accessToken: encrypt(t.access_token),
        // Microsoft rotates refresh tokens; Google keeps the old one.
        ...(t.refresh_token ? { refreshToken: encrypt(t.refresh_token) } : {}),
        expiresAt: new Date(Date.now() + (t.expires_in || 3600) * 1000),
        lastError: null,
      },
    });
    return t.access_token;
  } catch (err) {
    if (err.reconnect) await prisma.adminCalendarConnection.update({ where: { id: conn.id }, data: { lastError: "Access was revoked. Please reconnect." } });
    throw err;
  }
}

async function api(conn, method, path, body) {
  const token = await accessTokenFor(conn);
  const base = conn.provider === "GOOGLE" ? GCAL : GRAPH;
  const res = await fetch(path.startsWith("https://") ? path : `${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(conn.provider === "OUTLOOK" ? { Prefer: 'outlook.timezone="UTC"' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (method === "DELETE" && [404, 410].includes(res.status)) return null; // already gone
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error?.message || `${conn.provider} calendar ${res.status}`), { status: res.status });
  return data;
}

// ---------- Busy times ----------

// ponytail: per-instance cache; a cold serverless instance refetches. Bookings are still
// checked against our own meetings in a serializable transaction, so a stale read can't double-book.
const busyCache = new Map();

/** Busy intervals, or null when the calendar can't be read (that person is then not offered). */
export async function busyFor(conn, from, to) {
  const hit = busyCache.get(conn.userId);
  if (hit && hit.at > Date.now() - BUSY_CACHE_MS && hit.from <= from.getTime() && hit.to >= to.getTime()) return hit.busy;
  try {
    let busy;
    if (conn.provider === "GOOGLE") {
      const token = await accessTokenFor(conn);
      const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: "primary" }] }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.calendars?.primary?.errors?.length) throw new Error(data.error?.message || `freeBusy ${res.status}`);
      busy = (data.calendars?.primary?.busy || []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
    } else {
      busy = [];
      const params = new URLSearchParams({ startDateTime: from.toISOString(), endDateTime: to.toISOString(), $select: "start,end,showAs,isCancelled", $top: "500" });
      let next = `${GRAPH}/me/calendarView?${params}`;
      for (let page = 0; next && page < 5; page++) {
        const data = await api(conn, "GET", next);
        for (const e of data.value || []) {
          if (e.isCancelled || e.showAs === "free") continue;
          busy.push({ start: new Date(`${e.start.dateTime}Z`), end: new Date(`${e.end.dateTime}Z`) });
        }
        next = data["@odata.nextLink"];
      }
    }
    busyCache.set(conn.userId, { at: Date.now(), from: from.getTime(), to: to.getTime(), busy });
    return busy;
  } catch (err) {
    console.error(`[Admin calendar] busy times unavailable for ${conn.userId}:`, err.message);
    return null;
  }
}

export const listCalendarConnections = () => prisma.adminCalendarConnection.findMany({ orderBy: { createdAt: "asc" } });

// ---------- Events ----------

function eventBody(provider, { title, description, start, end, location }) {
  if (provider === "GOOGLE") {
    return { summary: title, description, location: location || undefined, start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } };
  }
  const at = (d) => ({ dateTime: d.toISOString().replace("Z", ""), timeZone: "UTC" });
  return { subject: title, body: { contentType: "text", content: description }, start: at(start), end: at(end), ...(location ? { location: { displayName: location } } : {}) };
}

const eventPath = (provider, id = "") =>
  provider === "GOOGLE" ? `/events${id ? `/${encodeURIComponent(id)}` : ""}?sendUpdates=none` : `/me/events${id ? `/${encodeURIComponent(id)}` : ""}`;

/** Creates or updates the event; returns its id. */
export async function upsertEvent(conn, eventId, details) {
  const body = eventBody(conn.provider, details);
  if (eventId) {
    try {
      await api(conn, "PATCH", eventPath(conn.provider, eventId), body);
      return eventId;
    } catch (err) {
      if (![404, 410].includes(err.status)) throw err; // deleted in the calendar: write it again
    }
  }
  return (await api(conn, "POST", eventPath(conn.provider), body)).id;
}

export const deleteEvent = (conn, eventId) => api(conn, "DELETE", eventPath(conn.provider, eventId));

async function removeEventsOf(conn) {
  const meetings = await prisma.salesAgentAppointment.findMany({ where: { calendarOwnerId: conn.userId, calendarEventId: { not: null } }, select: { id: true, calendarEventId: true } });
  for (const m of meetings) {
    await deleteEvent(conn, m.calendarEventId).catch((e) => console.error("[Admin calendar] event removal failed:", e.message));
    // Raw: leaves updatedAt alone, so other syncs (Salesforce) don't see a change.
    await prisma.$executeRaw`UPDATE "SalesAgentAppointment" SET "calendarEventId" = NULL, "calendarOwnerId" = NULL WHERE id = ${m.id}`;
  }
}

/** Removes this person's events from their calendar, then the connection. Their meetings stay assigned to them. */
export async function disconnectCalendar(userId) {
  const conn = await prisma.adminCalendarConnection.findUnique({ where: { userId } });
  if (!conn) return;
  await removeEventsOf(conn);
  if (conn.provider === "GOOGLE") {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decrypt(conn.refreshToken) || "")}`, { method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => {});
  }
  await prisma.adminCalendarConnection.delete({ where: { userId } });
  busyCache.delete(userId);
}
