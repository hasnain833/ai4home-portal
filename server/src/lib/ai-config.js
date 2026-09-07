export const AI_PROVIDER = "ANTHROPIC";
export const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
export const FAST_MODEL = process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5";


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

export function recordAiUsage(companyId, cfg, usage) {
  if (!usage) return;
  const input = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const output = usage.output_tokens ?? usage.completion_tokens ?? 0;
  if (!input && !output) return;
  console.log(
    `[AI Usage] company=${companyId} model=${cfg?.model} in=${input} out=${output}`,
  );
}
