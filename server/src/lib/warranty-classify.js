import { toolCall } from "./llm.js";

export const TICKET_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

const EMERGENCY_PATTERNS = [
  /\bgas\s*(leak|smell|odor|odour)\b/i,
  /\bsmell(ing)?\s+gas\b/i,
  /\bcarbon\s*monoxide\b/i,
  /\bco\s*(detector|alarm)\s*(is\s*)?(going off|alarming|beeping)\b/i,
  /\b(house|home|kitchen|garage|attic|electrical|grease)?\s*fire\s*(is\s*)?(started|starting|spreading|burning|broke out)\b/i,
  /\b(there\s+is|there's|we\s+have|i\s+have)\s+a\s+fire\b/i,
  /\bon\s+fire\b/i,
  /\bcaught\s+fire\b/i,
  /\bsmoke\s*(is\s*)?(coming|filling|pouring|billowing)\b/i,
  /\b(sparks?|sparking|arcing)\b/i,
  /\bactive(ly)?\s*flood/i,
  /\bflooding\b/i,
  /\bburst\s*pipe\b/i,
  /\bwater\s*(is\s*)?(pouring|gushing|everywhere)\b/i,
  /\bsewage\s*(backup|back-up|backing up)\b/i,
  /\bexposed\s*(live\s*)?wir/i,
  /\bceiling\s*(is\s*)?(collapsing|caving)\b/i,
  /\bstructural\s*collapse\b/i,
  /\bno\s*heat\b.*\bfreez/i,
];

const ISSUE_TYPE_HINTS = [
  [/\b(dishwashers?|ovens?|ranges?|microwaves?|disposals?|refrigerators?|fridges?|washers?|dryers?|appliances?)\b/i, "Appliances"],
  [/\b(water\s*heaters?|hot\s*water\s*(heaters?|tanks?)|tankless)\b/i, "Plumbing"],
  [/\b(hvac|furnaces?|heating|heaters?|heat|a\/c|ac|air.?condition\w*|thermostats?|vents?|cooling|condensers?)\b/i, "HVAC"],
  [/\b(roofs?|roofing|shingles?|gutters?|attics?|soffits?)\b/i, "Roofing"],
  [/\b(leaks?|leaking|water|plumbing|plumber|drains?|draining|toilets?|faucets?|sinks?|pipes?|sewage|valves?)\b/i, "Plumbing"],
  [/\b(electrical|electric|outlets?|breakers?|wiring|switch|switches|panels?|receptacles?)\b/i, "Electrical"],
  [/\b(windows?|doors?|glass|screens?|locks?|latch|latches)\b/i, "Windows & Doors"],
  [/\b(floors?|flooring|tiles?|carpet|hardwood|grout\w*|baseboards?)\b/i, "Flooring"],
  [/\b(cabinets?|counters?|countertops?|trim|molding|millwork)\b/i, "Cabinets & Trim"],
  [/\b(foundations?|slabs?|settling|settlement|structural|structure)\b/i, "Structural"],
  [/\b(drywall|cracks?|cracking|paint\w*|ceilings?|walls?|nail pops?)\b/i, "Drywall & Paint"],
];

const CLASSIFY_TOOL = {
  name: "classify_claim",
  description: "Classify a homeowner's warranty issue into structured ticket fields.",
  input_schema: {
    type: "object",
    properties: {
      issue_type: {
        type: "string",
        description:
          "The trade or category this issue belongs to, e.g. Plumbing, Electrical, HVAC, Roofing, Drywall & Paint, Flooring, Appliances, Structural. Two or three words at most.",
      },
      priority: {
        type: "string",
        enum: TICKET_PRIORITIES,
        description:
          "URGENT for a life-safety risk or an actively worsening failure, HIGH when the home is not usable as normal, MEDIUM for a real defect that can wait a few days, LOW for cosmetic issues.",
      },
      symptom: {
        type: "string",
        description: "What the homeowner is actually observing, in one short phrase.",
      },
      location: {
        type: "string",
        description:
          "Where in the home the issue is, e.g. 'primary bathroom', 'garage'. Empty string if the homeowner has not said.",
      },
      is_emergency: {
        type: "boolean",
        description:
          "True only for a life-safety emergency: gas leak, fire, smoke, active flooding, sewage backup, exposed live wiring, or structural collapse.",
      },
      summary: {
        type: "string",
        description: "One sentence a warranty coordinator could read to understand the claim.",
      },
    },
    required: ["issue_type", "priority", "symptom", "is_emergency", "summary"],
  },
};

const CLASSIFY_SYSTEM = `You classify home warranty claims into structured ticket fields.
Report only what the homeowner has actually described. Do not infer damage, causes, or severity they did not report.
Do not decide whether the issue is covered under warranty — that is the warranty team's call, not yours.
If a detail was never mentioned, return an empty string for it rather than guessing.`;

export function matchesEmergencyPattern(text) {
  const s = String(text || "");
  return EMERGENCY_PATTERNS.some((re) => re.test(s));
}

export function homeownerLinesOnly(context) {
  return String(context || "")
    .split("\n")
    .filter((line) => !/^\s*Assistant\s*:/i.test(line))
    .join("\n");
}

export function guessIssueType(text) {
  const s = String(text || "");
  for (const [re, label] of ISSUE_TYPE_HINTS) {
    if (re.test(s)) return label;
  }
  return "General Warranty";
}

export function normalizePriority(value, { isEmergency = false } = {}) {
  if (isEmergency) return "URGENT";
  const upper = String(value || "").toUpperCase().trim();
  return TICKET_PRIORITIES.includes(upper) ? upper : "MEDIUM";
}

export function classifyClaimHeuristic(description) {
  const text = String(description || "").trim();
  const isEmergency = matchesEmergencyPattern(text);
  return {
    issueType: guessIssueType(text),
    priority: normalizePriority(isEmergency ? "URGENT" : "MEDIUM", { isEmergency }),
    symptom: text.slice(0, 200),
    location: "",
    isEmergency,
    summary: text.slice(0, 400),
    source: "heuristic",
  };
}

export async function classifyClaim({ companyId, description, context = "" }) {
  const text = String(description || "").trim();
  if (!text) {
    return { ...classifyClaimHeuristic(""), source: "empty" };
  }

  const fallback = classifyClaimHeuristic(text);

  let input = null;
  try {
    input = await toolCall({
      companyId,
      system: CLASSIFY_SYSTEM,
      messages: [
        {
          role: "user",
          content: context
            ? `Conversation so far:\n${context}\n\nThe issue to classify:\n${text}`
            : `The issue to classify:\n${text}`,
        },
      ],
      tool: CLASSIFY_TOOL,
      maxTokens: 300,
      fast: true,
      temperature: 0,
    });
  } catch (err) {
    console.error("[Warranty Classify] Call threw, using heuristic:", err.message);
    return fallback;
  }

  if (!input || !input.issue_type) {
    console.warn("[Warranty Classify] No usable classification returned, using heuristic.");
    return fallback;
  }

  const isEmergency =
    !!input.is_emergency || matchesEmergencyPattern(`${text}\n${homeownerLinesOnly(context)}`);

  return {
    issueType: String(input.issue_type || "").trim().slice(0, 80) || fallback.issueType,
    priority: normalizePriority(input.priority, { isEmergency }),
    symptom: String(input.symptom || "").trim().slice(0, 300) || fallback.symptom,
    location: String(input.location || "").trim().slice(0, 120),
    isEmergency,
    summary: String(input.summary || "").trim().slice(0, 600) || fallback.summary,
    source: "model",
  };
}
