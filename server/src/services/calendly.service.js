import crypto from "node:crypto";
import prisma from "../lib/prisma.js";
import { encrypt, decrypt } from "../lib/crypto.js";

const AUTH_URL = "https://auth.calendly.com/oauth";
const API_URL = "https://api.calendly.com";
const SCOPES = "users:read availability:read event_types:read scheduled_events:write webhooks:write";
const MAX_RANGE_MS = 7 * 24 * 60 * 60 * 1000; // user_busy_times caps a request at 7 days
const REQUEST_TIMEOUT_MS = 2500; // the booking check runs inside a DB transaction
const CACHE_MS = 2 * 60 * 1000;

export const calendlyConfigured = () =>
  !!(process.env.CALENDLY_CLIENT_ID && process.env.CALENDLY_CLIENT_SECRET);

const redirectUri = () => `${process.env.NEXT_PUBLIC_URL || ""}/api/trade/calendly/callback`;

// OAuth `state`: the user id, signed so a callback can't be replayed onto
// someone else's account.
const sign = (value) =>
  crypto.createHmac("sha256", process.env.CALENDLY_CLIENT_SECRET || "").update(value).digest("base64url");

export function authorizeUrl(userId) {
  const payload = `${userId}.${Date.now()}`;
  const params = new URLSearchParams({
    client_id: process.env.CALENDLY_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: SCOPES,
    state: `${payload}.${sign(payload)}`,
  });
  return `${AUTH_URL}/authorize?${params}`;
}

/** The user id the state was issued for, or null if tampered with or over 15 minutes old. */
export function verifyState(state) {
  const [userId, issuedAt, mac] = String(state || "").split(".");
  if (!userId || !issuedAt || !mac) return null;
  const expected = sign(`${userId}.${issuedAt}`);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  if (Date.now() - Number(issuedAt) > 15 * 60 * 1000) return null;
  return userId;
}

async function tokenRequest(body) {
  const res = await fetch(`${AUTH_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.CALENDLY_CLIENT_ID,
      client_secret: process.env.CALENDLY_CLIENT_SECRET,
      ...body,
    }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `Calendly token error ${res.status}`);
  return data;
}

const tokenFields = (t) => ({
  accessToken: encrypt(t.access_token),
  refreshToken: encrypt(t.refresh_token),
  expiresAt: new Date(Date.now() + (t.expires_in || 7200) * 1000),
});

/** OAuth callback: trade the code for tokens and save the link. */
export async function connectCalendly(userId, code) {
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
  });
  const me = await fetch(`${API_URL}/users/me`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(10000),
  }).then((r) => r.json());
  const calendlyUser = me?.resource?.uri;
  if (!calendlyUser) throw new Error("Calendly did not return the account");

  const data = { calendlyUser, email: me.resource.email || null, ...tokenFields(tokens) };
  const conn = await prisma.calendlyConnection.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  busyCache.delete(userId);

  // Without the webhook the link still works one way; it needs a paid plan.
  try {
    const webhookUri = await ensureWebhook(conn, me.resource.current_organization);
    await prisma.calendlyConnection.update({ where: { id: conn.id }, data: { webhookUri } });
  } catch (err) {
    console.error(`[Calendly] webhook not set up for user ${userId}:`, err.status, err.message);
  }

  // Without an event type, homeowners book from the builder's hours. With only
  // one to choose from, choose it; otherwise the trade picks in Settings.
  if (!conn.eventTypeUri) {
    try {
      const types = await listEventTypes(userId);
      if (types.length === 1) await setEventType(userId, types[0].uri);
    } catch (err) {
      console.error(`[Calendly] could not pick an event type for user ${userId}:`, err.message);
    }
  }
}

const webhookUrl = () => `${process.env.NEXT_PUBLIC_URL || ""}/api/webhooks/calendly`;

/** Our subscription on the trade's Calendly, reusing one left from an earlier connect. */
async function ensureWebhook(conn, organization) {
  const params = new URLSearchParams({ organization, user: conn.calendlyUser, scope: "user", count: "100" });
  const existing = await calendlyApi(conn, `/webhook_subscriptions?${params}`);
  const ours = (existing.collection || []).find((w) => w.callback_url === webhookUrl());
  if (ours) return ours.uri;
  const created = await calendlyApi(conn, "/webhook_subscriptions", {
    method: "POST",
    body: {
      url: webhookUrl(),
      events: ["invitee.created", "invitee.canceled"],
      organization,
      user: conn.calendlyUser,
      scope: "user",
      signing_key: process.env.CALENDLY_WEBHOOK_SIGNING_KEY,
    },
  });
  return created.resource?.uri || null;
}

export function verifyCalendlySignature(header, rawBody, now = Date.now()) {
  const key = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  if (!key || !header || !rawBody) return false;
  const parts = Object.fromEntries(String(header).split(",").map((p) => p.trim().split("=")));
  const t = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(t) || Math.abs(now / 1000 - t) > 180) return false;
  const expected = crypto.createHmac("sha256", key).update(`${parts.t}.${rawBody}`).digest("hex");
  return parts.v1.length === expected.length && crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
}

export async function disconnectCalendly(userId) {
  const conn = await prisma.calendlyConnection.findUnique({ where: { userId } });
  if (!conn) return;
  if (conn.webhookUri) {
    await calendlyApi(conn, `/webhook_subscriptions/${uuidOf(conn.webhookUri)}`, { method: "DELETE" }).catch((err) =>
      console.error("[Calendly] could not remove webhook:", err.message),
    );
  }
  // Revoking is best effort; the link is gone on our side either way.
  try {
    await fetch(`${AUTH_URL}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.CALENDLY_CLIENT_ID || "",
        client_secret: process.env.CALENDLY_CLIENT_SECRET || "",
        token: decrypt(conn.accessToken) || "",
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    /* already revoked, unreachable, or key rotated */
  }
  await prisma.calendlyConnection.delete({ where: { userId } });
  busyCache.delete(userId);
}

