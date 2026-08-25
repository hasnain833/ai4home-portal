import {
  PROMPT_DEFAULTS,
  PROMPT_PLACEHOLDERS,
  validatePromptDraft,
} from "./sales-agent.js";
import {
  WARRANTY_PHASE_PROMPTS,
  WARRANTY_PLACEHOLDERS,
} from "./warranty-agent.js";

export const AGENT_TYPES = {
  SALES: "sales",
  WARRANTY: "warranty",
};

export const PROMPT_REGISTRY = {
  [AGENT_TYPES.SALES]: {
    label: "Sales Agent",
    description: "Books consultations with new-home leads across SMS, web chat, and email.",
    kb: "sales",
    editable: true,
    placeholders: PROMPT_PLACEHOLDERS,
    validate: validatePromptDraft,
    prompts: {
      systemTemplate: { label: "System prompt", default: PROMPT_DEFAULTS.systemTemplate },
      toolDescription: { label: "Tool description", default: PROMPT_DEFAULTS.toolDescription },
      kbEmptyText: { label: "No-KB fallback", default: PROMPT_DEFAULTS.kbEmptyText },
    },
  },

  [AGENT_TYPES.WARRANTY]: {
    label: "Warranty Agent",
    description: "Diagnoses homeowner issues and files warranty tickets. Migrating off BotPress.",
    kb: "warranty",
    editable: false,
    placeholders: WARRANTY_PLACEHOLDERS,
    validate: null,
    prompts: {
      INTAKE: { label: "Intake phase", default: WARRANTY_PHASE_PROMPTS.INTAKE },
      IDENTIFY: { label: "Identify phase", default: WARRANTY_PHASE_PROMPTS.IDENTIFY },
      DIAGNOSE: { label: "Diagnose phase", default: WARRANTY_PHASE_PROMPTS.DIAGNOSE },
      RESOLVE: { label: "Resolve phase", default: WARRANTY_PHASE_PROMPTS.RESOLVE },
    },
  },
};

export function getAgentSpec(agentType) {
  return PROMPT_REGISTRY[agentType] || null;
}

export function listAgents() {
  return Object.entries(PROMPT_REGISTRY).map(([type, spec]) => ({
    type,
    label: spec.label,
    description: spec.description,
    kb: spec.kb,
    editable: spec.editable,
    promptKeys: Object.keys(spec.prompts),
  }));
}

/** The shipped defaults for an agent, as a { promptKey: template } map. */
export function defaultsFor(agentType) {
  const spec = getAgentSpec(agentType);
  if (!spec) return null;
  return Object.fromEntries(
    Object.entries(spec.prompts).map(([key, entry]) => [key, entry.default]),
  );
}
