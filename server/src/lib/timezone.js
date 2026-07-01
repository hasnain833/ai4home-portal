const STATE_TIMEZONE_MAP = {
  PK: "Asia/Karachi",
  PAKISTAN: "Asia/Karachi",
  CA: "America/Los_Angeles",
  NV: "America/Los_Angeles",
  OR: "America/Los_Angeles",
  WA: "America/Los_Angeles",
  CALIFORNIA: "America/Los_Angeles",
  NEVADA: "America/Los_Angeles",
  OREGON: "America/Los_Angeles",
  WASHINGTON: "America/Los_Angeles",
  CO: "America/Denver",
  ID: "America/Denver",
  MT: "America/Denver",
  UT: "America/Denver",
  WY: "America/Denver",
  NM: "America/Denver",
  COLORADO: "America/Denver",
  IDAHO: "America/Denver",
  MONTANA: "America/Denver",
  UTAH: "America/Denver",
  WYOMING: "America/Denver",
  "NEW MEXICO": "America/Denver",
  AZ: "America/Phoenix",
  ARIZONA: "America/Phoenix",
  AL: "America/Chicago",
  AR: "America/Chicago",
  IL: "America/Chicago",
  IA: "America/Chicago",
  KS: "America/Chicago",
  LA: "America/Chicago",
  MN: "America/Chicago",
  MS: "America/Chicago",
  MO: "America/Chicago",
  NE: "America/Chicago",
  ND: "America/Chicago",
  OK: "America/Chicago",
  SD: "America/Chicago",
  TN: "America/Chicago",
  TX: "America/Chicago",
  WI: "America/Chicago",
  ALABAMA: "America/Chicago",
  ARKANSAS: "America/Chicago",
  ILLINOIS: "America/Chicago",
  IOWA: "America/Chicago",
  KANSAS: "America/Chicago",
  LOUISIANA: "America/Chicago",
  MINNESOTA: "America/Chicago",
  MISSISSIPPI: "America/Chicago",
  MISSOURI: "America/Chicago",
  NEBRASKA: "America/Chicago",
  "NORTH DAKOTA": "America/Chicago",
  OKLAHOMA: "America/Chicago",
  "SOUTH DAKOTA": "America/Chicago",
  TENNESSEE: "America/Chicago",
  TEXAS: "America/Chicago",
  WISCONSIN: "America/Chicago",
  CT: "America/New_York",
  DE: "America/New_York",
  FL: "America/New_York",
  GA: "America/New_York",
  IN: "America/New_York",
  KY: "America/New_York",
  ME: "America/New_York",
  MD: "America/New_York",
  MA: "America/New_York",
  MI: "America/New_York",
  NH: "America/New_York",
  NJ: "America/New_York",
  NY: "America/New_York",
  NC: "America/New_York",
  OH: "America/New_York",
  PA: "America/New_York",
  RI: "America/New_York",
  SC: "America/New_York",
  VT: "America/New_York",
  VA: "America/New_York",
  WV: "America/New_York",
  CONNECTICUT: "America/New_York",
  DELAWARE: "America/New_York",
  FLORIDA: "America/New_York",
  GEORGIA: "America/New_York",
  INDIANA: "America/New_York",
  KENTUCKY: "America/New_York",
  MAINE: "America/New_York",
  MARYLAND: "America/New_York",
  MASSACHUSETTS: "America/New_York",
  MICHIGAN: "America/New_York",
  "NEW HAMPSHIRE": "America/New_York",
  "NEW JERSEY": "America/New_York",
  "NEW YORK": "America/New_York",
  "NORTH CAROLINA": "America/New_York",
  OHIO: "America/New_York",
  PENNSYLVANIA: "America/New_York",
  "RHODE ISLAND": "America/New_York",
  "SOUTH CAROLINA": "America/New_York",
  VERMONT: "America/New_York",
  VIRGINIA: "America/New_York",
  "WEST VIRGINIA": "America/New_York",
  AK: "America/Anchorage",
  ALASKA: "America/Anchorage",
  HI: "Pacific/Honolulu",
  HAWAII: "Pacific/Honolulu",
};

