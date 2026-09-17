export const SEVERITY = {
  EMERGENCY: "EMERGENCY",
  CONTAINMENT: "CONTAINMENT",
};

export const HAZARD_ICON = {
  [SEVERITY.EMERGENCY]: "🚨",
  [SEVERITY.CONTAINMENT]: "⚠️",
};

const HAZARDS = [
  {
    key: "GAS",
    severity: SEVERITY.EMERGENCY,
    label: "possible gas leak",
    patterns: [
      /\bgas\s*(?:leak|smell|odou?r)\b/i,
      /\bsmell(?:ing|s)?\s+(?:of\s+)?(?:natural\s+)?gas\b/i,
      /\bpropane\s*(?:leak|smell)\b/i,
      /\brotten\s*egg\s*smell\b/i,
    ],
    fallback: "get everyone out of the house now and call 911 and your gas utility from outside.",
    given: /\b(?:call\s*911|get\s*everyone\s*out|leave\s*the\s*house)\b/i,
  },
  {
    key: "CARBON_MONOXIDE",
    severity: SEVERITY.EMERGENCY,
    label: "possible carbon monoxide",
    patterns: [
      /\bcarbon\s*monoxide\b/i,
      /\bco\s*(?:detector|alarm)\b/i,
    ],
    fallback: "get everyone outside into fresh air now and call 911.",
    given: /\b(?:call\s*911|outside|fresh\s*air)\b/i,
  },
  {
    key: "FIRE",
    severity: SEVERITY.EMERGENCY,
    label: "fire or smoke",
    patterns: [
      /\bon\s*fire\b/i,
      /\bcaught\s*fire\b/i,
      /\bflames?\b/i,
      /\bsmoke\s*(?:is\s*)?(?:coming|filling|pouring|billowing)\b/i,
    ],
    fallback: "get everyone out of the house and call 911 now.",
    given: /\b(?:call\s*911|get\s*everyone\s*out)\b/i,
  },
  {
    key: "ELECTRICAL",
    severity: SEVERITY.EMERGENCY,
    label: "live electrical fault",
    patterns: [
      /\bspark(?:s|ing|ed)?\b/i,
      /\barcing\b/i,
      /\bexposed\s*(?:live\s*)?wir/i,
      /\bburning\s*(?:smell|plastic|odou?r)\b/i,
      /\bsmells?\s*like\s*burning\b/i,
      /\b(?:got\s*)?(?:an\s*)?electric(?:al)?\s*shock\b/i,
      /\bshocked\s*(?:me|him|her|us|my)\b/i,
      /\boutlet\s*(?:is\s*)?(?:hot|smoking|melting|burnt|burned)\b/i,
    ],
    fallback: "don't touch it, switch off the breaker for that area if you can reach the panel safely, and call 911 if you see smoke or flames.",
    given: /\b(?:breaker|don't\s*touch|call\s*911)\b/i,
  },
  {
    key: "STRUCTURAL",
    severity: SEVERITY.EMERGENCY,
    label: "structure giving way",
    patterns: [
      /\bceiling\s*(?:is\s*)?(?:sagging|bulging|collapsing|caving|coming\s*down|falling)\b/i,
      /\bcollaps(?:e|ed|ing)\b/i,
      /\bfloor\s*(?:is\s*)?(?:giving\s*way|sinking|caving)\b/i,
    ],
    fallback: "stay out of that room and keep everyone away from it.",
    given: /\b(?:stay\s*out|keep\s*everyone\s*away|call\s*911)\b/i,
  },
  {
    key: "FLOODING",
    severity: SEVERITY.CONTAINMENT,
    label: "water flowing into the home",
    patterns: [
      /\bflood(?:ing|ed)\b/i,
      /\bburst\s*(?:pipe|line)\b/i,
      /\bpipe\s*(?:burst|broke|has\s*broken|cracked|split)\b/i,
      /\bwater\s*(?:is\s*)?(?:pouring|gushing|spraying|shooting)\b/i,
      /\bwater\s*(?:is\s*)?everywhere\b/i,
    ],
    fallback: "shut off the main water valve for the house and keep everyone clear of the water.",
    given: /\b(?:main\s*water\s*valve|shut(?:ting)?\s*(?:the\s*)?(?:main|water)|turn(?:ing)?\s*(?:the\s*)?water\s*off)\b/i,
  },
  {
    key: "SEWAGE",
    severity: SEVERITY.CONTAINMENT,
    label: "sewage backing up",
    patterns: [
      /\bsewage\b/i,
      /\bsewer\s*(?:backup|back-up|backing\s*up|smell|gas)\b/i,
      /\btoilet\s*(?:is\s*)?overflow/i,
      /\boverflowing\s*toilet\b/i,
    ],
    fallback: "stop running water anywhere in the house and keep everyone away from what it has touched.",
    given: /\b(?:stop\s*running\s*water|stop\s*using\s*water|keep\s*(?:people|everyone)\s*away)\b/i,
  },
  {
    key: "WATER",
    severity: SEVERITY.CONTAINMENT,
    label: "water where it shouldn't be",
    patterns: [
      /\bleak(?:s|ing|ed|age)?\b/i,
      /\bdrip(?:s|ping|ped)?\b/i,
      /\bwater\s*damage\b/i,
      /\bwater\s*(?:is\s*)?(?:pooling|seeping|running|dripping|leaking|coming\s*(?:in|through|out|up))\b/i,
      /\bwater\s*(?:under|underneath|below|behind|around)\b/i,
      /\bwater\s*(?:on|all\s*over)\s*(?:the\s*)?(?:floor|ground|carpet|ceiling|counter)\b/i,
      /\bwater\s*in\s*(?:the\s*)?(?:basement|crawl\s*space|garage|attic|cabinet|wall|ceiling|light)\b/i,
      /\b(?:puddle|standing\s*water|water\s*stain|wet\s*spot|damp\s*spot)\b/i,
      /\b(?:soaked|saturated|sopping)\b/i,
    ],
    fallback: "shut the water off at the valve for that fixture, or the main valve for the house, then put a towel or bucket underneath.",
    given: /\b(?:shut(?:\s*|-)?off\s*valve|shut\s*(?:the\s*)?water|turn\s*(?:the\s*)?water\s*off|water\s*off\s*first|main\s*valve)\b/i,
  },
];


export function homeownerText(transcript = [], latest = "") {
  const said = (Array.isArray(transcript) ? transcript : [])
    .filter((t) => t && t.role !== "agent")
    .map((t) => String(t.content || ""));
  return [...said, String(latest || "")].join("\n").trim();
}

export function detectHazard(text) {
  const s = String(text || "");
  if (!s.trim()) return null;

  for (const hazard of HAZARDS) {
    if (hazard.patterns.some((re) => re.test(s))) {
      return {
        key: hazard.key,
        severity: hazard.severity,
        label: hazard.label,
        fallback: hazard.fallback,
        icon: HAZARD_ICON[hazard.severity],
      };
    }
  }
  return null;
}


export function safetyLine(hazard) {
  if (!hazard) return "";
  const lead =
    hazard.severity === SEVERITY.EMERGENCY ? "Do this first —" : "Before anything else —";
  return `${hazard.icon} ${lead} ${hazard.fallback}`;
}


export function mentionsSafetyAction(text, hazard) {
  if (!hazard) return true;
  const s = String(text || "");
  if (s.includes(hazard.icon)) return true;
  const entry = HAZARDS.find((h) => h.key === hazard.key);
  return entry ? entry.given.test(s) : false;
}


export function alreadyAdvised(transcript, hazard) {
  if (!hazard) return false;
  return (Array.isArray(transcript) ? transcript : [])
    .filter((t) => t && t.role === "agent")
    .some((t) => mentionsSafetyAction(t.content, hazard));
}

export function hazardNotice(hazard, { advised = false, identified = false } = {}) {
  if (!hazard) {
    return "No hazard detected in what the homeowner has described so far. Do not invent one.";
  }

  const emergency = hazard.severity === SEVERITY.EMERGENCY;
  const urgency = emergency
    ? "This is a life-safety situation."
    : "Nobody is in danger, but the home is taking damage for as long as this continues.";

  let timing;
  if (advised) {
    timing =
      "You have already given this instruction. Do not repeat it in full — a short check that they managed it is enough, then carry on.";
  } else if (emergency) {
    timing =
      `Give this NOW, at the top of your very next reply, opened with ${hazard.icon}. ` +
      "It comes before identifying them, before their email, before anything else.";
  } else if (!identified) {
    timing =
      "You have not identified their property yet. Ask for the email address on their warranty file first, " +
      `then open the reply that confirms their property with this instruction, marked ${hazard.icon}, ` +
      "before any diagnostic question.";
  } else {
    timing =
      `This goes FIRST in your next reply, opened with ${hazard.icon}, before any diagnostic question. ` +
      "Ask your other questions only after it.";
  }

  return [
    `HAZARD DETECTED: ${hazard.key} — ${hazard.label} (${hazard.severity}). ${urgency}`,
    `Give the ${hazard.key} step from the safety playbook below, in your own words, fitted to what they actually described.`,
    timing,
  ].join("\n");
}
