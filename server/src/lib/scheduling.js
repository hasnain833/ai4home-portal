/**
 * scheduling.js
 * Timezone-aware helpers for computing appointment slots from a company's
 * AvailabilitySetting. All persisted appointment times are UTC `Date`s; these
 * helpers translate between a tenant's wall-clock working hours (expressed in an
 * IANA timezone) and those UTC instants.
 */

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Offset (ms) of `tz` from UTC at the given UTC instant. Positive east of UTC.
 */
function getTimezoneOffsetMs(utcMs, tz) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return asUTC - utcMs;
}

/**
 * Convert a wall-clock time in `tz` to the corresponding UTC Date.
 * Uses the standard two-pass correction so DST transitions are handled.
 */
export function zonedTimeToUtc(year, month1, day, hour, minute, tz) {
  const wallAsUtc = Date.UTC(year, month1 - 1, day, hour, minute, 0);
  let offset = getTimezoneOffsetMs(wallAsUtc, tz);
  let result = wallAsUtc - offset;
  offset = getTimezoneOffsetMs(result, tz);
  result = wallAsUtc - offset;
  return new Date(result);
}

/** Wall-clock parts of `date` as observed in `tz`. */
export function getZonedParts(date, tz) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const map = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  return {
    weekday: map.weekday,
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

/**
 * Human-friendly slot label, e.g. "Mon, Jul 7 at 2:00 PM EDT". The " at " separator is
 * relied on by the booking UI to split the day heading from the time.
 */
export function formatSlotLabel(date, tz) {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(date);
  return `${day} at ${time}`;
}

function parseHHMM(str, fallbackH, fallbackM) {
  if (!str || !/^\d{1,2}:\d{2}$/.test(str)) return [fallbackH, fallbackM];
  const [h, m] = str.split(":").map(Number);
  return [h, m];
}

/**
 * Generate candidate slot start-times for a single calendar day (in the tenant tz),
 * stepping by (slotDuration + buffer). Returns UTC Date objects.
 *
 * @param {Date}   dayAnchor UTC instant whose tenant-local date defines the day to generate
 * @param {Object} setting   AvailabilitySetting-like { dayStart, dayEnd, slotDuration, bufferMinutes, workingDays, timezone }
 */
export function generateDaySlots(dayAnchor, setting) {
  const tz = setting.timezone || "America/New_York";
  const { year, month, day, weekday } = getZonedParts(dayAnchor, tz);

  const workingDays = (setting.workingDays || "Mon,Tue,Wed,Thu,Fri")
    .split(",")
    .map((d) => d.trim().slice(0, 3).toLowerCase());
  if (!workingDays.includes(weekday.slice(0, 3).toLowerCase())) return [];

  const [startH, startM] = parseHHMM(setting.dayStart, 9, 0);
  const [endH, endM] = parseHHMM(setting.dayEnd, 17, 0);
  const duration = setting.slotDuration || 30;
  const buffer = setting.bufferMinutes || 0;
  const step = duration + buffer;

  const dayStartUtc = zonedTimeToUtc(year, month, day, startH, startM, tz);
  const dayEndUtc = zonedTimeToUtc(year, month, day, endH, endM, tz);

  const slots = [];
  for (
    let t = dayStartUtc.getTime();
    t + duration * 60000 <= dayEndUtc.getTime();
    t += step * 60000
  ) {
    slots.push(new Date(t));
  }
  return slots;
}

/**
 * Generate available slots across the next `days` calendar days starting from `from`,
 * excluding any start time that collides with a busy interval (existing appointments
 * and/or external calendar busy blocks). Two intervals collide if they overlap once
 * the slot duration is taken into account.
 *
 * @param {Object} opts
 * @param {Object} opts.setting       AvailabilitySetting
 * @param {Date}   opts.from          earliest acceptable start (usually now + leadMinutes)
 * @param {number} opts.days          how many days forward to scan
 * @param {Array<{start:Date,end:Date}>} opts.busy busy intervals to subtract
 * @param {number} opts.limit         max slots to return
 * @returns {Date[]} available UTC start times, ascending
 */
export function computeAvailableSlots({ setting, from, days = 14, busy = [], limit = 100 }) {
  const tz = setting.timezone || "America/New_York";
  const duration = (setting.slotDuration || 30) * 60000;
  const out = [];
  const fromMs = from.getTime();

  const overlaps = (startMs) => {
    const endMs = startMs + duration;
    return busy.some((b) => startMs < b.end.getTime() && endMs > b.start.getTime());
  };

  for (let d = 0; d < days && out.length < limit; d++) {
    const anchor = new Date(from.getTime() + d * 24 * 60 * 60 * 1000);
    const daySlots = generateDaySlots(anchor, setting);
    for (const slot of daySlots) {
      if (slot.getTime() < fromMs) continue;
      if (overlaps(slot.getTime())) continue;
      out.push(slot);
      if (out.length >= limit) break;
    }
  }
  // Dedupe (consecutive day anchors can overlap) and sort.
  const seen = new Set();
  return out
    .filter((s) => {
      const k = s.getTime();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.getTime() - b.getTime())
    .slice(0, limit);
}

export { DAY_NAMES };
