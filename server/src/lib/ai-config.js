import prisma from "./prisma.js";
import { encrypt, decryptSafe } from "./crypto.js";

export const AI_PLATFORM_KEYS_SETTING = "ai.platformKeys";
export const TENANT_AI_PROVIDERS = ["ANTHROPIC", "OPENAI", "GROQ"];
export const PLATFORM_AI_PROVIDERS = ["ANTHROPIC", "OPENAI", "GROQ"];

export const DEFAULT_MODELS = {
  ANTHROPIC: "claude-sonnet-5",
  OPENAI: "gpt-4o-mini",
  GROQ: "llama-3.3-70b-versatile",
};

export const AI_PROVIDER_CAPABILITIES = {
  ANTHROPIC: { chat: true, tools: true, jsonMode: false, embeddings: false },
  OPENAI: { chat: true, tools: true, jsonMode: true, embeddings: false },
  GROQ: { chat: true, tools: true, jsonMode: true, embeddings: false },
};

export function providerSupports(provider, capability) {
  return !!AI_PROVIDER_CAPABILITIES[provider]?.[capability];
}

export const AI_UNAVAILABLE = {
  NO_COMPANY: "No company context for this request.",
  NO_KEY:
    "No AI provider configured. Add your own provider key in Sales Settings > AI Config, or ask your administrator to grant you the platform key.",
  PLATFORM_KEY_MISSING:
    "Your workspace is granted the platform AI key, but the administrator has not set that key yet. Please contact support.",
};

export function describeAiUnavailable(reason) {
  return AI_UNAVAILABLE[reason] || AI_UNAVAILABLE.NO_KEY;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map();

export function invalidateAiConfigCache(companyId) {
  if (companyId) cache.delete(companyId);
  else cache.clear();
}

export async function getPlatformAiKeys() {
  try {
    if (!prisma.platformSetting) return {};
    const row = await prisma.platformSetting.findUnique({
      where: { key: AI_PLATFORM_KEYS_SETTING },
    });
    const stored = row?.value && typeof row.value === "object" ? row.value : {};
    const out = {};
    for (const provider of PLATFORM_AI_PROVIDERS) {
      const plain = decryptSafe(stored[provider] || "");
      if (plain) out[provider] = plain;
    }
    return out;
  } catch (err) {
    console.warn("[AI Config] Could not read platform AI keys:", err.message);
    return {};
  }
}

export async function getPlatformAiKeyStatus() {
  const keys = await getPlatformAiKeys();
  return PLATFORM_AI_PROVIDERS.map((provider) => ({
    provider,
    configured: !!keys[provider],
    masked: keys[provider] ? `••••${keys[provider].slice(-4)}` : null,
  }));
}

export async function savePlatformAiKey(provider, apiKey) {
  if (!PLATFORM_AI_PROVIDERS.includes(provider)) {
    throw new Error(`Unsupported platform AI provider: ${provider}`);
  }
  const row = await prisma.platformSetting.findUnique({
    where: { key: AI_PLATFORM_KEYS_SETTING },
  });
  const stored = row?.value && typeof row.value === "object" ? { ...row.value } : {};

  const trimmed = String(apiKey ?? "").trim();
  if (!trimmed) delete stored[provider];
  else stored[provider] = encrypt(trimmed);

  await prisma.platformSetting.upsert({
    where: { key: AI_PLATFORM_KEYS_SETTING },
    create: { key: AI_PLATFORM_KEYS_SETTING, value: stored },
    update: { value: stored },
  });

  invalidateAiConfigCache();
  return { provider, configured: !!trimmed };
}

async function resolveUncached(companyId) {
  if (!companyId) return { provider: null, reason: "NO_COMPANY" };

  const [company, integrations] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: { aiPlatformGrant: true },
    }),
    prisma.integration.findMany({
      where: {
        companyId,
        isActive: true,
        platform: { in: TENANT_AI_PROVIDERS },
      },
      select: { platform: true, apiKey: true },
    }),
  ]);

  for (const provider of TENANT_AI_PROVIDERS) {
    const row = integrations.find((i) => i.platform === provider);
    const apiKey = decryptSafe(row?.apiKey || "");
    if (apiKey) {
      return {
        provider,
        apiKey,
        model: DEFAULT_MODELS[provider],
        source: "tenant",
      };
    }
  }

  const grant = company?.aiPlatformGrant;
  if (grant && PLATFORM_AI_PROVIDERS.includes(grant)) {
    const keys = await getPlatformAiKeys();
    if (keys[grant]) {
      return {
        provider: grant,
        apiKey: keys[grant],
        model: DEFAULT_MODELS[grant],
        source: "platform",
      };
    }
    return { provider: null, reason: "PLATFORM_KEY_MISSING" };
  }

  return { provider: null, reason: "NO_KEY" };
}

/**
 * The platform's own key, ignoring whatever the tenant has configured. Used by
 * internal tooling — the prompt lab — so testing never spends a tenant's key or
 * depends on them having one.
 */
export async function resolvePlatformAiConfig() {
  const keys = await getPlatformAiKeys();
  for (const provider of PLATFORM_AI_PROVIDERS) {
    if (keys[provider]) {
      return {
        provider,
        apiKey: keys[provider],
        model: DEFAULT_MODELS[provider],
        source: "platform",
      };
    }
  }
  return { provider: null, reason: "PLATFORM_KEY_MISSING" };
}

export async function resolveAiConfig(companyId, { forcePlatform = false } = {}) {
  if (forcePlatform) return resolvePlatformAiConfig();
  if (!companyId) return { provider: null, reason: "NO_COMPANY" };

  const hit = cache.get(companyId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  let value;
  try {
    value = await resolveUncached(companyId);
  } catch (err) {
    console.error("[AI Config] Resolution failed:", err.message);
    return { provider: null, reason: "NO_KEY" };
  }

  cache.set(companyId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function hasPlatformAi() {
  const cfg = await resolvePlatformAiConfig();
  return !!cfg.provider;
}

export async function hasAi(companyId) {
  const cfg = await resolveAiConfig(companyId);
  return !!cfg.provider;
}

export async function aiUnavailableMessage(companyId) {
  const cfg = await resolveAiConfig(companyId);
  return describeAiUnavailable(cfg.reason);
}

export function recordAiUsage(companyId, cfg, usage) {
  if (!usage) return;
  const { provider, source } = cfg || {};
  const input = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const output = usage.output_tokens ?? usage.completion_tokens ?? 0;
  if (!input && !output) return;
  console.log(
    `[AI Usage] company=${companyId} provider=${provider} key=${source} in=${input} out=${output}`,
  );
}
