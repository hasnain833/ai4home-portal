export { renderTemplate, usedTokens, checkTokens } from "./template.js";

export {
  PROMPT_PLACEHOLDERS,
  PROMPT_DEFAULTS,
  DEFAULT_SYSTEM_TEMPLATE,
  DEFAULT_TOOL_DESCRIPTION,
  DEFAULT_KB_EMPTY_TEXT,
  validatePromptDraft,
} from "./sales-agent.js";

export {
  INTAKE_SYSTEM_PROMPT,
  IDENTIFY_SYSTEM_PROMPT,
  DIAGNOSTIC_SYSTEM_PROMPT,
  RESOLUTION_SYSTEM_PROMPT,
  COMPLIANCE_MONITOR_PROMPT,
  COMPLIANCE_REVIEW_TEMPLATE,
  KB_EMPTY_CONTEXT,
  WARRANTY_PLACEHOLDERS,
  WARRANTY_PHASE_PROMPTS,
} from "./warranty-agent.js";

export * from "./content.js";

export {
  AGENT_TYPES,
  PROMPT_REGISTRY,
  getAgentSpec,
  listAgents,
  defaultsFor,
} from "./registry.js";
