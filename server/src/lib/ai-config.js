import { recordUsage, aiCostMicros } from "./usage.js";

export const AI_PROVIDER = "ANTHROPIC";
export const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
export const FAST_MODEL = process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5";


const EFFORT_UNSUPPORTED = ["haiku", "sonnet-4-5", "opus-4-5", "sonnet-3", "opus-3"];

export function supportsEffort(model) {
  const id = String(model || "").toLowerCase();
  if (!id) return false;
  return !EFFORT_UNSUPPORTED.some((fragment) => id.includes(fragment));
}


export const PHASE_EFFORT = {
  INTAKE: "low",
  IDENTIFY: "low",
  DIAGNOSE: "medium",
  RESOLVE: "medium",
};

export function effortForPhase(phase) {
  return PHASE_EFFORT[phase] || "medium";
}

export function toFastTier(cfg) {
  if (!cfg?.provider) return cfg;
  if (!FAST_MODEL || FAST_MODEL === cfg.model) return cfg;
  return { ...cfg, model: FAST_MODEL, tier: "fast" };
}

export const AI_UNAVAILABLE = {
  PLATFORM_KEY_MISSING:
    "AI is temporarily unavailable. Please contact support if this continues.",
};

export function describeAiUnavailable(reason) {
  return AI_UNAVAILABLE[reason] || AI_UNAVAILABLE.PLATFORM_KEY_MISSING;
}

export function getPlatformAiKey() {
  const key = String(process.env.ANTHROPIC_API_KEY || "").trim();
  return key || null;
}

export function resolveAiConfig() {
  const apiKey = getPlatformAiKey();
  if (!apiKey) {
    console.error(
      "[AI Config] ANTHROPIC_API_KEY is not set — every AI feature is disabled.",
    );
    return { provider: null, reason: "PLATFORM_KEY_MISSING" };
  }
  return {
    provider: AI_PROVIDER,
    apiKey,
    model: DEFAULT_MODEL,
    source: "platform",
  };
}

export const resolvePlatformAiConfig = resolveAiConfig;

export function hasPlatformAi() {
  return !!getPlatformAiKey();
}

export function hasAi() {
  return !!getPlatformAiKey();
}

export function aiUnavailableMessage() {
  return describeAiUnavailable(resolveAiConfig().reason);
}

export function recordAiUsage(companyId, cfg, usage, source = null) {
  if (!usage) return;
  const input = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const output = usage.output_tokens ?? usage.completion_tokens ?? 0;
  if (!input && !output) return;

  // Fire and forget: AI calls must not wait on the usage ledger.
  void recordUsage({
    companyId,
    channel: "AI",
    provider: cfg?.model || DEFAULT_MODEL,
    units: input + output,
    costMicros: aiCostMicros(cfg?.model, input, output),
    source,
  });
}