const AREA_CODE_TZ_MAP = {
  "206": "America/Los_Angeles",
  "253": "America/Los_Angeles",
  "360": "America/Los_Angeles",
  "425": "America/Los_Angeles",
  "509": "America/Los_Angeles",
  "503": "America/Los_Angeles",
  "971": "America/Los_Angeles",
  "209": "America/Los_Angeles",
  "213": "America/Los_Angeles",
  "310": "America/Los_Angeles",
  "323": "America/Los_Angeles",
  "408": "America/Los_Angeles",
  "415": "America/Los_Angeles",
  "510": "America/Los_Angeles",
  "530": "America/Los_Angeles",
  "559": "America/Los_Angeles",
  "562": "America/Los_Angeles",
  "619": "America/Los_Angeles",
  "626": "America/Los_Angeles",
  "650": "America/Los_Angeles",
  "661": "America/Los_Angeles",
  "707": "America/Los_Angeles",
  "714": "America/Los_Angeles",
  "760": "America/Los_Angeles",
  "805": "America/Los_Angeles",
  "818": "America/Los_Angeles",
  "831": "America/Los_Angeles",
  "858": "America/Los_Angeles",
  "909": "America/Los_Angeles",
  "916": "America/Los_Angeles",
  "925": "America/Los_Angeles",
  "949": "America/Los_Angeles",
  "951": "America/Los_Angeles",
  "702": "America/Los_Angeles",
  "775": "America/Los_Angeles",
  "208": "America/Denver",
  "307": "America/Denver",
  "406": "America/Denver",
  "435": "America/Denver",
  "801": "America/Denver",
  "385": "America/Denver",
  "970": "America/Denver",
  "303": "America/Denver",
  "720": "America/Denver",
  "505": "America/Denver",
  "575": "America/Denver",
  "480": "America/Phoenix",
  "520": "America/Phoenix",
  "602": "America/Phoenix",
  "623": "America/Phoenix",
  "928": "America/Phoenix",
  "205": "America/Chicago",
  "256": "America/Chicago",
  "334": "America/Chicago",
  "479": "America/Chicago",
  "501": "America/Chicago",
  "312": "America/Chicago",
  "773": "America/Chicago",
  "847": "America/Chicago",
  "630": "America/Chicago",
  "815": "America/Chicago",
  "309": "America/Chicago",
  "217": "America/Chicago",
  "618": "America/Chicago",
  "319": "America/Chicago",
  "515": "America/Chicago",
  "316": "America/Chicago",
  "785": "America/Chicago",
  "504": "America/Chicago",
  "225": "America/Chicago",
  "318": "America/Chicago",
  "612": "America/Chicago",
  "651": "America/Chicago",
  "952": "America/Chicago",
  "763": "America/Chicago",
  "218": "America/Chicago",
  "601": "America/Chicago",
  "662": "America/Chicago",
  "314": "America/Chicago",
  "816": "America/Chicago",
  "417": "America/Chicago",
  "402": "America/Chicago",
  "308": "America/Chicago",
  "701": "America/Chicago",
  "405": "America/Chicago",
  "918": "America/Chicago",
  "605": "America/Chicago",
  "901": "America/Chicago",
  "615": "America/Chicago",
  "865": "America/Chicago",
  "423": "America/Chicago",
  "512": "America/Chicago",
  "214": "America/Chicago",
  "972": "America/Chicago",
  "469": "America/Chicago",
  "713": "America/Chicago",
  "281": "America/Chicago",
  "832": "America/Chicago",
  "210": "America/Chicago",
  "817": "America/Chicago",
  "915": "America/Chicago",
  "806": "America/Chicago",
  "956": "America/Chicago",
  "262": "America/Chicago",
  "414": "America/Chicago",
  "608": "America/Chicago",
  "920": "America/Chicago",
  "715": "America/Chicago",
  "907": "America/Anchorage",
  "808": "Pacific/Honolulu",
};

export function getLeadTimezone(state, phone) {
  if (state) {
    const cleanState = state.trim().toUpperCase();
    if (STATE_TIMEZONE_MAP[cleanState]) {
      return STATE_TIMEZONE_MAP[cleanState];
    }
  }

  if (phone) {
    const digits = phone.replace(/\D/g, "");
    let areaCode = "";
    if (digits.length === 11 && digits.startsWith("1")) {
      areaCode = digits.substring(1, 4);
    } else if (digits.length === 10) {
      areaCode = digits.substring(0, 3);
    }

    if (areaCode && AREA_CODE_TZ_MAP[areaCode]) {
      return AREA_CODE_TZ_MAP[areaCode];
    }
  }

  return "America/New_York";
}

export function getNextValidSendWindow(baseDate, timezone, sendWindowDays, sendWindowStart, sendWindowEnd) {
  if (!sendWindowDays || !sendWindowStart || !sendWindowEnd) {
    return baseDate;
  }

  const allowedDays = sendWindowDays.split(",").map((d) => d.trim().slice(0, 3).toLowerCase());
  if (allowedDays.length === 0) return baseDate;

  const [startHour, startMin] = sendWindowStart.split(":").map(Number);
  const [endHour, endMin] = sendWindowEnd.split(":").map(Number);

  let currentDate = new Date(baseDate);

  for (let i = 0; i < 14; i++) {
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
    const month = parseInt(getPart(ymdParts, 'month'), 10) - 1;
    const day = parseInt(getPart(ymdParts, 'day'), 10);

    const isAllowedDay = allowedDays.includes(weekday);

    if (isAllowedDay && (currentHour < startHour || (currentHour === startHour && currentMinute < startMin))) {
      const nextTime = createDateInTz(year, month, day, startHour, startMin, 0, timezone);
      if (nextTime > new Date()) return nextTime;
    }
    if (isAllowedDay &&
      (currentHour > startHour || (currentHour === startHour && currentMinute >= startMin)) &&
      (currentHour < endHour || (currentHour === endHour && currentMinute < endMin))) {
      return currentDate;
    }

    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    currentDate.setUTCHours(0, 0, 0, 0);
  }

  return baseDate;
}

function createDateInTz(year, month, day, hour, min, sec, tz) {
  const d = new Date(Date.UTC(year, month, day, hour, min, sec));
  const str = d.toLocaleString("en-US", { timeZone: tz });
  const localInTz = new Date(str);

  const offsetMs = d.getTime() - localInTz.getTime();
  return new Date(d.getTime() + offsetMs);
}
