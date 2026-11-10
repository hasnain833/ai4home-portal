// The Calendly account AI4Home's own meetings are booked on (B2B leads, website chat).
// Connected from Super Admin → Appointments. New connections use a platform-owned
// encrypted setting; existing pointers to user-owned connections remain readable.
import prisma from "./prisma.js";
import {
  calendlyAvailableTimes,
  calendlyBookingFor,
  calendlyConfigured,
  createCalendlyVisit,
  CalendlyBookingError,
} from "../services/calendly.service.js";

const KEY = "platform.calendly";
const SLOT_CACHE_MS = 60_000;

export async function platformCalendlyPointer() {
  return (await prisma.platformSetting.findUnique({ where: { key: KEY } }))?.value || null;
}

export async function setPlatformCalendlyPointer(value) {
  if (!value) {
    await prisma.platformSetting.deleteMany({ where: { key: KEY } });
  } else {
    await prisma.platformSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  }
  slotCache = null;
}

/** The connection, only when an event type is chosen; otherwise the manual availability applies. */
export async function platformCalendly() {
  if (!calendlyConfigured()) return null;
  const pointer = await platformCalendlyPointer();
  return pointer?.userId ? calendlyBookingFor(pointer.userId) : null;
}

// ponytail: one cached slot list per instance; a booking clears it, a stale read is caught by Calendly itself.
let slotCache = null;
export const clearPlatformSlotCache = () => { slotCache = null; };

export async function calendlySlots(conn, from, days) {
  if (slotCache && slotCache.at > Date.now() - SLOT_CACHE_MS && slotCache.from <= from.getTime()) {
    return slotCache.slots.filter((s) => s >= from);
  }
  const slots = (await calendlyAvailableTimes(conn, from, new Date(from.getTime() + days * 86_400_000)))
    .sort((a, b) => a - b);
  slotCache = { at: Date.now(), from: from.getTime(), slots };
  return slots;
}

/** Books the time in Calendly. Returns the event URI, or null if the time is gone. */
export async function reserveInCalendly(conn, { start, name, email, phone, timezone }) {
  try {
    const uri = await createCalendlyVisit(conn, {
      startTime: start,
      name,
      email,
      phone,
      timezone,
      address: "Online meeting",
      ticketRef: "platform meeting",
    });
    slotCache = null;
    return uri;
  } catch (err) {
    slotCache = null;
    // 403 = the account can't take API bookings (plan); that's a setup problem, not a taken slot.
    if (err instanceof CalendlyBookingError && err.status !== 403) return null;
    throw err;
  }
}
