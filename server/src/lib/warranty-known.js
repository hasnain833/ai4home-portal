import { formatCoverageDate } from "./coverage.js";

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

// "I already did that", "it's off", "I reset it but it's still broken".
const STEP_DONE_RE =
  /\b(?:already\s+(?:did|done|tried|have|turned|shut|switched|checked|reset|cleaned|replaced|closed|unplugged)|i\s+(?:did|have|tried)\s+(?:that|it|this|already)|(?:did|done|tried)\s+(?:that|it|this)\s+already|i(?:'ve|\s+have)\s+(?:already\s+)?(?:done|tried|turned|shut|switched|reset|checked|closed)|(?:it'?s|it\s+is|water\s+is|valve\s+is|breaker\s+is)\s+(?:already\s+|now\s+)?(?:off|shut(?:\s*off)?|closed|turned\s*off)|i\s+(?:reset|replaced|cleaned|checked|unplugged|flipped|closed|turned|shut|switched|tightened)\s+(?:it|that|this|the|them)\b|yes,?\s+(?:i\s+)?(?:did|done|have)\b|as\s+i\s+(?:said|told\s+you|mentioned))/i;
// "I can't find the valve", "I don't know where it is".
const STEP_BLOCKED_RE =
  /\b(?:i\s+(?:can'?t|cannot|couldn'?t)\s+(?:find|reach|do|get\s+to|turn|open|close|see|tell|access|locate)|(?:don'?t|do\s+not)\s+know\s+(?:how|where)|unable\s+to)\b/i;

const normalizedReply = (text) => String(text || "").replace(/[\u2018\u2019]/g, "'").trim();

export function reportsStepDone(text) {
  const reply = normalizedReply(text);
  // A question, intention or negative answer is not a completed action.
  if (/\?\s*$/.test(reply) || /\b(?:haven't|have not|hasn't|has not|didn't|did not|not yet|never|will|going to)\b.{0,30}\b(?:done|did|tried|try|turn|turned|shut|switch|switched|check|checked|reset|close|closed|completed|finished)\b/i.test(reply)) return false;
  if (/\b(?:already\s+(?:have|has))\b/i.test(reply) && !/\b(?:done|tried|turned|shut|switched|checked|reset|cleaned|replaced|closed|unplugged)\b/i.test(reply)) return false;
  if (/\bas i (?:said|told you|mentioned)\b/i.test(reply) && !/\b(?:done|did|tried|turned|shut|switched|checked|reset|closed|off)\b/i.test(reply)) return false;
  return STEP_DONE_RE.test(reply) || /\bi(?:'ve| have)? (?:already )?(?:completed|finished) (?:it|that|this|the step)\b/i.test(reply) || /^(?:done|already done|yes|yes,? i have)[.!]*$/i.test(reply);
}

export const reportsStepBlocked = (text) => STEP_BLOCKED_RE.test(normalizedReply(text));

export function reportsProblemStillPresent(text) {
  return /\b(?:still\s+(?:not\s+)?(?:leak\w*|drip\w*|broken|happening|there|the same|not working|working)|(?:didn't|did not|hasn't|has not)\s+(?:help|work|fix)|no\s+(?:change|difference)|not\s+(?:fixed|resolved)|problem\s+(?:remains|persists))\b/i.test(normalizedReply(text));
}

export function reportsProblemFixed(text) {
  const reply = normalizedReply(text);
  return !reportsProblemStillPresent(reply) && !/\b(?:not|isn't|is not|hasn't|has not|never)\b.{0,20}\b(?:fixed|resolved|working|stopped)\b/i.test(reply) && /\b(?:it's fixed|it is fixed|problem is fixed|issue is resolved|(?:it|everything) (?:is )?work(?:s|ing)(?: fine)? now|(?:leak|leaking|drip|dripping) (?:has )?stopped)\b/i.test(reply);
}

export function isPhotoStepReply(text) {
  const reply = normalizedReply(text);
  if (/\?\s*$/.test(reply)) return false;
  if (/^(?:done|skip|skip (?:it|that|photos)|no photos|already done|i already did that)[.!]*$/i.test(reply)) return true;
  if (reportsStepDone(reply) || reportsStepBlocked(reply)) return true;
  if (/\bi(?:'ve| have)? (?:already )?(?:sent|submitted|provided) (?:them|those|it)\b/i.test(reply) && !/\b(?:not|never|haven't)\b/i.test(reply)) return true;
  if (!/\b(?:photos?|pictures?|images?|upload\w*|attach\w*)\b/i.test(reply)) return false;
  if (/\b(?:haven't|have not|not yet|will|going to)\b/i.test(reply)) return false;
  return /\b(?:added|uploaded|attached|sent|already|skip|can't|cannot|unable|don't have|do not have|don't want|do not want|prefer not|no)\b/i.test(reply);
}

// `latest` is the homeowner's newest message: what it names replaces an earlier
// answer, so "actually it's the upstairs bathroom" corrects the location.
// ponytail: keyword match, so a message naming two rooms keeps the longer name, not the corrected one.
export function absorbIssueDetails(issueState, text, latest = "") {
  const newLocation = detectLocation(latest);
  const location = newLocation || detectLocation(text);
  if (location && (newLocation || !issueState.locationHint || issueState.locationImplied)) {
    issueState.locationHint = location;
    delete issueState.locationImplied;
  }

  const fixture = detectFixture(latest) || (!issueState.fixtureHint && detectFixture(text));
  if (fixture) issueState.fixtureHint = fixture;

  // "The tub tap is dripping" has already answered "where in the home is it?" —
  // but that is our inference, so it is marked as one.
  if (!issueState.locationHint && issueState.fixtureHint) {
    const implied = FIXTURE_ROOMS[issueState.fixtureHint];
    if (implied) {
      issueState.locationHint = implied;
      issueState.locationImplied = true;
    }
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

  const when = formatCoverageDate(coverage.endDate);
  if (!when) return coverage.status;

  return coverage.status === "EXPIRED"
    ? `${coverage.status} — ended ${when}`
    : `${coverage.status} — runs through ${when}`;
}

export function describeKnown({
  property = null,
  homeowner = null,
  community = null,
  issueState = {},
} = {}) {
  // Verified by the system.
  const lines = [];
  // Homeowner's own words — observations they may correct. Kept out of the
  // verified list, and their free text stays in the conversation, not here.
  const reported = [];

  if (homeowner?.name) lines.push(`Homeowner: ${homeowner.name}`);
  if (homeowner?.email) lines.push(`Email on file: ${homeowner.email}`);

  const address = property?.address || issueState.propertyAddress;
  if (address)
    lines.push(
      `Property: ${address}${community ? ` (${community} community)` : ""}`,
    );

  const coverage = coverageSummary(issueState);
  if (coverage)
    lines.push(
      `Warranty period on file: ${coverage}. This is the account's warranty period, not proof this issue is covered. Do NOT volunteer it — state the end date only if the homeowner asks about their coverage or when it ends.`,
    );
  if (issueState.ticketFiled)
    lines.push("A ticket for this issue has been filed by the system.");

  if (issueState.issueSummary)
    reported.push("The issue: described in the conversation — do not ask them to describe it again.");
  if (issueState.locationHint)
    reported.push(
      issueState.locationImplied
        ? `Location in the home: probably the ${issueState.locationHint} (inferred from the fixture, not stated)`
        : `Location in the home: ${issueState.locationHint}`,
    );
  if (issueState.fixtureHint)
    reported.push(`Fixture involved: ${issueState.fixtureHint}`);
  if (issueState.timingHint)
    reported.push("When it started: already described — do not ask again.");
  if (issueState.safetyAdvised) {
    lines.push(`Safety step for ${issueState.hazardKey || "the hazard"}: already given this conversation.`);
    if (issueState.safetyDoneFor && issueState.safetyDoneFor === issueState.hazardKey)
      reported.push("They report having completed the safety step. Do not ask them to repeat or confirm it again.");
  }

  // What just happened to the lookup, in the same breath as the facts, because
  // the model writes the reply that has to account for it.
  const events = [];
  if (issueState.justIdentified) {
    events.push(
      "JUST NOW: their property was located from what they told you this turn. " +
        "Open your reply by naming the address (not the coverage dates) so they know you have the right home, " +
        "then carry on with the issue. Do not ask for their email — you have it.",
    );
  }
  if (issueState.lookupFailed) {
    events.push(
      `JUST NOW: no property on file matches "${issueState.lookupFailed}". ` +
        "Say so plainly and ask them to check the email address they used with the builder. " +
        "A request cannot be logged without finding their file, so do not offer to. Do not guess at a property.",
    );
  }
  if (issueState.stepDone) {
    events.push(
      `The homeowner has told you ${issueState.stepDone} time(s) that they already did what was asked. ` +
        "Do not ask them to do it, try it, or confirm it again. If the problem is still there, move to logging it (transition_phase RESOLVE).",
    );
  }
  if (issueState.stepBlocked) {
    events.push(
      "The homeowner said they cannot do a step you gave them. Do not ask them to try it again — move on, or log it for the warranty team.",
    );
  }
  if ((issueState.diagnoseTurns || 0) >= 3) {
    events.push(
      "You have already asked your three diagnostic questions. Do not ask another — move to logging it (transition_phase RESOLVE).",
    );
  }
  if (Array.isArray(issueState.propertyChoices) && issueState.propertyChoices.length > 1) {
    events.push(
      "JUST NOW: that email is on more than one property — " +
        issueState.propertyChoices.map((c) => c.address).join("; ") +
        ". Ask which one has the problem. They are shown as buttons, so do not number them yourself.",
    );
  }

  if (!lines.length && !reported.length && !events.length) {
    return "Nothing confirmed yet — you have not identified this homeowner or their property.";
  }

  return [
    lines.length ? "On file (verified by the system):" : "Not yet identified — no property or account on file.",
    ...lines.map((l) => `- ${l}`),
    reported.length ? "Reported by the homeowner (their observations; they may correct these — the newest version wins):" : "",
    ...reported.map((l) => `- ${l}`),
    lines.length || reported.length
      ? "Never ask the homeowner for any of these again, and never ask them to repeat themselves."
      : "",
    ...events,
  ]
    .filter(Boolean)
    .join("\n");
}
