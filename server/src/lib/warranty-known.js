import { describeCoverage } from "./coverage.js";

const ROOMS = [
  "kitchen",
  "bathroom",
  "master bath",
  "master bedroom",
  "bedroom",
  "living room",
  "family room",
  "dining room",
  "garage",
  "basement",
  "attic",
  "laundry",
  "utility room",
  "hallway",
  "closet",
  "pantry",
  "patio",
  "porch",
  "deck",
  "driveway",
  "crawl space",
  "upstairs",
  "downstairs",
  "ensuite",
  "powder room",
  "back yard",
  "front yard",
  "roof",
  "guest room",
  "office",
];

const FIXTURES = [
  "sink",
  "toilet",
  "shower",
  "tub",
  "bathtub",
  "faucet",
  "dishwasher",
  "washer",
  "dryer",
  "water heater",
  "furnace",
  "ac unit",
  "air conditioner",
  "fridge",
  "refrigerator",
  "oven",
  "range",
  "microwave",
  "disposal",
  "window",
  "door",
  "ceiling",
  "floor",
  "wall",
  "cabinet",
  "countertop",
];

const TIMING_PATTERNS = [
  /\b(?:just\s*(?:now|noticed)|right\s*now|today|tonight|this\s*(?:morning|afternoon|evening)|yesterday|last\s*(?:night|week|month))\b/i,
  /\b(?:since|for)\s+(?:the\s*)?(?:a\s*)?(?:few\s*)?(?:day|week|month|year|hour)s?\b/i,
  /\b(?:started|began|noticed|first\s*saw)\b.{0,20}\b(?:ago|when|after|during)\b/i,
  /\b\d+\s*(?:day|week|month|year|hour)s?\s*ago\b/i,
  /\b(?:ever\s*since|move[d]?\s*in|closing|walkthrough)\b/i,
];

function findFirst(haystack, needles) {
  const s = String(haystack || "").toLowerCase();
  // Longest first so "master bath" wins over "bath".
  const ordered = [...needles].sort((a, b) => b.length - a.length);
  return (
    ordered.find((n) =>
      new RegExp(`\\b${n.replace(/\s+/g, "\\s+")}\\b`, "i").test(s),
    ) || null
  );
}

export function detectLocation(text) {
  return findFirst(text, ROOMS);
}

export function detectFixture(text) {
  return findFirst(text, FIXTURES);
}

export function detectTiming(text) {
  const s = String(text || "");
  return TIMING_PATTERNS.some((re) => re.test(s));
}

export function absorbIssueDetails(issueState, text) {
  const location = detectLocation(text);
  if (location && !issueState.locationHint) issueState.locationHint = location;

  const fixture = detectFixture(text);
  if (fixture && !issueState.fixtureHint) issueState.fixtureHint = fixture;

  // "The tub tap is dripping" has already answered "where in the home is it?".
  if (!issueState.locationHint && issueState.fixtureHint) {
    const implied = FIXTURE_ROOMS[issueState.fixtureHint];
    if (implied) issueState.locationHint = implied;
  }

  if (!issueState.timingHint && detectTiming(text))
    issueState.timingHint = true;
  return issueState;
}

const FIXTURE_ROOMS = {
  tub: "bathroom",
  bathtub: "bathroom",
  shower: "bathroom",
  toilet: "bathroom",
  dishwasher: "kitchen",
  oven: "kitchen",
  range: "kitchen",
  microwave: "kitchen",
  disposal: "kitchen",
  fridge: "kitchen",
  refrigerator: "kitchen",
};

function coverageSummary(issueState) {
  const coverage = issueState?.coverage;
  if (!coverage || !coverage.status || coverage.status === "UNKNOWN")
    return null;

  const described = describeCoverage({
    status: coverage.status,
    endDate: coverage.endDate ? new Date(coverage.endDate) : null,
    daysRemaining: coverage.daysRemaining,
  });
  return described ? `${coverage.status} — ${described}` : coverage.status;
}

export function describeKnown({
  property = null,
  homeowner = null,
  community = null,
  issueState = {},
} = {}) {
  const lines = [];

  if (homeowner?.name) lines.push(`Homeowner: ${homeowner.name}`);
  if (homeowner?.email) lines.push(`Email on file: ${homeowner.email}`);

  const address = property?.address || issueState.propertyAddress;
  if (address)
    lines.push(
      `Property: ${address}${community ? ` (${community} community)` : ""}`,
    );

  const coverage = coverageSummary(issueState);
  if (coverage) lines.push(`Warranty coverage: ${coverage}`);

  if (issueState.issueSummary)
    lines.push(`Issue reported: ${issueState.issueSummary}`);
  if (issueState.locationHint)
    lines.push(`Location in the home: ${issueState.locationHint}`);
  if (issueState.fixtureHint)
    lines.push(`Fixture involved: ${issueState.fixtureHint}`);
  if (issueState.timingHint)
    lines.push("When it started: already described — do not ask again.");
  if (issueState.safetyAdvised)
    lines.push("Safety step: already given this conversation.");

  // What just happened to the lookup, in the same breath as the facts, because
  // the model writes the reply that has to account for it.
  const events = [];
  if (issueState.justIdentified) {
    events.push(
      "JUST NOW: their property was located from what they told you this turn. " +
        "Open your reply by naming the address and the coverage above so they know you have the right home, " +
        "then carry on with the issue. Do not ask for their email — you have it.",
    );
  }
  if (issueState.lookupFailed) {
    events.push(
      `JUST NOW: no property on file matches "${issueState.lookupFailed}". ` +
        "Say so plainly, ask them to check the address they used with the builder, and offer to log the request anyway " +
        "if they cannot find it. Do not guess at a property.",
    );
  }
  if (Array.isArray(issueState.propertyChoices) && issueState.propertyChoices.length > 1) {
    events.push(
      "JUST NOW: that email is on more than one property — " +
        issueState.propertyChoices.map((c) => c.address).join("; ") +
        ". Ask which one has the problem. They are shown as buttons, so do not number them yourself.",
    );
  }

  if (!lines.length && !events.length) {
    return "Nothing confirmed yet — you have not identified this homeowner or their property.";
  }

  return [
    lines.length ? "Confirmed facts, already on file or already told to you:" : "",
    ...lines.map((l) => `- ${l}`),
    lines.length
      ? "Use these. Never ask the homeowner for any of them, and never ask them to repeat themselves."
      : "",
    ...events,
  ]
    .filter(Boolean)
    .join("\n");
}