async function accessTokenFor(conn) {
  if (conn.expiresAt.getTime() - Date.now() > 60_000) return decrypt(conn.accessToken);
  const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: decrypt(conn.refreshToken) });
  await prisma.calendlyConnection.update({ where: { id: conn.id }, data: tokenFields(tokens) });
  return tokens.access_token;
}

// ponytail: per-instance cache; on serverless a cold instance refetches, which
// only costs a few Calendly calls. Move to a shared store if rate limits bite.
const busyCache = new Map();

export async function calendlyBusyFor(userId, from, to) {
  if (!userId || !calendlyConfigured()) return [];
  const cached = busyCache.get(userId);
  if (cached && cached.at > Date.now() - CACHE_MS && cached.from <= from && cached.to >= to) {
    return cached.busy;
  }

  const conn = await prisma.calendlyConnection.findUnique({ where: { userId } });
  if (!conn) return [];

  try {
    const token = await accessTokenFor(conn);
    // start_time may not be in the past.
    const start = new Date(Math.max(from.getTime(), Date.now() + 60_000));
    const windows = [];
    for (let s = start.getTime(); s < to.getTime(); s += MAX_RANGE_MS) {
      windows.push([new Date(s), new Date(Math.min(s + MAX_RANGE_MS, to.getTime()))]);
    }
    const pages = await Promise.all(
      windows.map(async ([s, e]) => {
        const params = new URLSearchParams({ user: conn.calendlyUser, start_time: s.toISOString(), end_time: e.toISOString() });
        const res = await fetch(`${API_URL}/user_busy_times?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`Calendly busy times ${res.status}`);
        return (await res.json()).collection || [];
      }),
    );
    const busy = pages.flat().map((b) => ({
      start: new Date(b.buffered_start_time || b.start_time),
      end: new Date(b.buffered_end_time || b.end_time),
    }));
    busyCache.set(userId, { at: Date.now(), from, to, busy });
    return busy;
  } catch (err) {
    console.error(`[Calendly] busy times unavailable for user ${userId}:`, err.message);
    return [];
  }
}

export async function calendlyStatus(userId) {
  const conn = await prisma.calendlyConnection.findUnique({
    where: { userId },
    select: { email: true, createdAt: true, eventTypeUri: true, eventTypeName: true, eventDuration: true },
  });
  return {
    available: calendlyConfigured(),
    connected: !!conn,
    email: conn?.email || null,
    connectedAt: conn?.createdAt || null,
    eventType: conn?.eventTypeUri
      ? { uri: conn.eventTypeUri, name: conn.eventTypeName, duration: conn.eventDuration }
      : null,
  };
}

/** A Calendly call failed for a reason the homeowner should see (slot gone, plan). */
export class CalendlyBookingError extends Error {}

async function calendlyApi(conn, path, { method = "GET", body, timeout = 10000 } = {}) {
  const token = await accessTokenFor(conn);
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.title || `Calendly ${method} ${path.split("?")[0]} ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const uuidOf = (uri) => String(uri || "").split("/").pop();

/** The connection, only when the trade has picked an event type to book. */
export async function calendlyBookingFor(userId) {
  if (!userId || !calendlyConfigured()) return null;
  const conn = await prisma.calendlyConnection.findUnique({ where: { userId } });
  return conn?.eventTypeUri ? conn : null;
}

/** The trade's active event types, for the picker in their settings. */
export async function listEventTypes(userId) {
  const conn = await prisma.calendlyConnection.findUnique({ where: { userId } });
  if (!conn) return [];
  const params = new URLSearchParams({ user: conn.calendlyUser, active: "true", count: "100" });
  const data = await calendlyApi(conn, `/event_types?${params}`);
  return (data.collection || []).map((t) => ({
    uri: t.uri,
    name: t.name,
    duration: t.duration,
    locationKind: t.locations?.[0]?.kind || null,
    schedulingUrl: t.scheduling_url,
  }));
}

/** Sets (or clears, with null) the event type homeowners book. */
export async function setEventType(userId, uri) {
  if (!uri) {
    await prisma.calendlyConnection.update({
      where: { userId },
      data: { eventTypeUri: null, eventTypeName: null, eventDuration: null, eventLocationKind: null },
    });
    return null;
  }
  const chosen = (await listEventTypes(userId)).find((t) => t.uri === uri);
  if (!chosen) throw new CalendlyBookingError("That event type is not on your Calendly account.");
  await prisma.calendlyConnection.update({
    where: { userId },
    data: {
      eventTypeUri: chosen.uri,
      eventTypeName: chosen.name,
      eventDuration: chosen.duration,
      eventLocationKind: chosen.locationKind,
    },
  });
  return chosen;
}

/** Open start times for the chosen event type between `from` and `to`. */
export async function calendlyAvailableTimes(conn, from, to) {
  const start = new Date(Math.max(from.getTime(), Date.now() + 60_000));
  const windows = [];
  for (let s = start.getTime(); s < to.getTime(); s += MAX_RANGE_MS) {
    windows.push([new Date(s), new Date(Math.min(s + MAX_RANGE_MS, to.getTime()))]);
  }
  const pages = await Promise.all(
    windows.map(([s, e]) => {
      const params = new URLSearchParams({
        event_type: conn.eventTypeUri,
        start_time: s.toISOString(),
        end_time: e.toISOString(),
      });
      return calendlyApi(conn, `/event_type_available_times?${params}`, { timeout: 5000 });
    }),
  );
  return pages
    .flatMap((p) => p.collection || [])
    .filter((t) => t.status === "available")
    .map((t) => new Date(t.start_time));
}

/** The location the event type expects from the person booking. */
function inviteeLocation(conn, { address, phone }) {
  const kind = conn.eventLocationKind;
  if (!kind) return undefined;
  if (kind === "ask_invitee") return { kind, location: address || "Address on the warranty claim" };
  if (kind === "outbound_call") return { kind, location: phone || "" };
  return { kind };
}

export async function createCalendlyVisit(conn, { startTime, name, email, timezone, address, phone, ticketRef }) {
  const location = inviteeLocation(conn, { address, phone });
  try {
    const data = await calendlyApi(conn, "/invitees", {
      method: "POST",
      timeout: 15000,
      body: {
        event_type: conn.eventTypeUri,
        start_time: new Date(startTime).toISOString(),
        invitee: { name: name || "Homeowner", email, timezone: timezone || "UTC" },
        ...(location ? { location } : {}),
      },
    });
    const eventUri = data.resource?.event || data.event;
    if (!eventUri) throw new Error("Calendly did not return the event");
    return eventUri;
  } catch (err) {
    console.error(`[Calendly] booking ${ticketRef || ""} failed:`, err.status, err.message);
    if (err.status === 403) {
      throw new CalendlyBookingError(
        "This trade's calendar can't take online bookings right now. Please contact us to arrange the visit.",
      );
    }
    if (err.status >= 400 && err.status < 500) {
      throw new CalendlyBookingError("That time has just been taken. Please pick another.");
    }
    throw err;
  }
}

/** Best effort: the visit is cancelled on our side regardless. */
export async function cancelCalendlyVisit(userId, eventUri, reason = "Cancelled from the warranty portal") {
  if (!userId || !eventUri || !calendlyConfigured()) return;
  try {
    const conn = await prisma.calendlyConnection.findUnique({ where: { userId } });
    if (!conn) return;
    await calendlyApi(conn, `/scheduled_events/${uuidOf(eventUri)}/cancellation`, {
      method: "POST",
      body: { reason },
    });
  } catch (err) {
    console.error(`[Calendly] could not cancel ${eventUri}:`, err.message);
  }
}
