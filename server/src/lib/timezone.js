/**
 * timezone.js
 * Utilities for lead-local timezone calculations and send window adjustments.
 */

// Basic US State to IANA Timezone mapping
const STATE_TO_TZ = {
  AL: "America/Chicago",
  AK: "America/Anchorage",
  AZ: "America/Phoenix",
  AR: "America/Chicago",
  CA: "America/Los_Angeles",
  CO: "America/Denver",
  CT: "America/New_York",
  DE: "America/New_York",
  FL: "America/New_York", // FL spans two, defaulting to Eastern
  GA: "America/New_York",
  HI: "Pacific/Honolulu",
  ID: "America/Boise", // ID spans two, defaulting to Mountain
  IL: "America/Chicago",
  IN: "America/Indiana/Indianapolis",
  IA: "America/Chicago",
  KS: "America/Chicago",
  KY: "America/New_York", // KY spans two, defaulting to Eastern
  LA: "America/Chicago",
  ME: "America/New_York",
  MD: "America/New_York",
  MA: "America/New_York",
  MI: "America/Detroit",
  MN: "America/Chicago",
  MS: "America/Chicago",
  MO: "America/Chicago",
  MT: "America/Denver",
  NE: "America/Chicago", // NE spans two, defaulting to Central
  NV: "America/Los_Angeles",
  NH: "America/New_York",
  NJ: "America/New_York",
  NM: "America/Denver",
  NY: "America/New_York",
  NC: "America/New_York",
  ND: "America/Chicago", // ND spans two, defaulting to Central
  OH: "America/New_York",
  OK: "America/Chicago",
  OR: "America/Los_Angeles", // OR spans two, defaulting to Pacific
  PA: "America/New_York",
  RI: "America/New_York",
  SC: "America/New_York",
  SD: "America/Chicago", // SD spans two, defaulting to Central
  TN: "America/Chicago", // TN spans two, defaulting to Central
  TX: "America/Chicago", // TX spans two, defaulting to Central
  UT: "America/Denver",
  VT: "America/New_York",
  VA: "America/New_York",
  WA: "America/Los_Angeles",
  WV: "America/New_York",
  WI: "America/Chicago",
  WY: "America/Denver",
};

/**
 * Get IANA timezone string for a given state abbreviation.
 * Defaults to America/New_York.
 */
export function getLeadTimezone(state) {
  if (!state) return "America/New_York";
  const cleanState = state.trim().toUpperCase();
  return STATE_TO_TZ[cleanState] || "America/New_York";
}

/**
 * Shifts the given baseDate to the next valid send window in the given timezone.
 * @param {Date} baseDate - The originally scheduled run time
 * @param {String} timezone - IANA timezone (e.g. "America/Los_Angeles")
 * @param {String} sendWindowDays - Comma separated days (e.g. "Mon,Tue,Wed,Thu,Fri")
 * @param {String} sendWindowStart - HH:mm format (e.g. "09:00")
 * @param {String} sendWindowEnd - HH:mm format (e.g. "18:00")
 * @returns {Date} - Adjusted date for the next valid window
 */
export function getNextValidSendWindow(baseDate, timezone, sendWindowDays, sendWindowStart, sendWindowEnd) {
  if (!sendWindowDays || !sendWindowStart || !sendWindowEnd) {
    return baseDate;
  }

  const allowedDays = sendWindowDays.split(",").map((d) => d.trim().slice(0, 3).toLowerCase());
  if (allowedDays.length === 0) return baseDate;

  const [startHour, startMin] = sendWindowStart.split(":").map(Number);
  const [endHour, endMin] = sendWindowEnd.split(":").map(Number);

  // We iterate day by day starting from baseDate to find a valid window.
  let currentDate = new Date(baseDate);

  for (let i = 0; i < 14; i++) { // limit search to 14 days
    const localFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    
    // We also need the local year/month/day to construct a specific time in that tz
    const ymdFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });

    const parts = localFormatter.formatToParts(currentDate);
    const ymdParts = ymdFormatter.formatToParts(currentDate);

    const getPart = (p, type) => p.find(x => x.type === type)?.value;
    
    const weekday = getPart(parts, 'weekday').toLowerCase();
    const currentHour = parseInt(getPart(parts, 'hour') || "0", 10);
    const currentMinute = parseInt(getPart(parts, 'minute') || "0", 10);

    const year = parseInt(getPart(ymdParts, 'year'), 10);
    const month = parseInt(getPart(ymdParts, 'month'), 10) - 1; // 0-indexed for Date
    const day = parseInt(getPart(ymdParts, 'day'), 10);

    const isAllowedDay = allowedDays.includes(weekday);

    // Case 1: Today is an allowed day, and we are before the start time -> jump to start time today
    if (isAllowedDay && (currentHour < startHour || (currentHour === startHour && currentMinute < startMin))) {
      const nextTime = createDateInTz(year, month, day, startHour, startMin, 0, timezone);
      if (nextTime > new Date()) return nextTime;
    }

    // Case 2: Today is an allowed day, and we are within the window -> run at baseDate
    if (isAllowedDay && 
        (currentHour > startHour || (currentHour === startHour && currentMinute >= startMin)) &&
        (currentHour < endHour || (currentHour === endHour && currentMinute < endMin))) {
      return currentDate;
    }

    // Case 3: Today is NOT allowed, OR we are past the end time today -> jump to start time of NEXT allowed day
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    currentDate.setUTCHours(0, 0, 0, 0); // start next day at midnight
  }

  return baseDate; // fallback if no valid day found
}

// Helper to create a UTC Date that represents a specific wall-clock time in a target timezone
function createDateInTz(year, month, day, hour, min, sec, tz) {
  // Use formatting to find offset
  const d = new Date(Date.UTC(year, month, day, hour, min, sec));
  
  // Find difference between our constructed UTC date interpreted as target tz vs actual UTC
  const str = d.toLocaleString("en-US", { timeZone: tz });
  const localInTz = new Date(str);
  
  const offsetMs = d.getTime() - localInTz.getTime();
  return new Date(d.getTime() + offsetMs);
}
