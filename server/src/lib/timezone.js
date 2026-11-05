import { getZonedParts, zonedTimeToUtc } from "./scheduling.js";
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
  DC: "America/New_York",
  "DISTRICT OF COLUMBIA": "America/New_York",
  ON: "America/New_York",
  ONTARIO: "America/New_York",
  QC: "America/New_York",
  QUEBEC: "America/New_York",
  MB: "America/Chicago",
  MANITOBA: "America/Chicago",
  SK: "America/Regina",
  SASKATCHEWAN: "America/Regina",
  AB: "America/Denver",
  ALBERTA: "America/Denver",
  BC: "America/Los_Angeles",
  "BRITISH COLUMBIA": "America/Los_Angeles",
  NS: "America/Halifax",
  "NOVA SCOTIA": "America/Halifax",
  NB: "America/Halifax",
  "NEW BRUNSWICK": "America/Halifax",
  PE: "America/Halifax",
  "PRINCE EDWARD ISLAND": "America/Halifax",
  NL: "America/St_Johns",
  NEWFOUNDLAND: "America/St_Johns",
  YT: "America/Whitehorse",
  YUKON: "America/Whitehorse",
  NT: "America/Edmonton",
  NU: "America/Winnipeg",
};

// North American area codes by time zone. A code spanning two zones uses its main one.
const AREA_CODES_BY_TZ = {
  "America/New_York": "201 202 203 207 212 215 216 220 223 226 227 229 231 234 239 240 248 249 252 260 263 267 269 272 276 278 283 289 301 302 304 305 313 315 317 321 324 326 329 330 332 336 339 343 347 351 352 354 363 365 367 380 382 386 401 404 407 410 412 413 416 418 419 423 434 436 437 438 440 443 445 450 463 468 470 472 475 478 484 502 508 513 514 516 517 518 519 540 548 551 561 567 570 571 574 579 581 582 585 586 603 606 607 609 610 613 614 616 617 631 640 645 646 647 656 667 678 679 680 681 683 686 689 703 704 705 706 716 717 718 724 727 729 732 734 740 742 743 753 754 757 762 765 770 771 772 774 781 786 802 803 804 807 810 812 813 814 819 826 828 835 838 839 843 845 848 854 856 857 859 860 862 863 864 865 873 878 904 905 906 908 910 912 914 917 919 929 930 934 937 941 942 943 947 948 954 959 973 978 980 984 989",
  "America/Chicago": "204 205 210 214 217 218 219 224 225 228 235 251 254 256 262 270 274 281 308 309 312 314 316 318 319 320 325 327 331 334 337 346 353 361 364 402 405 409 414 417 430 431 432 447 448 464 469 471 479 501 504 507 512 515 531 534 539 557 563 572 573 580 584 601 605 608 612 615 618 620 629 630 636 641 651 659 660 662 682 701 708 712 713 715 726 730 731 737 763 769 773 779 785 806 815 816 817 830 832 847 850 861 870 872 901 903 913 918 920 924 936 938 940 945 952 956 972 975 979 985",
  "America/Regina": "306 474 639",
  "America/Denver": "208 303 307 368 385 403 406 435 505 575 587 719 720 780 801 825 867 915 970 983 986",
  "America/Phoenix": "480 520 602 623 928",
  "America/Los_Angeles": "206 209 213 236 250 253 257 279 310 323 341 350 360 369 408 415 424 425 442 458 503 509 510 530 541 559 562 564 604 619 626 628 650 657 661 669 672 702 707 714 725 747 760 775 778 805 818 820 831 837 840 858 909 916 925 949 951 971",
  "America/Anchorage": "907",
  "Pacific/Honolulu": "808",
  "America/Halifax": "428 506 782 902",
  "America/St_Johns": "709",
  "America/Puerto_Rico": "787 939",
};
const AREA_CODE_TZ_MAP = Object.fromEntries(
  Object.entries(AREA_CODES_BY_TZ).flatMap(([tz, codes]) => codes.split(" ").map((code) => [code, tz])),
);

const DEFAULT_TIMEZONE = "America/New_York";

/** The lead's time zone, and whether we actually know it or fell back to the default. */
export function resolveLeadTimezone(state, phone) {
  const fromState = state ? STATE_TIMEZONE_MAP[String(state).trim().toUpperCase()] : null;
  if (fromState) return { timezone: fromState, known: true };

  const digits = String(phone || "").replace(/\D/g, "");
  const areaCode = digits.length === 11 && digits.startsWith("1") ? digits.substring(1, 4) : digits.length === 10 ? digits.substring(0, 3) : "";
  if (AREA_CODE_TZ_MAP[areaCode]) return { timezone: AREA_CODE_TZ_MAP[areaCode], known: true };

  return { timezone: DEFAULT_TIMEZONE, known: false };
}

export function getLeadTimezone(state, phone) {
  return resolveLeadTimezone(state, phone).timezone;
}

/** A business lead has a free-text "City / State" field, e.g. "Long Beach, CA" or "Ohio". */
export function b2bLeadTimezone(lead) {
  const parts = String(lead?.city || "").split(",");
  const state = parts[parts.length - 1].replace(/[.\d]/g, "").trim();
  return resolveLeadTimezone(state, lead?.phone);
}

// With no known location, stay inside 8am–9pm across the mainland time zones, on the default zone's clock.
export const SEND_HOURS = { start: "08:00", end: "21:00" };
export const UNKNOWN_TZ_SEND_HOURS = { start: "11:00", end: "20:00" };

export const sendHoursFor = (known) => (known ? SEND_HOURS : UNKNOWN_TZ_SEND_HOURS);

/** Moves a picked time into the safe hours when the lead's location is unknown. */
export function safeSendTime(hhmm, known) {
  if (known) return hhmm;
  if (hhmm < UNKNOWN_TZ_SEND_HOURS.start) return UNKNOWN_TZ_SEND_HOURS.start;
  return hhmm >= UNKNOWN_TZ_SEND_HOURS.end ? "19:30" : hhmm;
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
    // hour12:false formats local midnight as "24" in en-US.
    const currentHour = parseInt(getPart(parts, 'hour') || "0", 10) % 24;
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

    // Next midnight on the lead's clock; UTC midnight can land mid-afternoon there.
    currentDate = createDateInTz(year, month, day + 1, 0, 0, 0, timezone);
  }

  return baseDate;
}

const SEND_TIME_GRACE_MS = 60 * 60 * 1000;

/**
 * When a step picked for `hhmm` on the lead's clock goes out, given the earliest
 * allowed moment `base`. A slot that has just arrived is kept, so a queued run
 * isn't pushed to tomorrow; anything later rolls to the next occurrence.
 */
export function nextLocalSendTime(base, timezone, hhmm, now = new Date()) {
  const [hour, minute] = hhmm.split(":").map(Number);
  const booked = new Date(base);
  const b = getZonedParts(booked, timezone);
  if (
    booked <= now && now - booked < SEND_TIME_GRACE_MS &&
    b.hour === hour && b.minute === minute &&
    getZonedParts(now, timezone).hour < 21
  ) {
    return booked;
  }
  const from = booked > now ? booked : now;
  const { year, month, day } = getZonedParts(from, timezone);
  const candidate = zonedTimeToUtc(year, month, day, hour, minute, timezone);
  return candidate >= now ? candidate : zonedTimeToUtc(year, month, day + 1, hour, minute, timezone);
}

// Wall-clock time in `tz` -> UTC instant. Independent of the server's own time zone.
function createDateInTz(year, month, day, hour, min, sec, tz) {
  return zonedTimeToUtc(year, month + 1, day, hour, min, tz);
}
